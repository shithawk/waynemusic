const state = {
  tracks: [],
  catalog: [],
  macError: "",
  currentId: null,
  playing: false,
  query: "",
  linkOpen: false,
  working: false,
  removeId: null,
  readyId: null,
  shuffle: false,
  shuffleOrder: [],
  shuffleIndex: -1,
  shuffleHistory: [],
  shuffleRewind: false
};

let dbPromise = null;
const fileBlobs = new Map();
const fileURLs = new Map();
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
let ytPlayer = null;
let ytReady = false;
let pendingVideo = "";
let scWidget = null;
let noticeTimer = 0;
const downloading = new Set();

const audio = () => document.getElementById("audio");

document.addEventListener("DOMContentLoaded", init);

async function init() {
  document.getElementById("install-hint").hidden = standalone();
  state.shuffle = loadShuffle();
  bindEvents();
  bindMediaSession();
  audio().addEventListener("play", () => { if (isSource("local")) setPlaying(true); });
  audio().addEventListener("pause", () => {
    if (isSource("local") && !audio().ended) setPlaying(false);
  });
  audio().addEventListener("ended", () => { if (isSource("local")) step(1); });
  try {
    state.tracks = sortTracks(await allTracks());
  } catch {
    setNotice("This iPad could not open saved songs. Leave private browsing, then add Wayne's Music to the Home Screen.");
  }
  if (state.shuffle) startShuffle(state.currentId);
  render();
  requestPersist();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

function bindEvents() {
  document.getElementById("add-music").addEventListener("click", openAdd);
  document.getElementById("close-add").addEventListener("click", () => hideSheet("add-sheet"));
  document.getElementById("manage-songs").addEventListener("click", openManage);
  document.getElementById("close-manage").addEventListener("click", () => hideSheet("manage-sheet"));
  document.getElementById("download-all").addEventListener("click", downloadAll);
  document.getElementById("from-ipad").addEventListener("click", () => document.getElementById("file-input").click());
  document.getElementById("file-input").addEventListener("change", (event) => importFiles(event.target.files));
  document.getElementById("paste-link").addEventListener("click", pasteLink);
  document.getElementById("type-link").addEventListener("click", toggleLinkBox);
  document.getElementById("add-link").addEventListener("click", () => addTypedLink());
  document.getElementById("link-input").addEventListener("input", () => {
    document.getElementById("add-link").disabled = !document.getElementById("link-input").value.trim();
  });
  document.getElementById("find-song").addEventListener("input", (event) => {
    state.query = event.target.value;
    renderSongs();
  });
  document.getElementById("clear-search").addEventListener("click", () => {
    const input = document.getElementById("find-song");
    input.value = "";
    state.query = "";
    renderSongs();
    input.focus();
  });
  document.getElementById("song-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-play]");
    if (!button) return;
    const track = state.tracks.find((item) => item.id === button.dataset.play);
    if (!track) return;
    if (track.id === state.currentId && state.playing) return;
    userPlay(track, false);
  });
  document.getElementById("catalog-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-download]");
    if (!button || button.disabled) return;
    const entry = state.catalog.find((item) => item.file === button.dataset.download);
    if (entry) downloadEntry(entry, true);
  });
  document.getElementById("manage-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove]");
    if (!button) return;
    state.removeId = button.dataset.remove;
    const track = state.tracks.find((item) => item.id === state.removeId);
    document.getElementById("confirm-name").textContent = track ? track.title : "This song";
    document.getElementById("confirm").hidden = false;
  });
  document.getElementById("confirm-keep").addEventListener("click", hideConfirm);
  document.getElementById("confirm-remove").addEventListener("click", confirmRemove);
  document.getElementById("now-bar").addEventListener("click", () => openPlayer());
  document.getElementById("back-songs").addEventListener("click", closePlayer);
  document.getElementById("previous").addEventListener("click", () => skip(-1));
  document.getElementById("next").addEventListener("click", () => skip(1));
  document.getElementById("play-button").addEventListener("click", () => {
    if (isAudiblyPlaying()) userPause();
    else userPlay(currentTrack() || songToStart(), playerIsOpen());
  });
  document.getElementById("shuffle").addEventListener("click", () => {
    setShuffle(!state.shuffle);
  });
}

function bindMediaSession() {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.setActionHandler("play", () => {
    if (!isAudiblyPlaying()) userPlay(currentTrack() || songToStart(), playerIsOpen());
  });
  navigator.mediaSession.setActionHandler("pause", () => {
    if (isAudiblyPlaying()) userPause();
  });
  navigator.mediaSession.setActionHandler("previoustrack", () => skip(-1));
  navigator.mediaSession.setActionHandler("nexttrack", () => skip(1));
}

function standalone() {
  return window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

function render() {
  renderSongs();
  renderPlayer();
  updateShuffleButton();
}

function renderSongs() {
  const hasTracks = state.tracks.length > 0;
  document.getElementById("empty").hidden = hasTracks;
  document.getElementById("finder").hidden = !hasTracks;
  document.getElementById("manage-songs").hidden = !hasTracks;
  const list = document.getElementById("song-list");
  list.replaceChildren();
  const query = state.query.trim().toLowerCase();
  const visible = state.tracks.filter((track) => {
    if (!query) return true;
    return track.title.toLowerCase().includes(query) || track.artist.toLowerCase().includes(query);
  });
  document.getElementById("clear-search").hidden = query.length === 0;
  if (hasTracks && visible.length === 0) {
    const empty = document.createElement("p");
    empty.className = "search-empty";
    empty.textContent = "No song matches that. Try another word.";
    list.append(empty);
  }
  for (const track of visible) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "song" + (track.id === state.currentId ? " current" : "");
    button.dataset.play = track.id;
    const title = document.createElement("span");
    title.className = "song-title";
    title.textContent = track.title;
    const sub = document.createElement("span");
    sub.className = "song-sub";
    sub.textContent = (track.id === state.currentId && state.playing ? "Playing · " : "") + subtitle(track);
    button.append(title, sub);
    list.append(button);
  }
  const current = currentTrack();
  const bar = document.getElementById("now-bar");
  bar.hidden = !current;
  document.getElementById("now-bar-title").textContent = current ? current.title : "";
  const kicker = document.querySelector(".now-kicker");
  if (kicker) kicker.textContent = state.playing ? "Now playing" : "Paused";
}

function renderPlayer() {
  const track = currentTrack();
  document.getElementById("player-title").textContent = track ? track.title : "";
  document.getElementById("player-sub").textContent = track ? subtitle(track) : "";
  document.getElementById("stage-local").hidden = !track || track.source !== "local";
  document.getElementById("stage-yt").hidden = !track || track.source !== "youtube";
  document.getElementById("stage-sc").hidden = !track || track.source !== "soundcloud";
  setPlaying(state.playing);
}

function subtitle(track) {
  if (track.source === "youtube") return track.artist ? track.artist + " · YouTube" : "YouTube";
  if (track.source === "soundcloud") return track.artist ? track.artist + " · SoundCloud" : "SoundCloud";
  return (track.artist || "").trim();
}

function currentTrack() {
  return state.tracks.find((track) => track.id === state.currentId) || null;
}

function isSource(source) {
  const track = currentTrack();
  return Boolean(track && track.source === source);
}

function openPlayer() {
  const player = document.getElementById("player");
  player.classList.add("open");
  player.inert = false;
  player.setAttribute("aria-hidden", "false");
}

function closePlayer() {
  const player = document.getElementById("player");
  player.classList.remove("open");
  player.inert = true;
  player.setAttribute("aria-hidden", "true");
}

function setPlaying(playing) {
  state.playing = playing;
  document.getElementById("play-label").textContent = playing ? "Pause" : "Play";
  const playButton = document.getElementById("play-button");
  playButton.setAttribute("aria-label", playing ? "Pause" : "Play");
  playButton.classList.toggle("is-playing", playing);
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }
  renderSongs();
}

function setNotice(text) {
  const el = document.getElementById("notice");
  el.textContent = text;
  el.hidden = !text;
  clearTimeout(noticeTimer);
  if (text) noticeTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

function showSheet(id) {
  document.getElementById(id).hidden = false;
}

function hideSheet(id) {
  document.getElementById(id).hidden = true;
}

function playerIsOpen() {
  return document.getElementById("player").classList.contains("open");
}

function setAddError(text) {
  const el = document.getElementById("add-error");
  el.textContent = text;
  el.hidden = !text;
}

async function openAdd() {
  setAddError("");
  showSheet("add-sheet");
  await loadCatalog();
  renderCatalog();
}

async function loadCatalog() {
  try {
    const response = await fetch("/catalog.json", { cache: "no-store" });
    if (!response.ok) throw new Error("missing");
    const payload = await response.json();
    state.catalog = Array.isArray(payload) ? payload : [];
    state.macError = "";
  } catch {
    state.catalog = [];
    state.macError = "The computer is off or asleep. Songs already on this iPad still play.";
  }
}

function renderCatalog() {
  const status = document.getElementById("mac-status");
  const list = document.getElementById("catalog-list");
  list.replaceChildren();
  if (state.macError) {
    status.textContent = state.macError;
  } else if (state.catalog.length === 0) {
    status.textContent = "No songs on the computer yet.";
  } else {
    status.textContent = "Tap Download to put a song on this iPad.";
  }
  for (const entry of state.catalog) {
    const row = document.createElement("div");
    row.className = "catalog-row";
    const text = document.createElement("div");
    text.className = "text";
    const title = document.createElement("span");
    title.className = "song-title";
    title.textContent = entry.title;
    const sub = document.createElement("span");
    sub.className = "song-sub";
    sub.textContent = [entry.artist, formatBytes(entry.bytes)].filter(Boolean).join(" · ");
    text.append(title, sub);
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.download = entry.file;
    const already = savedOnIpad(entry);
    button.className = "download" + (already ? " saved" : "");
    button.disabled = already || downloading.has(entry.file);
    button.textContent = already ? "On this iPad" : "Download";
    row.append(text, button);
    list.append(row);
  }
  const pending = state.catalog.filter((entry) => !savedOnIpad(entry));
  const downloadAll = document.getElementById("download-all");
  downloadAll.hidden = pending.length === 0;
  downloadAll.disabled = state.working || pending.length === 0;
}

function savedOnIpad(entry) {
  return state.tracks.some((track) => track.source === "local" && track.mediaRef === entry.file);
}

function formatBytes(bytes) {
  const size = Number(bytes) || 0;
  if (size <= 0) return "";
  const mb = size / (1024 * 1024);
  if (mb >= 1) return mb.toFixed(1) + " MB";
  return Math.max(1, Math.round(size / 1024)) + " KB";
}

async function downloadAll() {
  const pending = state.catalog.filter((entry) => !savedOnIpad(entry));
  let count = 0;
  for (const entry of pending) {
    const saved = await downloadEntry(entry, false);
    if (!saved) break;
    count += 1;
  }
  render();
  renderCatalog();
  if (count > 0) setNotice(count === 1 ? "1 song is on this iPad. Tap Done, then tap the song." : count + " songs are on this iPad. Tap Done, then tap a song.");
}

async function downloadEntry(entry, announce) {
  if (savedOnIpad(entry) || downloading.has(entry.file)) return false;
  downloading.add(entry.file);
  state.working = true;
  setAddError("");
  let saved = false;
  let savedTitle = "";
  renderCatalog();
  const button = document.querySelector('[data-download="' + CSS.escape(entry.file) + '"]');
  if (button) {
    button.disabled = true;
    button.textContent = "Downloading…";
  }
  try {
    await requestPersist();
    const response = await fetch("/music/" + encodeURIComponent(entry.file));
    if (!response.ok) throw new Error("download");
    const type = mimeFor(entry.file, response.headers.get("content-type"));
    const total = Number(response.headers.get("content-length")) || Number(entry.bytes) || 0;
    const blob = await readBody(response, type, total, (ratio) => {
      if (button) button.textContent = "Downloading… " + Math.round(ratio * 100) + "%";
    });
    if (!blob.size || (total > 0 && blob.size < total)) throw new Error("download");
    const track = {
      id: "mac:" + entry.file,
      title: entry.title || entry.file,
      artist: entry.artist || "",
      source: "local",
      mediaRef: entry.file,
      bytes: blob.size,
      createdAt: Date.now()
    };
    await saveLocal(track, blob);
    state.readyId = track.id;
    state.tracks = sortTracks(state.tracks.filter((item) => item.id !== track.id).concat(track));
    saved = true;
    savedTitle = track.title;
  } catch {
    setAddError(entry.title + " could not be downloaded.");
  } finally {
    downloading.delete(entry.file);
    state.working = downloading.size > 0;
  }
  if (announce || !saved) {
    render();
    renderCatalog();
  }
  if (saved && announce) setNotice(savedTitle + " is on this iPad. Tap Done, then tap the song.");
  return saved;
}

async function readBody(response, type, total, onProgress) {
  if (!response.body || !response.body.getReader) {
    const blob = await response.blob();
    return new Blob([blob], { type });
  }
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (total > 0) onProgress(Math.min(1, received / total));
  }
  return new Blob(chunks, { type });
}

function mimeFor(name, header) {
  if (header && header.startsWith("audio/")) return header.split(";")[0].trim();
  const ext = name.split(".").pop().toLowerCase();
  if (ext === "m4a" || ext === "mp4" || ext === "aac") return "audio/mp4";
  if (ext === "wav") return "audio/wav";
  return "audio/mpeg";
}

async function importFiles(fileList) {
  const files = Array.from(fileList || []);
  document.getElementById("file-input").value = "";
  if (!files.length) return;
  setAddError("");
  state.working = true;
  await requestPersist();
  const titles = [];
  let failures = 0;
  for (const file of files) {
    try {
      const tags = await readID3(file);
      const fallback = file.name.replace(/\.[^.]+$/, "") || "Song";
      const track = {
        id: uid(),
        title: tags.title || fallback,
        artist: tags.artist || "",
        source: "local",
        mediaRef: file.name,
        bytes: file.size,
        createdAt: Date.now()
      };
      await saveLocal(track, file);
      state.readyId = track.id;
      titles.push(track.title);
      state.tracks.push(track);
    } catch {
      failures += 1;
    }
  }
  state.tracks = sortTracks(state.tracks);
  state.working = false;
  render();
  hideSheet("add-sheet");
  if (titles.length === 1 && failures === 0) setNotice("Added " + titles[0]);
  else if (titles.length > 1 && failures === 0) setNotice("Added " + titles.length + " songs");
  else if (titles.length === 0) setNotice("That song could not be added.");
  else setNotice("Added " + titles.length + " songs. " + failures + " could not be added.");
}

async function pasteLink() {
  let copied = "";
  try {
    copied = await navigator.clipboard.readText();
  } catch {
    copied = "";
  }
  if (!copied.trim()) {
    setAddError("Copy a YouTube or SoundCloud link first.");
    return;
  }
  await addLinkText(copied);
}

function toggleLinkBox() {
  state.linkOpen = !state.linkOpen;
  document.getElementById("link-box").hidden = !state.linkOpen;
  document.getElementById("type-link").textContent = state.linkOpen ? "Hide the link" : "Type a link";
}

function addTypedLink() {
  addLinkText(document.getElementById("link-input").value);
}

async function addLinkText(text) {
  setAddError("");
  state.working = true;
  document.getElementById("paste-link").disabled = true;
  document.getElementById("add-link").disabled = true;
  document.getElementById("add-link").textContent = "Adding…";
  try {
    const title = await addLink(text);
    document.getElementById("link-input").value = "";
    hideSheet("add-sheet");
    render();
    setNotice("Added " + title);
  } catch (error) {
    setAddError(error.message || "That link could not be added.");
  } finally {
    state.working = false;
    document.getElementById("paste-link").disabled = false;
    document.getElementById("add-link").textContent = "Add this link";
    document.getElementById("add-link").disabled = !document.getElementById("link-input").value.trim();
  }
}

async function addLink(text) {
  const parsed = parseLink(text);
  if (!parsed) throw new Error("Use a YouTube or SoundCloud link.");
  if (state.tracks.some((track) => track.source === parsed.source && track.mediaRef === parsed.mediaRef)) {
    throw new Error("That song is already in the list.");
  }
  const meta = await fetchOEmbed(parsed);
  const track = {
    id: parsed.source + ":" + parsed.mediaRef,
    title: meta.title,
    artist: meta.artist,
    source: parsed.source,
    mediaRef: parsed.mediaRef,
    bytes: 0,
    createdAt: Date.now()
  };
  await putTrack(track);
  state.tracks = sortTracks(state.tracks.concat(track));
  return track.title;
}

async function fetchOEmbed(parsed) {
  const fallback = parsed.source === "youtube" ? "YouTube video" : "SoundCloud song";
  const endpoint = parsed.source === "youtube" ? "/api/youtube-oembed" : "/api/soundcloud-oembed";
  try {
    const response = await fetch(endpoint + "?url=" + encodeURIComponent(parsed.pageURL));
    if (!response.ok) return { title: fallback, artist: "" };
    const payload = await response.json();
    return {
      title: String(payload.title || "").trim() || fallback,
      artist: String(payload.author_name || "").trim()
    };
  } catch {
    return { title: fallback, artist: "" };
  }
}

function openManage() {
  hideConfirm();
  renderManage();
  showSheet("manage-sheet");
}

function renderManage() {
  const list = document.getElementById("manage-list");
  list.replaceChildren();
  document.getElementById("manage-empty").hidden = state.tracks.length !== 0;
  for (const track of state.tracks) {
    const row = document.createElement("div");
    row.className = "manage-row";
    const text = document.createElement("div");
    text.className = "text";
    const title = document.createElement("span");
    title.className = "song-title";
    title.textContent = track.title;
    const sub = document.createElement("span");
    sub.className = "song-sub";
    sub.textContent = subtitle(track);
    text.append(title, sub);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "remove";
    button.dataset.remove = track.id;
    button.textContent = "Remove";
    row.append(text, button);
    list.append(row);
  }
}

function hideConfirm() {
  state.removeId = null;
  document.getElementById("confirm").hidden = true;
}

async function confirmRemove() {
  const id = state.removeId;
  hideConfirm();
  if (!id) return;
  await deleteTrack(id);
  state.tracks = state.tracks.filter((track) => track.id !== id);
  if (state.currentId === id) {
    stopPlayback();
    state.currentId = null;
    state.playing = false;
    closePlayer();
  }
  render();
  renderManage();
}

async function playTrack(track, options) {
  const open = !options || options.open !== false;
  if (state.shuffle && state.currentId && state.currentId !== track.id && !state.shuffleRewind) {
    state.shuffleHistory.push(state.currentId);
    if (state.shuffleHistory.length > 40) state.shuffleHistory.shift();
  }
  state.shuffleRewind = false;
  const shuffleAt = state.shuffle ? state.shuffleOrder.indexOf(track.id) : -1;
  if (shuffleAt >= 0) state.shuffleIndex = shuffleAt;
  if (state.currentId === track.id) {
    if (!state.playing) {
      if (track.source === "local" && realSource(audio()) && !audio().paused) setPlaying(true);
      else await toggle();
    }
    if (open) openPlayer();
    render();
    return;
  }
  state.currentId = track.id;
  const player = audio();
  const started = track.source === "local" && player.src === fileURLs.get(track.id) && !player.paused && !player.error;
  state.playing = Boolean(started);
  if (open) openPlayer();
  publishSession(track);
  render();
  try {
    if (track.source === "local") await playLocal(track);
    else if (track.source === "youtube") playYouTube(track);
    else await playSoundCloud(track);
  } catch {
    setNotice("That song could not be played.");
  }
}

function isAudiblyPlaying() {
  const track = currentTrack();
  if (!track) return false;
  if (track.source === "local") return realSource(audio()) && !audio().paused;
  return state.playing;
}

function userPause() {
  const track = currentTrack();
  if (!track) return;
  if (track.source === "local") {
    audio().pause();
    return;
  }
  if (track.source === "youtube" && ytPlayer && ytPlayer.pauseVideo) {
    ytPlayer.pauseVideo();
    return;
  }
  if (scWidget && scWidget.pause) scWidget.pause();
}

function userPlay(track, open) {
  if (!track) return;
  const player = audio();
  if (track.source === "local") {
    const url = fileURLs.get(track.id);
    if (url) {
      if (player.src !== url) player.src = url;
      const pending = player.play();
      if (pending && pending.catch) pending.catch(() => {});
    } else if (!realSource(player)) {
      player.src = SILENT_WAV;
      const pending = player.play();
      if (pending && pending.catch) pending.catch(() => {});
    }
  }
  if (track.source === "local" && state.currentId === track.id && realSource(player) && !player.paused) {
    setPlaying(true);
    if (open) openPlayer();
    return;
  }
  playTrack(track, { open: open });
}

function skip(direction) {
  const track = trackForStep(direction);
  if (!track) return;
  if (track.id === state.currentId) {
    state.shuffleRewind = false;
    restart();
    return;
  }
  userPlay(track, playerIsOpen());
}

function realSource(player) {
  const src = player.currentSrc || player.src || "";
  return Boolean(src) && !src.startsWith("data:");
}

function prepareURL(id, blob) {
  const existing = fileURLs.get(id);
  if (existing) URL.revokeObjectURL(existing);
  const url = URL.createObjectURL(blob);
  fileURLs.set(id, url);
  return url;
}

function songToStart() {
  if (state.shuffle && state.tracks.length) {
    if (!state.shuffleOrder.length) startShuffle(null);
    else syncShuffleOrder();
    if (!state.shuffleOrder.length) return null;
    const index = Math.floor(Math.random() * state.shuffleOrder.length);
    state.shuffleIndex = index;
    return state.tracks.find((track) => track.id === state.shuffleOrder[index]) || null;
  }
  return state.tracks.find((track) => track.id === state.readyId) || state.tracks[0] || null;
}

function trackForStep(direction) {
  if (!state.tracks.length) return null;
  if (state.shuffle) return shuffledTrack(direction);
  if (!state.currentId) return songToStart();
  const index = state.tracks.findIndex((track) => track.id === state.currentId);
  const start = index < 0 ? 0 : index;
  const nextIndex = (start + direction + state.tracks.length) % state.tracks.length;
  return state.tracks[nextIndex];
}

function shuffledTrack(direction) {
  if (state.tracks.length < 2) return state.tracks[0] || null;
  if (!state.shuffleOrder.length) startShuffle(state.currentId);
  else syncShuffleOrder();
  if (!state.currentId) return songToStart();
  if (direction < 0) {
    const previousId = state.shuffleHistory.pop();
    const previous = previousId ? state.tracks.find((track) => track.id === previousId) : null;
    state.shuffleRewind = true;
    if (previous) {
      const at = state.shuffleOrder.indexOf(previous.id);
      if (at >= 0) state.shuffleIndex = at;
      return previous;
    }
    return currentTrack() || state.tracks[0];
  }
  let index = state.shuffleOrder.indexOf(state.currentId);
  if (index < 0 || index >= state.shuffleOrder.length - 1) {
    startShuffle(state.currentId);
    index = 0;
  }
  const nextId = state.shuffleOrder[index + 1];
  state.shuffleIndex = index + 1;
  return state.tracks.find((track) => track.id === nextId) || null;
}

function startShuffle(currentId) {
  const ids = state.tracks.map((track) => track.id);
  const rest = shuffleIds(ids.filter((id) => id !== currentId));
  state.shuffleOrder = currentId && ids.includes(currentId) ? [currentId].concat(rest) : rest;
  state.shuffleIndex = currentId ? 0 : -1;
}

function syncShuffleOrder() {
  const ids = state.tracks.map((track) => track.id);
  const have = new Set(ids);
  const kept = state.shuffleOrder.filter((id) => have.has(id));
  const seen = new Set(kept);
  state.shuffleOrder = kept.concat(shuffleIds(ids.filter((id) => !seen.has(id))));
  state.shuffleHistory = state.shuffleHistory.filter((id) => have.has(id));
}

function shuffleIds(ids) {
  const copy = ids.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = copy[i];
    copy[i] = copy[j];
    copy[j] = swap;
  }
  return copy;
}

function setShuffle(on) {
  state.shuffle = on;
  state.shuffleHistory = [];
  state.shuffleRewind = false;
  if (on) startShuffle(state.currentId);
  saveShuffle();
  updateShuffleButton();
}

function updateShuffleButton() {
  const button = document.getElementById("shuffle");
  const label = document.getElementById("shuffle-label");
  if (!button || !label) return;
  const on = state.shuffle;
  button.classList.toggle("is-on", on);
  button.classList.toggle("plain", !on);
  button.setAttribute("aria-pressed", on ? "true" : "false");
  button.setAttribute("aria-label", on ? "Shuffle on" : "Shuffle off");
  label.textContent = on ? "Shuffle on" : "Shuffle off";
}

function loadShuffle() {
  try {
    return localStorage.getItem("waynes-shuffle") === "on";
  } catch {
    return false;
  }
}

function saveShuffle() {
  try {
    localStorage.setItem("waynes-shuffle", state.shuffle ? "on" : "off");
  } catch {
    // The button still shows the choice for this visit.
  }
}

async function playLocal(track) {
  pauseYouTube();
  pauseSoundCloud();
  let url = fileURLs.get(track.id);
  if (!url) {
    const blob = await playableBlob(track);
    if (!blob) {
      setNotice("That song is not on this iPad.");
      return;
    }
    url = prepareURL(track.id, blob);
  }
  const player = audio();
  if (player.src !== url) {
    player.src = url;
    player.load();
  }
  if (!player.paused && !player.error) {
    setPlaying(true);
    return;
  }
  try {
    await player.play();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (player.src !== url) player.src = url;
    await player.play();
  }
}

async function playableBlob(track) {
  let blob = fileBlobs.get(track.id);
  if (!blob || !blob.size) blob = await getBlob(track.id);
  if (!blob || !blob.size) return null;
  const type = blob.type && blob.type.startsWith("audio/") ? blob.type : mimeFor(track.mediaRef || "", "");
  let data = await blob.arrayBuffer();
  if (!data.byteLength) {
    fileBlobs.delete(track.id);
    blob = await getBlob(track.id);
    if (!blob || !blob.size) return null;
    data = await blob.arrayBuffer();
  }
  if (!data.byteLength) return null;
  const playable = new Blob([data], { type });
  fileBlobs.set(track.id, playable);
  return playable;
}

function playYouTube(track) {
  audio().pause();
  pauseSoundCloud();
  pendingVideo = track.mediaRef;
  loadYouTubeAPI();
  if (ytReady && ytPlayer && ytPlayer.loadVideoById) {
    ytPlayer.loadVideoById(track.mediaRef);
    ytPlayer.playVideo();
  }
}

async function playSoundCloud(track) {
  audio().pause();
  pauseYouTube();
  await loadSoundCloudAPI();
  const stage = document.getElementById("stage-sc");
  stage.replaceChildren();
  const frame = document.createElement("iframe");
  frame.id = "sc-frame";
  frame.setAttribute("allow", "autoplay");
  frame.setAttribute("scrolling", "no");
  frame.src = "https://w.soundcloud.com/player/?url=" + encodeURIComponent(track.mediaRef) + "&auto_play=true&hide_related=true&show_comments=false&show_user=true&show_reposts=false&visual=true&show_teaser=false";
  stage.append(frame);
  if (!window.SC || !window.SC.Widget) return;
  scWidget = window.SC.Widget(frame);
  scWidget.bind(window.SC.Widget.Events.READY, () => {
    if (isSource("soundcloud")) scWidget.play();
  });
  scWidget.bind(window.SC.Widget.Events.PLAY, () => { if (isSource("soundcloud")) setPlaying(true); });
  scWidget.bind(window.SC.Widget.Events.PAUSE, () => { if (isSource("soundcloud")) setPlaying(false); });
  scWidget.bind(window.SC.Widget.Events.FINISH, () => { if (isSource("soundcloud")) step(1); });
}

function loadYouTubeAPI() {
  if (document.getElementById("yt-api")) return;
  const tag = document.createElement("script");
  tag.id = "yt-api";
  tag.src = "https://www.youtube.com/iframe_api";
  document.body.append(tag);
}

window.onYouTubeIframeAPIReady = function onYouTubeIframeAPIReady() {
  ytPlayer = new YT.Player("yt-player", {
    width: "100%",
    height: "100%",
    videoId: pendingVideo || undefined,
    playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 0, fs: 0, iv_load_policy: 3 },
    events: {
      onReady: () => {
        ytReady = true;
        if (pendingVideo && isSource("youtube")) {
          ytPlayer.loadVideoById(pendingVideo);
          ytPlayer.playVideo();
        }
      },
      onStateChange: (event) => {
        if (!isSource("youtube") || !window.YT) return;
        if (event.data === YT.PlayerState.PLAYING) setPlaying(true);
        if (event.data === YT.PlayerState.PAUSED) setPlaying(false);
        if (event.data === YT.PlayerState.ENDED) step(1);
      },
      onError: () => setNotice("That video could not be played.")
    }
  });
};

function loadSoundCloudAPI() {
  if (window.SC && window.SC.Widget) return Promise.resolve();
  return new Promise((resolve) => {
    const existing = document.getElementById("sc-api");
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      return;
    }
    const tag = document.createElement("script");
    tag.id = "sc-api";
    tag.src = "https://w.soundcloud.com/player/api.js";
    tag.onload = () => resolve();
    tag.onerror = () => resolve();
    document.body.append(tag);
  });
}

async function toggle() {
  const track = currentTrack();
  if (!track) {
    const start = songToStart();
    if (start) await playTrack(start, { open: playerIsOpen() });
    return;
  }
  if (track.source === "local") {
    const player = audio();
    if (realSource(player) && !player.paused) {
      player.pause();
      return;
    }
    if (realSource(player) && !player.error) {
      try {
        await player.play();
        return;
      } catch {
        await playLocal(track);
        return;
      }
    }
    await playLocal(track);
    return;
  }
  if (track.source === "youtube" && ytPlayer) {
    if (state.playing && ytPlayer.pauseVideo) ytPlayer.pauseVideo();
    else if (ytPlayer.playVideo) ytPlayer.playVideo();
    return;
  }
  if (scWidget) {
    if (state.playing) scWidget.pause();
    else scWidget.play();
  }
}

function step(direction) {
  const track = trackForStep(direction);
  if (!track) return;
  if (track.id === state.currentId) {
    state.shuffleRewind = false;
    restart();
    return;
  }
  playTrack(track, { open: playerIsOpen() });
}

function restart() {
  const track = currentTrack();
  if (!track) return;
  if (track.source === "local") {
    audio().currentTime = 0;
    audio().play();
    return;
  }
  if (track.source === "youtube" && ytPlayer && ytPlayer.seekTo) {
    ytPlayer.seekTo(0, true);
    ytPlayer.playVideo();
    return;
  }
  if (scWidget) {
    scWidget.seekTo(0);
    scWidget.play();
  }
}

function stopPlayback() {
  const player = audio();
  player.pause();
  player.removeAttribute("src");
  player.load();
  pauseYouTube();
  pauseSoundCloud();
}

function pauseYouTube() {
  try {
    if (ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo();
  } catch { /* The player may not be ready yet. */ }
}

function pauseSoundCloud() {
  try {
    if (scWidget && scWidget.pause) scWidget.pause();
  } catch { /* The widget may not be ready yet. */ }
}

function publishSession(track) {
  if (!("mediaSession" in navigator) || !("MediaMetadata" in window)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist || ""
  });
}

function sortTracks(tracks) {
  return tracks.slice().sort((a, b) => {
    const order = (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base", numeric: true });
    if (order !== 0) return order;
    return a.createdAt - b.createdAt;
  });
}

function parseLink(text) {
  const url = firstURL(text);
  if (!url) return null;
  const id = youtubeID(url);
  if (id) {
    return { source: "youtube", mediaRef: id, pageURL: "https://www.youtube.com/watch?v=" + id };
  }
  if (isSoundCloud(url)) {
    return { source: "soundcloud", mediaRef: url.href, pageURL: url.href };
  }
  return null;
}

function firstURL(text) {
  const trimmed = String(text || "").trim();
  const match = trimmed.match(/https?:\/\/[^\s]+/i);
  let candidate = "";
  if (match) candidate = match[0].replace(/[),.;]+$/, "");
  else if (!trimmed.includes("://")) candidate = "https://" + trimmed;
  if (!candidate) return null;
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

function youtubeID(url) {
  const host = url.hostname.toLowerCase();
  if (host === "youtu.be" || host.endsWith(".youtu.be")) {
    return sanitizeYouTubeID(url.pathname.split("/").filter(Boolean)[0]);
  }
  if (!host.includes("youtube.com") && !host.includes("youtube-nocookie.com")) return null;
  const fromQuery = sanitizeYouTubeID(url.searchParams.get("v"));
  if (fromQuery) return fromQuery;
  const parts = url.pathname.split("/").filter(Boolean);
  const markers = ["embed", "shorts", "live", "v"];
  const markerIndex = parts.findIndex((part) => markers.includes(part));
  if (markerIndex >= 0) return sanitizeYouTubeID(parts[markerIndex + 1]);
  return null;
}

function sanitizeYouTubeID(raw) {
  if (!raw) return null;
  const id = String(raw).trim();
  return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
}

function isSoundCloud(url) {
  const host = url.hostname.toLowerCase();
  if (!(host === "soundcloud.com" || host.endsWith(".soundcloud.com"))) return false;
  return url.pathname.replace(/\//g, "").length > 0;
}

async function readID3(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
    let title = "";
    let artist = "";
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
      const version = head[3];
      let offset = 10;
      const tagSize = syncsafe(head, 6);
    if (head[5] & 0x40) {
      const extended = version === 4 ? syncsafe(head, offset) : be32(head, offset);
      offset += version === 4 ? extended : extended + 4;
    }
      const end = Math.min(head.length, 10 + tagSize);
      while (offset + 10 < end) {
        const id = String.fromCharCode(head[offset], head[offset + 1], head[offset + 2], head[offset + 3]);
        if (!id || id.charCodeAt(0) === 0) break;
        const frameSize = version === 4 ? syncsafe(head, offset + 4) : be32(head, offset + 4);
        const start = offset + 10;
        if (frameSize <= 0 || start + frameSize > head.length) break;
        if (id === "TIT2" || id === "TPE1") {
          const text = decodeTextFrame(head.subarray(start, start + frameSize));
          if (id === "TIT2") title = text;
          else artist = text;
        }
        offset = start + frameSize;
      }
    }
    if (!title || !artist) {
      const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 128)).arrayBuffer());
      if (tail.length >= 128 && String.fromCharCode(tail[0], tail[1], tail[2]) === "TAG") {
        const decoder = new TextDecoder("latin1");
        if (!title) title = decoder.decode(tail.subarray(3, 33)).replace(/\0/g, "").trim();
        if (!artist) artist = decoder.decode(tail.subarray(33, 63)).replace(/\0/g, "").trim();
      }
    }
    return { title: title.trim(), artist: artist.trim() };
  } catch {
    return { title: "", artist: "" };
  }
}

function syncsafe(bytes, offset) {
  return ((bytes[offset] & 0x7f) << 21) | ((bytes[offset + 1] & 0x7f) << 14) | ((bytes[offset + 2] & 0x7f) << 7) | (bytes[offset + 3] & 0x7f);
}

function be32(bytes, offset) {
  return (((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0);
}

function decodeTextFrame(frame) {
  if (!frame.length) return "";
  const encoding = frame[0];
  const data = frame.subarray(1);
  let label = "latin1";
  if (encoding === 3) label = "utf-8";
  if (encoding === 1) label = "utf-16";
  if (encoding === 2) label = "utf-16be";
  return new TextDecoder(label).decode(data).replace(/\0/g, "").trim();
}

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

async function requestPersist() {
  if (navigator.storage && navigator.storage.persist) {
    try { await navigator.storage.persist(); } catch { /* Safari may deny this until the app is on the Home Screen. */ }
  }
}

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open("waynesmusic", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("tracks")) db.createObjectStore("tracks", { keyPath: "id" });
      if (!db.objectStoreNames.contains("files")) db.createObjectStore("files", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("aborted"));
  });
}

async function allTracks() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("tracks", "readonly");
    const request = tx.objectStore("tracks").getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function putTrack(track) {
  const db = await openDB();
  const tx = db.transaction("tracks", "readwrite");
  tx.objectStore("tracks").put(track);
  await transactionDone(tx);
}

async function saveLocal(track, blob) {
  const type = blob.type && blob.type.startsWith("audio/") ? blob.type : mimeFor(track.mediaRef || "", "");
  const stored = blob.type === type ? blob : new Blob([await blob.arrayBuffer()], { type });
  fileBlobs.set(track.id, stored);
  prepareURL(track.id, stored);
  const db = await openDB();
  const tx = db.transaction(["tracks", "files"], "readwrite");
  tx.objectStore("tracks").put(track);
  tx.objectStore("files").put({ id: track.id, blob: stored });
  await transactionDone(tx);
}

async function getBlob(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readonly");
    const request = tx.objectStore("files").get(id);
    request.onsuccess = () => resolve(request.result ? request.result.blob : null);
    request.onerror = () => reject(request.error);
  });
}

async function deleteTrack(id) {
  fileBlobs.delete(id);
  const url = fileURLs.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    fileURLs.delete(id);
  }
  if (state.readyId === id) state.readyId = null;
  const db = await openDB();
  const tx = db.transaction(["tracks", "files"], "readwrite");
  tx.objectStore("tracks").delete(id);
  tx.objectStore("files").delete(id);
  await transactionDone(tx);
}
