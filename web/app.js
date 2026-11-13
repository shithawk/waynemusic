const state = {
  tracks: [],
  catalog: [],
  macError: "",
  currentId: null,
  playing: false,
  query: "",
  artistQuery: "",
  linkOpen: false,
  working: false,
  removeId: null,
  readyId: null,
  shuffle: false,
  shuffleOrder: [],
  shuffleIndex: -1,
  shuffleHistory: [],
  shuffleRewind: false,
  openArtists: new Set()
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
let ignoreAdvance = false;
let seekHold = false;
let seekBar = null;
let pendingSeek = null;
let lastSeekAt = 0;
let youtubeSearchToken = 0;
const downloading = new Set();

const audio = () => document.getElementById("audio");

document.addEventListener("DOMContentLoaded", init);

async function init() {
  document.getElementById("install-hint").hidden = standalone();
  state.shuffle = loadShuffle();
  bindEvents();
  bindMediaSession();
  audio().addEventListener("play", () => { if (isSource("local")) setPlaying(true); });
  audio().addEventListener("playing", () => {
    if (!isSource("local")) return;
    finishTrackChange();
    applyPendingSeek();
  });
  audio().addEventListener("loadedmetadata", () => { if (isSource("local")) applyPendingSeek(); });
  audio().addEventListener("timeupdate", () => { if (!seekHold && isSource("local")) refreshSeek(); });
  audio().addEventListener("pause", () => {
    if (isSource("local") && !audio().ended) setPlaying(false);
  });
  audio().addEventListener("ended", () => {
    const player = audio();
    if (!shouldAdvance() || !isSource("local")) return;
    if (!player.duration || player.currentTime + 0.75 < player.duration) return;
    step(1);
  });
  try {
    state.tracks = sortTracks(await allTracks());
    await fixSavedYouTubeArtists();
  } catch {
    setNotice("This iPad could not open saved songs. Leave private browsing, then add Wayne's Music to the Home Screen.");
  }
  if (state.shuffle) startShuffle(state.currentId);
  render();
  refreshSavedLinks();
  requestPersist();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  setInterval(() => {
    if (!state.currentId || seekHold) return;
    if (pendingSeek) applyPendingSeek();
    refreshSeek();
  }, 400);
}

function bindEvents() {
  document.getElementById("home").addEventListener("click", goHome);
  document.getElementById("artists").addEventListener("click", openArtists);
  document.getElementById("songs-nav").addEventListener("click", showSongs);
  document.getElementById("videos-nav").addEventListener("click", openVideos);
  document.getElementById("video-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-play]");
    if (button) playListed(button.dataset.play);
  });
  document.getElementById("youtube-search-go").addEventListener("click", searchYouTube);
  document.getElementById("youtube-search").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchYouTube();
    }
  });
  document.getElementById("youtube-results").addEventListener("click", (event) => {
    const play = event.target.closest("[data-play]");
    if (play) {
      playListed(play.dataset.play);
      return;
    }
    const button = event.target.closest("[data-add-video]");
    if (!button || button.disabled) return;
    addYouTubeVideo(button.dataset.addVideo, button);
  });
  document.getElementById("artist-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-play]");
    if (button) {
      playListed(button.dataset.play);
      return;
    }
    const row = event.target.closest("[data-artist]");
    if (!row) return;
    const name = row.dataset.artist;
    if (state.openArtists.has(name)) state.openArtists.delete(name);
    else state.openArtists.add(name);
    renderArtists();
  });
  bindSeekBar(document.getElementById("seek"));
  document.addEventListener("pointermove", (event) => {
    if (!seekHold || !seekBar) return;
    scrub(seekBar, event, false);
  });
  document.addEventListener("pointerup", finishSeek);
  document.addEventListener("pointercancel", finishSeek);
  document.getElementById("add-music").addEventListener("click", openAdd);
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
  document.getElementById("find-artist").addEventListener("input", (event) => {
    state.artistQuery = event.target.value;
    renderArtists();
  });
  document.getElementById("clear-artist-search").addEventListener("click", () => {
    const input = document.getElementById("find-artist");
    input.value = "";
    state.artistQuery = "";
    renderArtists();
    input.focus();
  });
  document.getElementById("song-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-play]");
    if (!button) return;
    playListed(button.dataset.play);
  });
  document.getElementById("catalog-list").addEventListener("click", (event) => {
    const saved = event.target.closest("[data-play-saved]");
    if (saved) {
      playSaved(saved.dataset.playSaved);
      return;
    }
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
  document.getElementById("now-bar").addEventListener("click", () => {
    const track = currentTrack();
    if (track && track.source !== "local") openPlayer();
    else showSongList();
  });
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
  renderCatalog();
  renderArtists();
  renderVideos();
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
    const currentSong = track.id === state.currentId;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "song" + (currentSong ? " current" : "");
    button.dataset.play = track.id;
    const title = document.createElement("span");
    title.className = "song-title";
    title.textContent = track.title;
    const sub = document.createElement("span");
    sub.className = "song-sub";
    sub.textContent = (currentSong && state.playing ? "Playing · " : "") + subtitle(track);
    button.append(title, sub);
    list.append(button);
  }
  const current = currentTrack();
  document.getElementById("now-stack").hidden = !current;
  document.body.classList.toggle("has-now", Boolean(current));
  const label = current ? nowLabel(current) : "";
  document.getElementById("now-bar-title").textContent = label ? "Now Playing: " + label : "";
  const bar = document.getElementById("now-bar");
  bar.setAttribute("aria-label", label ? (state.playing ? "Now playing: " : "Paused: ") + label : "Now playing");
  if (current) refreshSeek();
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

function bindSeekBar(bar) {
  if (!bar) return;
  bar.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    seekHold = true;
    seekBar = bar;
    try { bar.setPointerCapture(event.pointerId); } catch { /* The bar can be rebuilt while a finger is down. */ }
    scrub(bar, event, false);
  });
  bar.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const id = bar.dataset.seek || state.currentId;
    const track = state.tracks.find((item) => item.id === id);
    if (!track) return;
    event.preventDefault();
    const now = Number(bar.getAttribute("aria-valuenow")) || 0;
    const next = Math.min(100, Math.max(0, now + (event.key === "ArrowRight" ? 5 : -5)));
    commitSeek(track, next / 100, true);
  });
}

function finishSeek(event) {
  if (!seekHold || !seekBar) return;
  scrub(seekBar, event, true);
  seekHold = false;
  seekBar = null;
}

function scrub(bar, event, force) {
  const id = bar.dataset.seek || state.currentId;
  const track = state.tracks.find((item) => item.id === id);
  if (!track) return;
  const ratio = ratioFrom(bar, event);
  if (track.id !== state.currentId) {
    if (!force) return;
    pendingSeek = { id: track.id, ratio };
    userPlay(track, track.source !== "local");
    return;
  }
  commitSeek(track, ratio, force || track.source === "local");
}

function ratioFrom(bar, event) {
  const rect = bar.getBoundingClientRect();
  const pad = 22;
  const span = Math.max(1, rect.width - pad * 2);
  return Math.min(1, Math.max(0, (event.clientX - rect.left - pad) / span));
}

function commitSeek(track, ratio, force) {
  ratio = Math.min(1, Math.max(0, ratio));
  if (track.source === "local") {
    const player = audio();
    const duration = player.duration;
    if (!duration || !Number.isFinite(duration)) {
      pendingSeek = { id: track.id, ratio };
      return;
    }
    player.currentTime = ratio * duration;
    pendingSeek = null;
    paintSeek(player.currentTime, duration);
    return;
  }
  if (track.source === "youtube" && ytPlayer && ytPlayer.seekTo && ytPlayer.getDuration) {
    let duration = 0;
    try { duration = Number(ytPlayer.getDuration()) || 0; } catch { duration = 0; }
    if (!duration) {
      pendingSeek = { id: track.id, ratio };
      return;
    }
    paintSeek(ratio * duration, duration);
    const now = Date.now();
    if (!force && now - lastSeekAt < 200) {
      pendingSeek = { id: track.id, ratio };
      return;
    }
    lastSeekAt = now;
    try { ytPlayer.seekTo(ratio * duration, true); } catch { /* The video is not ready yet. */ }
    pendingSeek = null;
    return;
  }
  if (track.source === "soundcloud" && scWidget && scWidget.getDuration) {
    scWidget.getDuration((ms) => {
      const current = currentTrack();
      if (!current || current.id !== track.id || !isSource("soundcloud")) return;
      const duration = (Number(ms) || 0) / 1000;
      if (!duration) {
        pendingSeek = { id: track.id, ratio };
        return;
      }
      paintSeek(ratio * duration, duration);
      const now = Date.now();
      if (!force && now - lastSeekAt < 200) {
        pendingSeek = { id: track.id, ratio };
        return;
      }
      lastSeekAt = now;
      try { scWidget.seekTo(Math.round(ratio * duration * 1000)); } catch { /* The widget is not ready yet. */ }
      pendingSeek = null;
    });
    return;
  }
  pendingSeek = { id: track.id, ratio };
}

function applyPendingSeek() {
  const pending = pendingSeek;
  const track = currentTrack();
  if (!pending || !track || pending.id !== track.id || seekHold) return;
  commitSeek(track, pending.ratio, true);
}

function refreshSeek() {
  if (seekHold) return;
  const track = currentTrack();
  if (!track) return;
  if (track.source === "local") {
    const player = audio();
    paintSeek(player.currentTime || 0, Number.isFinite(player.duration) ? player.duration : 0);
    return;
  }
  if (track.source === "youtube" && ytPlayer && ytPlayer.getCurrentTime) {
    try {
      paintSeek(Number(ytPlayer.getCurrentTime()) || 0, Number(ytPlayer.getDuration()) || 0);
    } catch { /* The video is not ready yet. */ }
    return;
  }
  if (track.source === "soundcloud" && scWidget && scWidget.getPosition) {
    scWidget.getPosition((ms) => {
      if (seekHold || !isSource("soundcloud")) return;
      scWidget.getDuration((dur) => {
        if (seekHold || !isSource("soundcloud")) return;
        paintSeek((Number(ms) || 0) / 1000, (Number(dur) || 0) / 1000);
      });
    });
  }
}

function paintSeek(elapsed, duration) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeElapsed = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
  const ratio = safeDuration ? Math.min(1, Math.max(0, safeElapsed / safeDuration)) : 0;
  const place = "calc(22px + (100% - 44px) * " + ratio + ")";
  for (const fill of document.querySelectorAll(".seek-fill")) fill.style.width = place;
  for (const thumb of document.querySelectorAll(".seek-thumb")) thumb.style.left = place;
  const elapsedText = clock(safeDuration ? ratio * safeDuration : safeElapsed);
  const totalText = safeDuration ? clock(safeDuration) : "0:00";
  for (const el of document.querySelectorAll(".seek-elapsed")) el.textContent = elapsedText;
  for (const el of document.querySelectorAll(".seek-total")) el.textContent = totalText;
  const value = String(Math.round(ratio * 100));
  const text = elapsedText + " of " + totalText;
  for (const bar of document.querySelectorAll(".seek")) {
    bar.setAttribute("aria-valuenow", value);
    bar.setAttribute("aria-valuetext", text);
  }
}

function clock(seconds) {
  const whole = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remain = whole % 60;
  const paddedMinutes = hours ? String(minutes).padStart(2, "0") : String(minutes);
  const paddedSeconds = String(remain).padStart(2, "0");
  return hours ? hours + ":" + paddedMinutes + ":" + paddedSeconds : paddedMinutes + ":" + paddedSeconds;
}

function playListed(id) {
  const track = state.tracks.find((item) => item.id === id);
  if (!track) return;
  if (track.source !== "local") {
    hideSheet("artists-sheet");
    hideSheet("videos-sheet");
  }
  if (track.id === state.currentId && state.playing) {
    if (track.source !== "local") openPlayer();
    return;
  }
  userPlay(track, track.source !== "local");
}

function openArtists() {
  hideSheet("add-sheet");
  hideSheet("manage-sheet");
  hideSheet("videos-sheet");
  hideConfirm();
  closePlayer();
  showSheet("artists-sheet");
  renderArtists();
}

function openVideos() {
  hideSheet("add-sheet");
  hideSheet("manage-sheet");
  hideSheet("artists-sheet");
  hideConfirm();
  closePlayer();
  showSheet("videos-sheet");
  renderVideos();
}

function renderVideos() {
  const sheet = document.getElementById("videos-sheet");
  if (!sheet || sheet.hidden) return;
  const list = document.getElementById("video-list");
  const scroller = list.closest(".sheet-body");
  const scrollTop = scroller ? scroller.scrollTop : 0;
  const videos = state.tracks
    .filter((track) => track.source === "youtube" || track.source === "soundcloud")
    .sort((a, b) => (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base", numeric: true }));
  list.replaceChildren();
  document.getElementById("videos-empty").hidden = videos.length > 0;
  for (const track of videos) {
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
  if (scroller) scroller.scrollTop = scrollTop;
}

function setVideoSearchStatus(text) {
  const status = document.getElementById("youtube-search-status");
  status.hidden = !text;
  status.textContent = text || "";
}

async function searchYouTube() {
  const query = document.getElementById("youtube-search").value.trim();
  const token = ++youtubeSearchToken;
  if (!query) {
    setVideoSearchStatus("Type a song or artist.");
    return;
  }
  setVideoSearchStatus("Searching…");
  document.getElementById("youtube-results").replaceChildren();
  try {
    const response = await fetch("https://yt.chocolatemoo53.com/api/v1/search?type=video&q=" + encodeURIComponent(query));
    if (!response.ok) throw new Error("search failed");
    const payload = await response.json();
    if (token !== youtubeSearchToken) return;
    const results = youtubeSearchResults(payload);
    if (!results.length) {
      setVideoSearchStatus("No videos found. Try another word.");
      return;
    }
    setVideoSearchStatus("");
    renderYouTubeResults(results);
  } catch {
    if (token !== youtubeSearchToken) return;
    setVideoSearchStatus("YouTube search did not work. Try again.");
  }
}

function renderYouTubeResults(results) {
  const list = document.getElementById("youtube-results");
  list.replaceChildren();
  for (const video of results) {
    const saved = youtubeTrack(video.id);
    const row = document.createElement("div");
    row.className = "catalog-row" + (saved ? " saved" : "");
    const text = document.createElement(saved ? "button" : "div");
    text.className = saved ? "catalog-play" : "text";
    if (saved) {
      text.type = "button";
      text.dataset.play = saved.id;
    }
    const title = document.createElement("span");
    title.className = "song-title";
    title.textContent = video.title;
    const sub = document.createElement("span");
    sub.className = "song-sub";
    sub.textContent = video.artist ? video.artist + " · YouTube" : "YouTube";
    text.append(title, sub);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "download";
    if (saved) markYouTubePlay(button, saved);
    else {
      button.dataset.addVideo = video.id;
      button.dataset.videoTitle = video.title;
      button.dataset.videoArtist = video.artist;
      button.textContent = "Add";
    }
    row.append(text, button);
    list.append(row);
  }
}

function youtubeTrack(id) {
  return state.tracks.find((track) => track.source === "youtube" && track.mediaRef === id) || null;
}

function markYouTubePlay(button, track) {
  button.className = "download";
  button.disabled = false;
  delete button.dataset.addVideo;
  button.dataset.play = track.id;
  button.textContent = track.id === state.currentId && state.playing ? "Playing" : "Play";
  const row = button.closest(".catalog-row");
  if (row) row.classList.add("saved");
}

async function addYouTubeVideo(id, button) {
  const title = (button.dataset.videoTitle || "YouTube video").trim();
  const artist = (button.dataset.videoArtist || "").trim();
  button.disabled = true;
  button.textContent = "Adding…";
  try {
    if (state.tracks.some((track) => track.source === "youtube" && track.mediaRef === id)) {
      throw new Error("That video is already in the list.");
    }
    const track = {
      id: "youtube:" + id,
      title: title,
      artist: artist,
      source: "youtube",
      mediaRef: id,
      bytes: 0,
      createdAt: Date.now()
    };
    await putTrack(track);
    state.tracks = sortTracks(state.tracks.concat(track));
    const row = button.closest(".catalog-row");
    const text = row && row.querySelector(".text");
    if (text) {
      const playTitle = document.createElement("button");
      playTitle.type = "button";
      playTitle.className = "catalog-play";
      playTitle.dataset.play = track.id;
      while (text.firstChild) playTitle.append(text.firstChild);
      text.replaceWith(playTitle);
    }
    markYouTubePlay(button, track);
    renderVideos();
    setNotice("Added " + title);
  } catch (error) {
    const already = youtubeTrack(id);
    if (already) {
      markYouTubePlay(button, already);
      return;
    }
    button.disabled = false;
    button.textContent = "Add";
    setVideoSearchStatus(error.message || "That video could not be added.");
  }
}

function youtubeSearchResults(payload) {
  if (!Array.isArray(payload)) return [];
  const found = [];
  const seen = new Set();
  for (const item of payload) {
    if (!item || item.type !== "video" || !sanitizeYouTubeID(item.videoId) || seen.has(item.videoId)) continue;
    seen.add(item.videoId);
    const named = youtubeNames(item.title, item.author);
    found.push({
      id: item.videoId,
      title: named.title,
      artist: named.artist
    });
    if (found.length >= 10) break;
  }
  return found;
}

function artistNames(track) {
  const parts = (track.artist || "").split(",").map((name) => name.trim()).filter(Boolean);
  return parts.length ? parts : ["Unknown"];
}

function renderArtists() {
  const sheet = document.getElementById("artists-sheet");
  if (!sheet || sheet.hidden) return;
  const list = document.getElementById("artist-list");
  const scroller = list.closest(".sheet-body");
  const scrollTop = scroller ? scroller.scrollTop : 0;
  const groups = new Map();
  for (const track of state.tracks) {
    for (const name of artistNames(track)) {
      const key = name.toLocaleLowerCase();
      if (!groups.has(key)) groups.set(key, { name, tracks: [] });
      const group = groups.get(key);
      if (!group.tracks.some((item) => item.id === track.id)) group.tracks.push(track);
    }
  }
  const query = state.artistQuery.trim().toLowerCase();
  const artists = [...groups.values()]
    .filter((group) => !query || group.name.toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  list.replaceChildren();
  document.getElementById("artist-finder").hidden = groups.size === 0;
  document.getElementById("artists-empty").hidden = groups.size > 0;
  document.getElementById("clear-artist-search").hidden = query.length === 0;
  if (groups.size > 0 && artists.length === 0) {
    const empty = document.createElement("p");
    empty.className = "search-empty";
    empty.textContent = "No artist matches that. Try another word.";
    list.append(empty);
  }
  for (const group of artists) {
    group.tracks.sort((a, b) => (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base", numeric: true }));
    const open = state.openArtists.has(group.name);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "artist-row" + (open ? " open" : "");
    row.dataset.artist = group.name;
    row.setAttribute("aria-expanded", open ? "true" : "false");
    const title = document.createElement("span");
    title.className = "song-title";
    title.textContent = group.name;
    const sub = document.createElement("span");
    sub.className = "song-sub";
    const count = group.tracks.length === 1 ? "1 song" : group.tracks.length + " songs";
    sub.textContent = count + (open ? " · Tap to hide" : " · Tap to show");
    row.append(title, sub);
    list.append(row);
    if (!open) continue;
    const songs = document.createElement("div");
    songs.className = "artist-songs";
    for (const track of group.tracks) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "song" + (track.id === state.currentId ? " current" : "");
      button.dataset.play = track.id;
      const songTitle = document.createElement("span");
      songTitle.className = "song-title";
      songTitle.textContent = track.title;
      const songSub = document.createElement("span");
      songSub.className = "song-sub";
      songSub.textContent = (track.id === state.currentId && state.playing ? "Playing · " : "") + subtitle(track);
      button.append(songTitle, songSub);
      songs.append(button);
    }
    list.append(songs);
  }
  if (scroller) scroller.scrollTop = scrollTop;
}

function nowLabel(track) {
  const title = (track.title || "").trim();
  const artist = (track.artist || "").trim();
  if (title && artist) return title + " - " + artist;
  return title || artist;
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
  if (isSource("youtube")) requestAnimationFrame(fitYouTube);
}

function closePlayer() {
  const player = document.getElementById("player");
  player.classList.remove("open");
  player.inert = true;
  player.setAttribute("aria-hidden", "true");
}

function showSongList() {
  closePlayer();
  const songs = document.getElementById("songs");
  const current = document.querySelector("#song-list .song.current");
  if (!songs || !current) return;
  const limit = songs.getBoundingClientRect().bottom - 16;
  const rect = current.getBoundingClientRect();
  if (rect.bottom > limit) songs.scrollTop += rect.bottom - limit;
  else if (rect.top < songs.getBoundingClientRect().top + 12) {
    songs.scrollTop -= songs.getBoundingClientRect().top + 12 - rect.top;
  }
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
  if (!document.getElementById("add-sheet").hidden) renderCatalog();
  if (!document.getElementById("artists-sheet").hidden) renderArtists();
  if (!document.getElementById("videos-sheet").hidden) renderVideos();
}

function setNotice(text) {
  const el = document.getElementById("notice");
  el.textContent = text;
  el.hidden = !text;
  clearTimeout(noticeTimer);
  if (text) noticeTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

function showSongs() {
  hideSheet("add-sheet");
  hideSheet("manage-sheet");
  hideSheet("artists-sheet");
  hideSheet("videos-sheet");
  hideConfirm();
  closePlayer();
  document.body.classList.add("songs-page");
  document.getElementById("songs").scrollTop = 0;
}

function goHome() {
  hideSheet("add-sheet");
  hideSheet("manage-sheet");
  hideSheet("artists-sheet");
  hideSheet("videos-sheet");
  hideConfirm();
  closePlayer();
  document.body.classList.remove("songs-page");
  const input = document.getElementById("find-song");
  if (state.query || input.value) {
    input.value = "";
    state.query = "";
    renderSongs();
  }
  document.getElementById("songs").scrollTop = 0;
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
  const scroller = list.closest(".sheet-body");
  const scrollTop = scroller ? scroller.scrollTop : 0;
  list.replaceChildren();
  const savedCount = state.catalog.filter((entry) => savedOnIpad(entry)).length;
  if (state.macError) {
    status.textContent = state.macError;
  } else if (state.catalog.length === 0) {
    status.textContent = "No songs on the computer yet.";
  } else if (savedCount === 0) {
    status.textContent = "Tap Download to put a song on this iPad.";
  } else {
    status.textContent = "Yellow songs are on this iPad. Tap Play.";
  }
  for (const entry of state.catalog) {
    const already = savedOnIpad(entry);
    const savedTrack = already ? trackForFile(entry.file) : null;
    const playing = Boolean(savedTrack && savedTrack.id === state.currentId && state.playing);
    const row = document.createElement("div");
    row.className = "catalog-row" + (already ? " saved" : "");
    const text = document.createElement(already ? "button" : "div");
    text.className = already ? "catalog-play" : "text";
    if (already) {
      text.type = "button";
      text.dataset.playSaved = entry.file;
    }
    const title = document.createElement("span");
    title.className = "song-title";
    title.textContent = entry.title;
    const sub = document.createElement("span");
    sub.className = "song-sub";
    sub.textContent = [entry.artist, formatBytes(entry.bytes)].filter(Boolean).join(" · ");
    text.append(title, sub);
    const button = document.createElement("button");
    button.type = "button";
    if (already) {
      button.className = "download play-ready";
      button.dataset.playSaved = entry.file;
      button.textContent = playing ? "Playing" : "Play";
    } else {
      button.className = "download";
      button.dataset.download = entry.file;
      button.disabled = downloading.has(entry.file);
      button.textContent = downloading.has(entry.file) ? "Downloading…" : "Download";
    }
    row.append(text, button);
    list.append(row);
  }
  const pending = state.catalog.filter((entry) => !savedOnIpad(entry));
  const downloadAll = document.getElementById("download-all");
  downloadAll.hidden = pending.length === 0;
  downloadAll.disabled = state.working || pending.length === 0;
  if (scroller) scroller.scrollTop = scrollTop;
}

function trackForFile(file) {
  return state.tracks.find((track) => track.source === "local" && track.mediaRef === file) || null;
}

function playSaved(file) {
  const track = trackForFile(file);
  if (!track) return;
  if (track.id === state.currentId && state.playing) return;
  userPlay(track, false);
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
  if (count > 0) setNotice(count === 1 ? "1 song is yellow. Tap Play." : count + " songs are yellow. Tap Play.");
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
  if (saved && announce) setNotice(savedTitle + " is yellow. Tap Play.");
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
    const videoTitle = String(payload.title || "").trim();
    const channel = String(payload.author_name || "").trim();
    if (parsed.source === "youtube") return youtubeNames(videoTitle, channel);
    return { title: videoTitle || fallback, artist: channel };
  } catch {
    return { title: fallback, artist: "" };
  }
}

function youtubeNames(videoTitle, channel) {
  const raw = String(videoTitle || "").replace(/\s+/g, " ").trim();
  if (!raw) return { title: "YouTube video", artist: "" };
  const quoted = raw.match(/^(.+?)\s+["“]([^"”]+)["”]/);
  if (quoted) {
    const artist = tidyName(quoted[1]);
    const title = tidyName(quoted[2]);
    if (artist && title) return { title: title, artist: artist };
  }
  const byline = raw.match(/^(.+?)\s+\bby\b\s+(.+)$/i);
  if (byline) {
    const title = tidyName(byline[1].split(/\s+[|]\s+/)[0]);
    const artist = tidyName(byline[2].split(/\s+[|]\s+/)[0]);
    if (title && artist) return { title: title, artist: artist };
  }
  const pieces = raw.split(/\s+[-–—]\s+/);
  if (pieces.length >= 2) {
    const left = tidyName(pieces[0]);
    const right = tidyName(pieces[1].split(/\s+[|(]\s+/)[0]);
    if (left && right) {
      const channelName = tidyName(channel).toLowerCase();
      if (channelName && right.toLowerCase() === channelName) return { title: left, artist: right };
      return { title: right, artist: left };
    }
  }
  return {
    title: tidyName(raw.split(/\s+[|]\s+/)[0]) || "YouTube video",
    artist: tidyName(channel)
  };
}

function tidyName(value) {
  return String(value || "").replace(/\s+/g, " ").replace(/^[\s\-–—|]+|[\s\-–—|]+$/g, "").trim();
}

async function fixSavedYouTubeArtists() {
  let changed = false;
  for (const track of state.tracks) {
    if (track.source !== "youtube") continue;
    const named = youtubeNames(track.title, track.artist);
    if (!named.title || (named.title === track.title && named.artist === track.artist)) continue;
    track.title = named.title;
    track.artist = named.artist;
    changed = true;
    try {
      await putTrack(track);
    } catch { /* The corrected name still shows for this visit. */ }
  }
  if (changed) state.tracks = sortTracks(state.tracks);
}

function needsMeta(track) {
  const title = (track.title || "").trim();
  return !title || !String(track.artist || "").trim() || title === "YouTube video" || title === "SoundCloud song";
}

async function refreshSavedLinks() {
  const pending = state.tracks.filter(needsMeta);
  if (!pending.length) return;
  let changed = false;
  for (const track of pending) {
    if (track.source !== "youtube" && track.source !== "soundcloud") continue;
    const pageURL = track.source === "youtube" ? "https://www.youtube.com/watch?v=" + track.mediaRef : track.mediaRef;
    const meta = await fetchOEmbed({ source: track.source, pageURL: pageURL });
    if (!meta.title || meta.title === "YouTube video" || meta.title === "SoundCloud song") continue;
    if (meta.title === track.title && meta.artist === track.artist) continue;
    track.title = meta.title;
    track.artist = meta.artist;
    try {
      await putTrack(track);
      changed = true;
    } catch { /* The name still shows for this visit. */ }
  }
  if (!changed) return;
  state.tracks = sortTracks(state.tracks);
  render();
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

function youtubeActuallyEnded(event) {
  if (!shouldAdvance() || !isSource("youtube")) return false;
  const current = currentTrack();
  if (!current) return false;
  try {
    const playingId = event.target && event.target.getVideoData ? event.target.getVideoData().video_id : "";
    if (playingId && playingId !== current.mediaRef) return false;
  } catch { /* Keep the button state if the player is not ready. */ }
  return true;
}

function beginTrackChange() {
  ignoreAdvance = true;
}

function finishTrackChange() {
  ignoreAdvance = false;
}

function shouldAdvance() {
  return !ignoreAdvance;
}

async function playTrack(track, options) {
  beginTrackChange();
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
    if (track.source === "local") showSongList();
    else if (open) openPlayer();
    finishTrackChange();
    render();
    if (track.source === "local") showSongList();
    return;
  }
  state.currentId = track.id;
  const player = audio();
  const started = track.source === "local" && player.src === fileURLs.get(track.id) && !player.paused && !player.error;
  state.playing = Boolean(started);
  if (track.source === "local") closePlayer();
  else if (open) openPlayer();
  publishSession(track);
  render();
  if (track.source === "local") showSongList();
  try {
    if (track.source === "local") await playLocal(track);
    else if (track.source === "youtube") playYouTube(track);
    else await playSoundCloud(track);
  } catch {
    finishTrackChange();
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
  beginTrackChange();
  pauseYouTube();
  pauseSoundCloud();
  const show = Boolean(open || track.source !== "local");
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
    finishTrackChange();
    if (show) openPlayer();
    else showSongList();
    return;
  }
  playTrack(track, { open: show });
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
      finishTrackChange();
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
    finishTrackChange();
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
    fitYouTube();
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
  scWidget.bind(window.SC.Widget.Events.PLAY, () => {
    if (!isSource("soundcloud")) return;
    finishTrackChange();
    setPlaying(true);
    applyPendingSeek();
  });
  scWidget.bind(window.SC.Widget.Events.PAUSE, () => { if (isSource("soundcloud")) setPlaying(false); });
  scWidget.bind(window.SC.Widget.Events.FINISH, () => {
    if (isSource("soundcloud") && shouldAdvance()) step(1);
  });
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
    playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 1, fs: 1, iv_load_policy: 3 },
    events: {
      onReady: () => {
        ytReady = true;
        allowYouTubeFullscreen();
        fitYouTube();
        if (pendingVideo && isSource("youtube")) {
          ytPlayer.loadVideoById(pendingVideo);
          ytPlayer.playVideo();
        }
      },
      onStateChange: (event) => {
        if (!isSource("youtube") || !window.YT) return;
        if (event.data === YT.PlayerState.PLAYING) {
          finishTrackChange();
          setPlaying(true);
          applyPendingSeek();
        }
        if (event.data === YT.PlayerState.PAUSED) setPlaying(false);
        if (event.data === YT.PlayerState.ENDED && youtubeActuallyEnded(event)) step(1);
      },
      onError: () => {
        finishTrackChange();
        setNotice("That video could not be played.");
      }
    }
  });
};

function allowYouTubeFullscreen() {
  const frame = ytPlayer && ytPlayer.getIframe ? ytPlayer.getIframe() : document.getElementById("yt-player");
  if (!frame || frame.tagName !== "IFRAME") return;
  frame.setAttribute("allowfullscreen", "");
  frame.setAttribute("webkitallowfullscreen", "");
  const allow = new Set((frame.getAttribute("allow") || "").split(";").map((part) => part.trim()).filter(Boolean));
  allow.add("fullscreen");
  frame.setAttribute("allow", [...allow].join("; "));
}

function fitYouTube() {
  const stage = document.getElementById("stage-yt");
  if (!ytPlayer || !ytPlayer.setSize || !stage) return;
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  if (width > 0 && height > 0) ytPlayer.setSize(width, height);
}

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
  playTrack(track, { open: playerIsOpen() || track.source !== "local" });
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
    if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
    else if (ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo();
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
