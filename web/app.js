const DEFAULT_FAMILY_THEME = "jori";
const FAMILY_THEME_META = {
  jori: "#121a32",
  wayne: "#0d0d0d",
  jacob: "#1e2329",
  dan: "#1c2a34",
  steff: "#2d1f3d",
  zero: "#0a0a0a"
};
const FAMILY_THEME_STORAGE = "family-theme";

const state = {
  tracks: [],
  catalog: [],
  macError: "",
  currentId: null,
  playing: false,
  query: "",
  searchQuery: "",
  artistQuery: "",
  working: false,
  removeId: null,
  readyId: null,
  shuffle: false,
  shuffleOrder: [],
  shuffleIndex: -1,
  shuffleHistory: [],
  shuffleRewind: false,
  openArtists: new Set(),
  openSearchArtists: new Set(),
  artistQueue: null,
  catalogSessionDownloads: new Set()
};

let zeroPlayPhase = 0;

let dbPromise = null;
const fileBlobs = new Map();
const fileURLs = new Map();
const artBlobs = new Map();
const artURLs = new Map();
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

function localPreviewIPhone() {
  const h = location.hostname;
  const local = h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  if (!local) return false;
  const q = new URLSearchParams(location.search);
  return q.get("iphone") === "1" || q.get("phone") === "1";
}

function isAndroidPhone() {
  const ua = navigator.userAgent;
  return /Android/i.test(ua) && /Mobile/i.test(ua);
}

function isIPadLike() {
  const ua = navigator.userAgent;
  return /iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** Compact phone UI (html.iphone) — not the same as deviceLabel / install copy. */
function compactPhoneLayout() {
  if (localPreviewIPhone()) return true;
  const ua = navigator.userAgent;
  if (/iPhone|iPod/.test(ua)) return true;
  if (isAndroidPhone()) return true;
  if (isIPadLike()) return false;
  if (typeof matchMedia !== "undefined" && matchMedia("(max-width: 540px) and (pointer: coarse)").matches) {
    return true;
  }
  return false;
}

function deviceKind() {
  if (localPreviewIPhone()) return "iphone";
  const ua = navigator.userAgent;
  if (/iPhone|iPod/.test(ua)) return "iphone";
  if (isIPadLike()) return "ipad";
  return "other";
}

function deviceLabel() {
  const k = deviceKind();
  if (k === "iphone") return "iPhone";
  if (k === "ipad") return "iPad";
  return "device";
}

function onThisDevice() {
  const k = deviceKind();
  if (k === "other") return "on this device";
  return "on this " + deviceLabel();
}

function applyDeviceCopy() {
  const on = onThisDevice();
  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  set(
    "install-hint-text",
    deviceKind() === "iphone"
      ? "Install Jori's Music: in Safari, tap Share at the bottom of the screen, then Add to Home Screen."
      : "Install Jori's Music: tap Share, then Add to Home Screen."
  );
  set("empty", "Tap + Add music to put songs " + on + ".");
  set("from-ipad", "Add a song saved on this device");
  set("manage-lede", "This takes a song off this " + deviceLabel() + ".");
  set("confirm-title", "Remove from this " + deviceLabel() + "?");
  set("artists-empty", "No songs " + on + " yet.");
  set("videos-local-heading", "Stream");
  set("videos-empty", "No videos " + on + " yet.");
  const hintSub = document.querySelector("#install-hint .hint-sub");
  if (hintSub) hintSub.hidden = deviceKind() !== "iphone";
  document.documentElement.classList.toggle("iphone", compactPhoneLayout());
  document.documentElement.classList.toggle("ipad", deviceKind() === "ipad");
  updateShuffleButton();
  updateZeroPlayButton();
}
let ytPlayer = null;
let ytReady = false;
let pendingVideo = "";
let pendingYtPlay = false;
let pendingYtVideo = "";
let scWidget = null;
let streamingWatchdog = null;
let streamingHold = false;
let noticeTimer = 0;
let noticeActionURL = "";
let ignoreAdvance = false;
let seekHold = false;
let seekBar = null;
let pendingSeek = null;
let lastSeekAt = 0;
let youtubeSearchToken = 0;
let youtubeHasSearched = false;
let linkConfirmId = "";
const downloading = new Set();

const SW_BUILD = "41";

const MARQUEE_PAUSE_S = 3;
const MARQUEE_HOLD_END_S = 3;
const MARQUEE_PX_PER_S = 40;
const marqueeHosts = new WeakMap();
const marqueeText = new WeakMap();

function ensureMarqueeHost(host) {
  if (!host) return null;
  let inner = host.querySelector(":scope > .text-marquee > .text-marquee-inner");
  if (!inner) {
    host.classList.add("text-marquee-host");
    const viewport = document.createElement("div");
    viewport.className = "text-marquee";
    inner = document.createElement("div");
    inner.className = "text-marquee-inner";
    viewport.appendChild(inner);
    host.replaceChildren(viewport);
    const ro = new ResizeObserver(() => refreshMarquee(host));
    ro.observe(viewport);
    marqueeHosts.set(host, ro);
  }
  return inner;
}

function refreshMarquee(host) {
  const viewport = host?.querySelector(":scope > .text-marquee");
  const inner = viewport?.querySelector(".text-marquee-inner");
  if (!viewport || !inner) return;
  inner.getAnimations().forEach((a) => a.cancel());
  if (!inner.textContent.trim()) {
    inner.style.transform = "";
    return;
  }
  void viewport.offsetWidth;
  const overflow = inner.scrollWidth - viewport.clientWidth;
  if (overflow <= 1) {
    inner.style.transform = "";
    return;
  }
  const shift = -overflow;
  const scrollS = Math.max(3, overflow / MARQUEE_PX_PER_S);
  const total = MARQUEE_PAUSE_S + scrollS + MARQUEE_HOLD_END_S;
  const oPause = MARQUEE_PAUSE_S / total;
  const oScroll = (MARQUEE_PAUSE_S + scrollS) / total;
  const oHold = (MARQUEE_PAUSE_S + scrollS + MARQUEE_HOLD_END_S) / total;
  inner.animate(
    [
      { transform: "translateX(0)", offset: 0 },
      { transform: "translateX(0)", offset: oPause },
      { transform: `translateX(${shift}px)`, offset: oScroll },
      { transform: `translateX(${shift}px)`, offset: oHold },
      { transform: "translateX(0)", offset: 1 },
    ],
    { duration: total * 1000, iterations: Infinity, easing: "ease-in-out" },
  );
}

function setMarqueeText(host, text) {
  if (!host) return;
  const next = text || "";
  if (marqueeText.get(host) === next) return;
  marqueeText.set(host, next);
  const inner = ensureMarqueeHost(host);
  if (!inner) return;
  inner.textContent = next;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => refreshMarquee(host));
  });
}

function setNowBarMarquee(playing, songLabel) {
  const line = document.getElementById("now-bar-line");
  if (!line) return;
  const status = playing ? "Now playing" : "Paused";
  const cacheKey = status + "\0" + (songLabel || "");
  if (marqueeText.get(line) === cacheKey) return;
  marqueeText.set(line, cacheKey);
  const inner = ensureMarqueeHost(line);
  if (!inner) return;
  inner.replaceChildren();
  const statusSpan = document.createElement("span");
  statusSpan.className = "now-bar-status";
  statusSpan.textContent = status;
  inner.appendChild(statusSpan);
  if (songLabel) {
    const songSpan = document.createElement("span");
    songSpan.className = "now-bar-song";
    songSpan.textContent = " — " + songLabel;
    inner.appendChild(songSpan);
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => refreshMarquee(line));
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker
    .register("/sw.js?build=" + SW_BUILD, { updateViaCache: "none" })
    .then((reg) => {
      reg.update().catch(() => {});
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    })
    .catch(() => {});
}

const audio = () => document.getElementById("audio");

document.addEventListener("DOMContentLoaded", init);

async function init() {
  initFamilyTheme();
  applyDeviceCopy();
  window.addEventListener("resize", applyDeviceCopy);
  document.getElementById("install-hint").hidden = standalone();
  state.shuffle = loadShuffle();
  if (isZeroTheme()) {
    state.shuffle = false;
    saveShuffle();
    zeroPlayPhase = 0;
  }
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
  document.addEventListener("visibilitychange", () => {
    if (!streamingHold) return;
    resumeStreaming();
  });
  window.addEventListener("offline", () => {
    const track = currentTrack();
    if (shouldSkipStreamingTrack(track)) skipPastStreamingTracks(1);
  });
  try {
    state.tracks = sortTracks(await allTracks());
    await fixSavedYouTubeArtists();
  } catch {
    setNotice(
      "This " +
        deviceLabel() +
        " could not open saved songs. Leave private browsing, then add Jori's Music to the Home Screen."
    );
  }
  if (state.shuffle) startShuffle(state.currentId);
  render();
  refreshSavedLinks();
  requestPersist();
  registerServiceWorker();
  setInterval(() => {
    if (!state.currentId || seekHold) return;
    if (pendingSeek) applyPendingSeek();
    refreshSeek();
  }, 400);
}

function bindEvents() {
  document.getElementById("notice-action").addEventListener("click", () => {
    if (!noticeActionURL) return;
    window.open(noticeActionURL, "_blank", "noopener,noreferrer");
    clearNotice();
  });
  document.getElementById("home").addEventListener("click", goHome);
  document.getElementById("artists").addEventListener("click", () => openArtists());
  document.getElementById("songs-nav").addEventListener("click", showSongs);
  document.getElementById("videos-nav").addEventListener("click", openVideos);
  syncNavCurrent();
  document.getElementById("youtube-search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    searchYouTube();
  });
  document.getElementById("youtube-search").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    searchYouTube();
  });
  document.getElementById("youtube-search-icon").addEventListener("click", (event) => {
    event.preventDefault();
    document.getElementById("youtube-search").focus();
  });
  document.getElementById("youtube-clear-results").addEventListener("click", () => {
    clearYouTubeSearch();
  });
  document.getElementById("youtube-results").addEventListener("click", (event) => {
    const play = event.target.closest("[data-play]");
    if (play) {
      playListed(play.dataset.play);
      return;
    }
    const add = event.target.closest("[data-add-video]");
    if (!add || add.disabled) return;
    addYouTubeVideo(add.dataset.addVideo, add);
  });
  document.getElementById("video-list").addEventListener("click", (event) => {
    const fav = event.target.closest("[data-favorite]");
    if (fav) {
      event.preventDefault();
      event.stopPropagation();
      toggleFavorite(fav.dataset.favorite);
      return;
    }
    const row = event.target.closest(".song[data-play]");
    if (row) playListed(row.dataset.play);
  });
  document.getElementById("nav-search").addEventListener("submit", (event) => {
    event.preventDefault();
    showSearch();
  });
  document.getElementById("search-clear").addEventListener("click", clearSearch);
  document.getElementById("nav-search-icon").addEventListener("click", (event) => {
    event.preventDefault();
    focusNavSearch();
  });
  const navSearchInput = document.getElementById("nav-search-input");
  let navSearchSeen = navSearchInput.value;
  let navSearchWatch = 0;
  const syncNavSearch = () => {
    const value = navSearchInput.value;
    if (value === navSearchSeen) return;
    navSearchSeen = value;
    updateSearchClearButton();
    if (!value.trim() && !document.body.classList.contains("search-page")) return;
    showSearch({ typing: true });
  };
  navSearchInput.addEventListener("input", syncNavSearch);
  navSearchInput.addEventListener("input", updateSearchClearButton);
  navSearchInput.addEventListener("keyup", syncNavSearch);
  navSearchInput.addEventListener("search", syncNavSearch);
  navSearchInput.addEventListener("focus", () => {
    navSearchSeen = navSearchInput.value;
    window.clearTimeout(navSearchWatch);
    const watch = () => {
      syncNavSearch();
      if (document.activeElement === navSearchInput) navSearchWatch = window.setTimeout(watch, 150);
    };
    navSearchWatch = window.setTimeout(watch, 150);
  });
  updateSearchClearButton();
  navSearchInput.addEventListener("blur", () => window.clearTimeout(navSearchWatch));
  document.getElementById("nav-search-input").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    showSearch();
  });
  document.getElementById("search-results").addEventListener("click", (event) => {
    const fav = event.target.closest("[data-favorite]");
    if (fav) {
      event.preventDefault();
      event.stopPropagation();
      toggleFavorite(fav.dataset.favorite);
      return;
    }
    const playAll = event.target.closest("[data-play-all]");
    if (playAll) {
      playAllArtist(playAll.dataset.playAll);
      return;
    }
    const song = event.target.closest(".song[data-play]");
    if (song) {
      playListed(song.dataset.play);
      return;
    }
    const artist = event.target.closest("[data-artist-search]");
    if (!artist) return;
    const name = artist.dataset.artistSearch;
    if (state.openSearchArtists.has(name)) state.openSearchArtists.delete(name);
    else state.openSearchArtists.add(name);
    renderSearchResults();
  });
  document.getElementById("artist-list").addEventListener("click", (event) => {
    const playAll = event.target.closest("[data-play-all]");
    if (playAll) {
      playAllArtist(playAll.dataset.playAll);
      return;
    }
    const fav = event.target.closest("[data-favorite]");
    if (fav) {
      event.preventDefault();
      event.stopPropagation();
      toggleFavorite(fav.dataset.favorite);
      return;
    }
    const songRow = event.target.closest(".song[data-play]");
    if (songRow) {
      playListed(songRow.dataset.play);
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
  document.getElementById("close-manage").addEventListener("click", goHome);
  document.getElementById("download-all").addEventListener("click", downloadAll);
  document.getElementById("from-ipad").addEventListener("click", () => document.getElementById("file-input").click());
  document.getElementById("file-input").addEventListener("change", (event) => importFiles(event.target.files));
  document.getElementById("paste-link").addEventListener("click", pasteLink);
  document.getElementById("link-confirm-done").addEventListener("click", hideLinkConfirm);
  document.getElementById("link-confirm-play").addEventListener("click", playConfirmedLink);
  document.getElementById("add-link").addEventListener("click", () => addTypedLink());
  document.getElementById("link-input").addEventListener("input", () => {
    document.getElementById("add-link").disabled = !document.getElementById("link-input").value.trim();
  });
  document.getElementById("song-list").addEventListener("click", (event) => {
    const fav = event.target.closest("[data-favorite]");
    if (fav) {
      event.preventDefault();
      event.stopPropagation();
      toggleFavorite(fav.dataset.favorite);
      return;
    }
    const row = event.target.closest(".song[data-play]");
    if (!row) return;
    playListed(row.dataset.play);
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
  document.getElementById("now-favorite").addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const track = currentTrack();
    if (track) toggleFavorite(track.id);
  });
  document.getElementById("now-bar").addEventListener("click", () => {
    const track = currentTrack();
    if (track && track.source !== "local") openPlayer();
    else showSongList();
  });
  document.getElementById("play-favourites").addEventListener("click", playFavourites);
  document.getElementById("previous").addEventListener("click", () => skip(-1));
  document.getElementById("next").addEventListener("click", () => skip(1));
  document.getElementById("play-button").addEventListener("click", () => {
    if (isZeroTheme()) {
      zeroPlayButtonClick();
      return;
    }
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
  renderSearchResults();
  renderPlayer();
  updateShuffleButton();
  updateZeroPlayButton();
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
  if (hasTracks && visible.length === 0) {
    const empty = document.createElement("p");
    empty.className = "search-empty";
    empty.textContent = "No song matches that. Try another word.";
    list.append(empty);
  }
  for (const track of visible) list.append(songBox(track));
  const current = currentTrack();
  document.getElementById("now-stack").hidden = !current;
  document.body.classList.toggle("has-now", Boolean(current));
  const label = current ? nowLabel(current) : "";
  if (current) setNowBarMarquee(state.playing, label);
  const bar = document.getElementById("now-bar");
  bar.setAttribute("aria-label", label ? (state.playing ? "Now playing: " : "Paused: ") + label : "Now playing");
  document.getElementById("now-stack").classList.toggle("is-playing", Boolean(current && state.playing));
  updateNowFavoriteButton();
  updateNowArtwork();
  refreshPlayFavouritesButton();
  if (current) refreshSeek();
  const songListHint = document.getElementById("song-list-hint");
  if (songListHint) {
    const n = state.tracks.length;
    songListHint.textContent = n === 1 ? "1 Song" : n + " Songs";
  }
}

function updateNowArtwork() {
  const img = document.getElementById("now-art");
  const track = currentTrack();
  const trackId = track ? track.id : "";
  if (!track || track.source !== "local") {
    img.hidden = true;
    img.removeAttribute("src");
    return;
  }
  void artURLForTrack(track).then((url) => {
    if (currentTrack()?.id !== trackId) return;
    if (!url) {
      img.hidden = true;
      img.removeAttribute("src");
      return;
    }
    img.src = url;
    img.hidden = false;
  });
}

function trackIsFavorite(track) {
  return Boolean(track && track.favorite);
}

function favoriteTracks() {
  return state.tracks.filter(trackIsFavorite);
}

function refreshPlayFavouritesButton() {
  const button = document.getElementById("play-favourites");
  const count = favoriteTracks().length;
  button.disabled = count === 0;
  if (count === 0) {
    button.textContent = "♥ Favourites";
  } else if (count === 1) {
    button.textContent = "♥ Play favourite";
  } else {
    button.textContent = "♥ Play favourites (" + count + ")";
  }
}

function updateNowFavoriteButton() {
  const button = document.getElementById("now-favorite");
  const track = currentTrack();
  if (!track) {
    button.hidden = true;
    return;
  }
  button.hidden = false;
  const on = trackIsFavorite(track);
  button.classList.toggle("is-on", on);
  button.setAttribute("aria-pressed", on ? "true" : "false");
  button.setAttribute("aria-label", on ? "Remove from favourites" : "Add to favourites");
}

async function toggleFavorite(id) {
  const track = state.tracks.find((item) => item.id === id);
  if (!track) return;
  track.favorite = !trackIsFavorite(track);
  try {
    await putTrack(track);
  } catch {
    setNotice("Could not save favourite.");
    track.favorite = !track.favorite;
    return;
  }
  render();
}

function playFavourites() {
  const tracks = favoriteTracks();
  if (!tracks.length) {
    setNotice("Select heart to add song to favourites.");
    return;
  }
  let ids = tracks.map((track) => track.id);
  if (state.shuffle) ids = shuffleIds(ids);
  state.artistQueue = { name: "Favourites", ids, index: 0 };
  playListed(ids[0], { keepQueue: true });
}

function renderPlayer() {
  const track = currentTrack();
  setMarqueeText(document.getElementById("player-title"), track ? track.title : "");
  setMarqueeText(document.getElementById("player-sub"), track ? subtitle(track) : "");
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

function songBox(track) {
  const currentSong = track.id === state.currentId;
  const row = document.createElement("div");
  row.className = "song" + (currentSong ? " current" : "");
  row.dataset.play = track.id;
  const copy = document.createElement("div");
  copy.className = "song-copy";
  const title = document.createElement("span");
  title.className = "song-title";
  title.textContent = track.title;
  const sub = document.createElement("span");
  sub.className = "song-sub";
  sub.textContent = (currentSong && state.playing ? "Playing · " : "") + subtitle(track);
  copy.append(title, sub);
  const play = document.createElement("button");
  play.type = "button";
  play.className = "song-play";
  play.dataset.play = track.id;
  play.setAttribute("aria-label", "Play " + track.title);
  play.append(playIcon());
  row.append(copy, favoriteHeartButton(track), play);
  return row;
}

function favoriteHeartButton(track) {
  const on = trackIsFavorite(track);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "song-favorite" + (on ? " is-on" : "");
  button.dataset.favorite = track.id;
  button.setAttribute("aria-pressed", on ? "true" : "false");
  button.setAttribute(
    "aria-label",
    on ? "Remove " + track.title + " from favourites" : "Add " + track.title + " to favourites"
  );
  button.append(heartIcons());
  return button;
}

function heartIcons() {
  const wrap = document.createDocumentFragment();
  const outline = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  outline.setAttribute("class", "heart-outline");
  outline.setAttribute("viewBox", "0 0 36 36");
  outline.setAttribute("width", "26");
  outline.setAttribute("height", "26");
  outline.setAttribute("aria-hidden", "true");
  const outlinePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  outlinePath.setAttribute("fill", "none");
  outlinePath.setAttribute("stroke", "currentColor");
  outlinePath.setAttribute("stroke-width", "3");
  outlinePath.setAttribute(
    "d",
    "M18 31 C10 24 4 19 4 13 C4 8 8 4 13 4 C15.5 4 17.5 5.5 18 7.5 C18.5 5.5 20.5 4 23 4 C28 4 32 8 32 13 C32 19 26 24 18 31 Z"
  );
  outline.append(outlinePath);
  const solid = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  solid.setAttribute("class", "heart-solid");
  solid.setAttribute("viewBox", "0 0 36 36");
  solid.setAttribute("width", "26");
  solid.setAttribute("height", "26");
  solid.setAttribute("aria-hidden", "true");
  const solidPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  solidPath.setAttribute("fill", "currentColor");
  solidPath.setAttribute(
    "d",
    "M18 31 C10 24 4 19 4 13 C4 8 8 4 13 4 C15.5 4 17.5 5.5 18 7.5 C18.5 5.5 20.5 4 23 4 C28 4 32 8 32 13 C32 19 26 24 18 31 Z"
  );
  solid.append(solidPath);
  wrap.append(outline, solid);
  return wrap;
}

function playIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 36 36");
  svg.setAttribute("width", "36");
  svg.setAttribute("height", "36");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "currentColor");
  path.setAttribute("d", "M11 5 L31 18 L11 31 Z");
  svg.append(path);
  return svg;
}

function tracksForArtist(name) {
  const key = name.toLocaleLowerCase();
  return state.tracks
    .filter((track) => artistNames(track).some((item) => item.toLocaleLowerCase() === key))
    .sort((a, b) => (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base", numeric: true }));
}

function playAllArtist(name) {
  const tracks = tracksForArtist(name);
  if (!tracks.length) return;
  let ids = tracks.map((track) => track.id);
  if (state.shuffle) ids = shuffleIds(ids);
  state.artistQueue = { name, ids, index: 0 };
  playListed(ids[0], { keepQueue: true });
}

function playListed(id, options) {
  const track = state.tracks.find((item) => item.id === id);
  if (!track) return;
  const keepQueue = Boolean(options && options.keepQueue);
  if (!keepQueue) state.artistQueue = null;
  if (track.source !== "local") {
    hideSheet("artists-sheet");
    hideSheet("videos-sheet");
  }
  if (!keepQueue && track.id === state.currentId && state.playing) {
    if (track.source !== "local") openPlayer();
    return;
  }
  userPlay(track, track.source !== "local");
}

function openArtists(name) {
  hideSheet("add-sheet");
  hideSheet("manage-sheet");
  hideSheet("videos-sheet");
  hideConfirm();
  closePlayer();
  if (typeof name === "string" && name) state.openArtists.add(name);
  showSheet("artists-sheet");
  renderArtists();
  if (typeof name === "string" && name) {
    const match = [...document.querySelectorAll("#artist-list [data-artist]")].find((item) => item.dataset.artist === name);
    if (match) match.scrollIntoView({ block: "nearest" });
  }
}


function updateSearchClearButton() {
  const btn = document.getElementById("search-clear");
  const input = document.getElementById("nav-search-input");
  if (!btn || !input) return;
  const hasText = input.value.length > 0;
  btn.classList.toggle("is-empty", !hasText);
  btn.disabled = !hasText;
}

function clearSearch() {
  const input = document.getElementById("nav-search-input");
  input.value = "";
  state.searchQuery = "";
  state.openSearchArtists.clear();
  if (document.body.classList.contains("search-page")) renderSearchResults();
  updateSearchClearButton();
  input.focus();
}

function focusNavSearch() {
  const input = document.getElementById("nav-search-input");
  if (!searchPageIsShowing()) showSearch({ typing: true });
  input.focus();
}

function searchPageIsShowing() {
  if (!document.body.classList.contains("search-page") || playerIsOpen()) return false;
  return ["add-sheet", "manage-sheet", "artists-sheet", "videos-sheet"].every((id) => document.getElementById(id).hidden);
}

function showSearch(options) {
  const typing = Boolean(options && options.typing);
  const input = document.getElementById("nav-search-input");
  state.searchQuery = input.value.trim();
  const already = searchPageIsShowing();
  if (!already) {
    hideSheet("add-sheet");
    hideSheet("manage-sheet");
    hideSheet("artists-sheet");
    hideSheet("videos-sheet");
    hideConfirm();
    closePlayer();
    document.body.classList.remove("songs-page");
  document.body.classList.add("search-page");
  document.getElementById("songs").scrollTop = 0;
  syncNavCurrent();
}
  if (!typing) input.blur();
  updateSearchClearButton();
  renderSearchResults();
}

function renderSearchResults() {
  const list = document.getElementById("search-results");
  const hint = document.getElementById("search-hint");
  if (!list || !hint) return;
  list.replaceChildren();
  const query = state.searchQuery.trim().toLowerCase();
  if (!query) {
    hint.textContent = "Start typing in Search box above and results will show here...";
    return;
  }
  hint.textContent = state.searchQuery.trim();
  const artistNamesSeen = new Set();
  const artists = [];
  for (const track of state.tracks) {
    for (const name of artistNames(track)) {
      const key = name.toLocaleLowerCase();
      if (artistNamesSeen.has(key) || !key.includes(query)) continue;
      artistNamesSeen.add(key);
      artists.push(name);
    }
  }
  artists.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const songs = state.tracks.filter((track) => {
    return track.title.toLowerCase().includes(query) || (track.artist || "").toLowerCase().includes(query);
  });
  if (!artists.length && !songs.length) {
    const empty = document.createElement("p");
    empty.className = "search-empty";
    empty.textContent = "No song or artist matches that.";
    list.append(empty);
    return;
  }
  if (artists.length) list.append(searchHeading("Artists"));
  for (const name of artists) {
    const open = state.openSearchArtists.has(name);
    const tracks = tracksForArtist(name);
    const row = document.createElement("div");
    row.className = "artist-row search-artist" + (open ? " open" : "");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "artist-toggle";
    toggle.dataset.artistSearch = name;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    const title = document.createElement("span");
    title.className = "song-title";
    title.textContent = name;
    const sub = document.createElement("span");
    sub.className = "song-sub";
    const count = tracks.length === 1 ? "1 song" : tracks.length + " songs";
    sub.textContent = count + (open ? " · Tap to hide" : " · Tap to show");
    toggle.append(title, sub);
    const playAll = document.createElement("button");
    playAll.type = "button";
    playAll.className = "play-all";
    playAll.dataset.playAll = name;
    playAll.textContent = "Play all";
    row.append(toggle, playAll);
    list.append(row);
    if (!open) continue;
    const songs = document.createElement("div");
    songs.className = "artist-songs";
    for (const track of tracks) songs.append(songBox(track));
    list.append(songs);
  }
  if (songs.length) list.append(searchHeading("Songs"));
  for (const track of songs) list.append(songBox(track));
}

function searchHeading(text) {
  const heading = document.createElement("p");
  heading.className = "search-results-label";
  heading.textContent = text;
  return heading;
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
  for (const track of videos) list.append(songBox(track));
  if (scroller) scroller.scrollTop = scrollTop;
}

function setVideoSearchStatus(text) {
  const status = document.getElementById("youtube-search-status");
  status.hidden = !text;
  status.textContent = text || "";
}

function updateYouTubeClearButton() {
  const button = document.getElementById("youtube-clear-results");
  if (button) button.hidden = !youtubeHasSearched;
}

function clearYouTubeSearch() {
  youtubeSearchToken++;
  youtubeHasSearched = false;
  document.getElementById("youtube-search").value = "";
  document.getElementById("youtube-results").replaceChildren();
  setVideoSearchStatus("");
  updateYouTubeClearButton();
}

async function searchYouTube() {
  const query = document.getElementById("youtube-search").value.trim();
  const token = ++youtubeSearchToken;
  if (!query) {
    setVideoSearchStatus("Type a song or artist on YouTube.");
    return;
  }
  setVideoSearchStatus("Searching…");
  document.getElementById("youtube-results").replaceChildren();
  updateYouTubeClearButton();
  try {
    const response = await fetch("https://yt.chocolatemoo53.com/api/v1/search?type=video&q=" + encodeURIComponent(query));
    if (!response.ok) throw new Error("search failed");
    const payload = await response.json();
    if (token !== youtubeSearchToken) return;
    const results = youtubeSearchResults(payload);
    youtubeHasSearched = true;
    updateYouTubeClearButton();
    if (!results.length) {
      setVideoSearchStatus("No videos found. Try another word.");
      return;
    }
    setVideoSearchStatus("");
    renderYouTubeResults(results);
  } catch {
    if (token !== youtubeSearchToken) return;
    youtubeHasSearched = true;
    updateYouTubeClearButton();
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
    if (found.length >= 20) break;
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
  const artists = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  list.replaceChildren();
  document.getElementById("artists-empty").hidden = groups.size > 0;
  for (const group of artists) {
    group.tracks.sort((a, b) => (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base", numeric: true }));
    const open = state.openArtists.has(group.name);
    const row = document.createElement("div");
    row.className = "artist-row" + (open ? " open" : "");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "artist-toggle";
    toggle.dataset.artist = group.name;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    const title = document.createElement("span");
    title.className = "song-title";
    title.textContent = group.name;
    const sub = document.createElement("span");
    sub.className = "song-sub";
    const count = group.tracks.length === 1 ? "1 song" : group.tracks.length + " songs";
    sub.textContent = count + (open ? " · Tap to hide" : " · Tap to show");
    toggle.append(title, sub);
    const playAll = document.createElement("button");
    playAll.type = "button";
    playAll.className = "play-all";
    playAll.dataset.playAll = group.name;
    playAll.textContent = "Play all";
    row.append(toggle, playAll);
    list.append(row);
    if (!open) continue;
    const songs = document.createElement("div");
    songs.className = "artist-songs";
    for (const track of group.tracks) songs.append(songBox(track));
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
  if (playing) clearStreamingWatchdog();
  state.playing = playing;
  if (playing) streamingHold = isStreamingTrack(currentTrack());
  else if (!appInBackground()) streamingHold = false;
  const playButton = document.getElementById("play-button");
  if (isZeroTheme()) updateZeroPlayButton();
  else {
    document.getElementById("play-label").textContent = playing ? "Pause" : "Play";
    playButton.setAttribute("aria-label", playing ? "Pause" : "Play");
  }
  playButton.classList.toggle("is-playing", playing);
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }
  renderSongs();
  renderSearchResults();
  if (!document.getElementById("add-sheet").hidden) renderCatalog();
  if (!document.getElementById("artists-sheet").hidden) renderArtists();
  if (!document.getElementById("videos-sheet").hidden) renderVideos();
}

function clearNotice() {
  clearTimeout(noticeTimer);
  noticeTimer = 0;
  noticeActionURL = "";
  const el = document.getElementById("notice");
  const action = document.getElementById("notice-action");
  document.getElementById("notice-text").textContent = "";
  action.hidden = true;
  el.hidden = true;
}

function setNotice(text, options = {}) {
  const el = document.getElementById("notice");
  const textEl = document.getElementById("notice-text");
  const action = document.getElementById("notice-action");
  if (!text) {
    clearNotice();
    return;
  }
  textEl.textContent = text;
  const duration = options.duration || 4000;
  const url = options.url || "";
  if (url && options.actionLabel) {
    noticeActionURL = url;
    action.textContent = options.actionLabel;
    action.hidden = false;
  } else {
    noticeActionURL = "";
    action.hidden = true;
  }
  el.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(clearNotice, duration);
}

function youtubeWatchURL(videoId) {
  return videoId ? "https://www.youtube.com/watch?v=" + encodeURIComponent(videoId) : "";
}

function clearStreamingWatchdog() {
  if (streamingWatchdog !== null) {
    clearTimeout(streamingWatchdog);
    streamingWatchdog = null;
  }
}

function streamingPlaybackUnavailable() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function appInBackground() {
  return typeof document !== "undefined" && document.hidden;
}

function isStreamingTrack(track) {
  return Boolean(track && (track.source === "youtube" || track.source === "soundcloud"));
}

function shouldSkipStreamingTrack(track) {
  return isStreamingTrack(track) && streamingPlaybackUnavailable();
}

function resumeStreaming() {
  const track = currentTrack();
  if (!streamingHold || !isStreamingTrack(track)) return;
  if (track.source === "youtube" && ytPlayer && ytPlayer.playVideo) {
    try { ytPlayer.playVideo(); } catch { /* The player may not be ready yet. */ }
  } else if (track.source === "soundcloud" && scWidget && scWidget.play) {
    try { scWidget.play(); } catch { /* The widget may not be ready yet. */ }
  }
}

function skipPastStreamingTracks(direction) {
  if (!state.tracks.length) return false;
  const originId = state.currentId;
  let guard = state.tracks.length + 1;
  const stepDir = direction < 0 ? -1 : 1;
  while (guard-- > 0) {
    const next = trackForStep(stepDir);
    if (!next) break;
    if (isStreamingTrack(next)) {
      if (originId != null && next.id === originId && state.currentId !== originId) break;
      state.currentId = next.id;
      continue;
    }
    void playTrack(next, { open: playerIsOpen() });
    return true;
  }
  clearStreamingWatchdog();
  finishTrackChange();
  pauseYouTube();
  pauseSoundCloud();
  stopPlayback();
  state.currentId = null;
  closePlayer();
  render();
  return true;
}

function advancePastStreamingFailure() {
  if (!shouldAdvance()) return;
  const track = currentTrack();
  if (!track || !isStreamingTrack(track)) return;
  clearStreamingWatchdog();
  finishTrackChange();
  setPlaying(false);
  pauseYouTube();
  pauseSoundCloud();
  if (streamingPlaybackUnavailable()) {
    skipPastStreamingTracks(1);
    return;
  }
  if (state.tracks.length < 2) {
    stopPlayback();
    state.currentId = null;
    closePlayer();
    render();
    setNotice("No connection — streaming songs need internet.");
    return;
  }
  step(1);
}

function armStreamingWatchdog() {
  clearStreamingWatchdog();
  const track = currentTrack();
  if (!track || track.source === "local") return;
  const trackId = track.id;
  const source = track.source;
  const ms = streamingPlaybackUnavailable() ? 4000 : 12000;
  streamingWatchdog = setTimeout(() => {
    streamingWatchdog = null;
    if (state.currentId !== trackId || !isSource(source)) return;
    if (isAudiblyPlaying() || (streamingHold && appInBackground())) return;
    advancePastStreamingFailure();
  }, ms);
}

function noticeYouTubePlaybackError() {
  const track = currentTrack();
  if (track && track.source === "youtube" && streamingPlaybackUnavailable()) {
    advancePastStreamingFailure();
    return;
  }
  setPlaying(false);
}

function showSongs() {
  hideSheet("add-sheet");
  hideSheet("manage-sheet");
  hideSheet("artists-sheet");
  hideSheet("videos-sheet");
  hideConfirm();
  closePlayer();
  document.body.classList.remove("search-page");
  document.body.classList.add("songs-page");
  document.getElementById("songs").scrollTop = 0;
  syncNavCurrent();
}

function goHome() {
  hideSheet("add-sheet");
  hideSheet("manage-sheet");
  hideSheet("artists-sheet");
  hideSheet("videos-sheet");
  hideConfirm();
  closePlayer();
  document.body.classList.remove("songs-page");
  document.body.classList.remove("search-page");
  document.getElementById("songs").scrollTop = 0;
  syncNavCurrent();
}

function syncNavCurrent() {
  const artistsOpen = !document.getElementById("artists-sheet").hidden;
  const videosOpen = !document.getElementById("videos-sheet").hidden;
  const songsOpen = document.body.classList.contains("songs-page") && !artistsOpen && !videosOpen;
  const searching = document.body.classList.contains("search-page") && !artistsOpen && !videosOpen && !songsOpen;
  const current = artistsOpen ? "artists" : videosOpen ? "videos-nav" : songsOpen ? "songs-nav" : searching ? "" : "home";
  const section = artistsOpen
    ? "artists"
    : videosOpen
      ? "videos"
      : songsOpen
        ? "songs"
        : searching
          ? "search"
          : "home";
  document.body.classList.remove(
    "section-home",
    "section-artists",
    "section-songs",
    "section-videos",
    "section-search"
  );
  document.body.classList.add("section-" + section);
  for (const id of ["home", "artists", "songs-nav", "videos-nav"]) {
    const button = document.getElementById(id);
    if (button) button.classList.toggle("is-current", id === current);
  }
}

function showSheet(id) {
  document.getElementById(id).hidden = false;
  syncNavCurrent();
}

function hideSheet(id) {
  document.getElementById(id).hidden = true;
  if (id === "add-sheet") hideLinkConfirm();
  syncNavCurrent();
}

function scrollSheetBodyToTop(sheetId) {
  const sheet = document.getElementById(sheetId);
  if (!sheet) return;
  const body = sheet.querySelector(".sheet-body");
  if (body) body.scrollTop = 0;
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
  hideConfirm();
  state.catalogSessionDownloads.clear();
  showSheet("add-sheet");
  scrollSheetBodyToTop("add-sheet");
  await loadCatalog();
  renderCatalog({ resetScroll: true, onlyPending: true });
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
    state.macError = "The computer is off or asleep. Songs already on this " + deviceLabel() + " still play.";
  }
}

function catalogEntriesForDisplay(onlyPending) {
  const pending = state.catalog.filter((entry) => !savedOnIpad(entry));
  if (onlyPending) return pending;
  const session = state.catalogSessionDownloads;
  return state.catalog.filter((entry) => {
    if (!savedOnIpad(entry)) return true;
    return session.has(entry.file);
  });
}

function renderCatalog(options) {
  const resetScroll = Boolean(options && options.resetScroll);
  const onlyPending = Boolean(options && options.onlyPending);
  const status = document.getElementById("mac-status");
  const list = document.getElementById("catalog-list");
  const scroller = list.closest(".sheet-body");
  const scrollTop = scroller ? scroller.scrollTop : 0;
  list.replaceChildren();
  const pending = state.catalog.filter((entry) => !savedOnIpad(entry));
  const entries = catalogEntriesForDisplay(onlyPending);
  if (state.macError) {
    status.hidden = false;
    status.textContent = state.macError;
  } else if (state.catalog.length === 0) {
    status.hidden = false;
    status.textContent = "No songs on the computer yet.";
  } else if (onlyPending && pending.length === 0) {
    status.hidden = true;
    status.textContent = "";
  } else if (!onlyPending && pending.length === 0 && entries.length > 0) {
    status.hidden = false;
    status.textContent = "Tap Play on the songs you just downloaded.";
  } else {
    status.hidden = false;
    status.textContent = onlyPending
      ? "Tap Download to put a song " + onThisDevice() + "."
      : "Download more, or tap Play on songs you just added.";
  }
  for (const entry of entries) {
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
  const downloadAll = document.getElementById("download-all");
  downloadAll.hidden = pending.length === 0;
  downloadAll.disabled = state.working || pending.length === 0;
  if (pending.length > 0) {
    const pendingBytes = pending.reduce((sum, entry) => sum + (Number(entry.bytes) || 0), 0);
    const total = formatBytesCompact(pendingBytes);
    downloadAll.textContent = total ? "Download all " + total : "Download all";
  } else {
    downloadAll.textContent = "Download all";
  }
  if (scroller) scroller.scrollTop = resetScroll ? 0 : scrollTop;
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

function formatBytesCompact(bytes) {
  const size = Number(bytes) || 0;
  if (size <= 0) return "";
  const mb = size / (1024 * 1024);
  if (mb >= 1) return Math.round(mb) + "MB";
  return Math.max(1, Math.round(size / 1024)) + "KB";
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
  if (count > 0) {
    setNotice(
      count === 1
        ? "1 song is ready " + onThisDevice() + ". Tap Play."
        : count + " songs are ready " + onThisDevice() + ". Tap Play."
    );
  }
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
    const tags = await readID3(blob);
    const track = {
      id: "mac:" + entry.file,
      title: tags.title || entry.title || entry.file,
      artist: tags.artist || entry.artist || "",
      source: "local",
      mediaRef: entry.file,
      bytes: blob.size,
      createdAt: Date.now()
    };
    await saveLocal(track, blob, tags.artwork);
    state.readyId = track.id;
    state.tracks = sortTracks(state.tracks.filter((item) => item.id !== track.id).concat(track));
    state.catalogSessionDownloads.add(entry.file);
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
  if (saved && announce) setNotice(savedTitle + " is ready " + onThisDevice() + ". Tap Play.");
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
      await saveLocal(track, file, tags.artwork);
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
  showLinkConfirm("Adding…");
  let copied = "";
  try {
    copied = await navigator.clipboard.readText();
  } catch {
    copied = "";
  }
  if (!copied.trim()) {
    showLinkConfirm("Copy a YouTube or SoundCloud link first.");
    return;
  }
  await addPastedLink(copied);
}

async function addPastedLink(text) {
  state.working = true;
  document.getElementById("paste-link").disabled = true;
  try {
    const parsed = parseLink(text);
    if (!parsed) {
      showLinkConfirm("Use a YouTube or SoundCloud link.");
      return;
    }
    const existing = state.tracks.find((track) => linkRefsMatch(track, parsed));
    if (existing) {
      showLinkConfirm("That song is already in the list.", existing);
      return;
    }
    const track = await addLink(text);
    render();
    if (linkConfirmVisible()) showLinkConfirm("Added", track);
    else setNotice("Added " + track.title);
  } catch (error) {
    const message = error.message || "That link could not be added.";
    if (linkConfirmVisible()) showLinkConfirm(message);
    else setAddError(message);
  } finally {
    state.working = false;
    document.getElementById("paste-link").disabled = false;
  }
}

function showLinkConfirm(status, track) {
  const statusEl = document.getElementById("link-confirm-status");
  statusEl.textContent = status;
  statusEl.classList.toggle("link-confirm-hint", !track);
  const name = document.getElementById("link-confirm-name");
  const detail = document.getElementById("link-confirm-detail");
  const play = document.getElementById("link-confirm-play");
  if (track) {
    linkConfirmId = track.id;
    name.hidden = false;
    name.textContent = track.title;
    detail.hidden = false;
    detail.textContent = subtitle(track);
    play.hidden = false;
  } else {
    linkConfirmId = "";
    name.hidden = true;
    name.textContent = "";
    detail.hidden = true;
    detail.textContent = "";
    play.hidden = true;
  }
  document.getElementById("link-confirm").hidden = false;
}

function linkConfirmVisible() {
  return !document.getElementById("link-confirm").hidden;
}

function hideLinkConfirm() {
  linkConfirmId = "";
  document.getElementById("link-confirm").hidden = true;
}

function playConfirmedLink() {
  const id = linkConfirmId;
  hideLinkConfirm();
  hideSheet("add-sheet");
  if (id) playListed(id);
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
    const track = await addLink(text);
    document.getElementById("link-input").value = "";
    hideSheet("add-sheet");
    render();
    setNotice("Added " + track.title);
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
  if (state.tracks.some((track) => linkRefsMatch(track, parsed))) {
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
  if (parsed.source === "soundcloud" && meta.streamRef) track.streamRef = meta.streamRef;
  await putTrack(track);
  state.tracks = sortTracks(state.tracks.concat(track));
  return track;
}

function linkRefsMatch(track, parsed) {
  if (track.source !== parsed.source) return false;
  if (parsed.source === "soundcloud") {
    return normalizeSoundCloudURL(track.mediaRef) === parsed.mediaRef;
  }
  return track.mediaRef === parsed.mediaRef;
}

function soundCloudStreamRefFromOEmbed(payload) {
  const html = String(payload.html || "");
  const match = html.match(/player\/\?[^"]*?\burl=([^"&]+)/) || html.match(/\burl=([^"&]+)/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

async function resolveSoundCloudPlayURL(track) {
  const page = normalizeSoundCloudURL(track.mediaRef);
  const stored = String(track.streamRef || "").trim();
  if (stored) return stored;
  if (page.includes("api.soundcloud.com/tracks/")) return page;
  const meta = await fetchOEmbed({ source: "soundcloud", pageURL: page, mediaRef: page });
  const streamRef = meta.streamRef || page;
  if (meta.streamRef && meta.streamRef !== track.streamRef) {
    track.streamRef = meta.streamRef;
    try {
      await putTrack(track);
    } catch { /* Playback can still use the resolved URL for this visit. */ }
  }
  return streamRef;
}

async function fetchOEmbed(parsed) {
  const fallback = parsed.source === "youtube" ? "YouTube video" : "SoundCloud song";
  const endpoint = parsed.source === "youtube" ? "/api/youtube-oembed" : "/api/soundcloud-oembed";
  try {
    const response = await fetch(endpoint + "?url=" + encodeURIComponent(parsed.pageURL));
    if (!response.ok) return { title: fallback, artist: "", streamRef: "" };
    const payload = await response.json();
    const videoTitle = String(payload.title || "").trim();
    const channel = String(payload.author_name || "").trim();
    if (parsed.source === "youtube") return { ...youtubeNames(videoTitle, channel), streamRef: "" };
    const streamRef = soundCloudStreamRefFromOEmbed(payload);
    return { title: videoTitle || fallback, artist: channel, streamRef: streamRef };
  } catch {
    return { title: fallback, artist: "", streamRef: "" };
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
  const soundcloudMissing = state.tracks.filter(
    (track) => track.source === "soundcloud" && !track.streamRef && !String(track.mediaRef || "").includes("api.soundcloud.com/tracks/")
  );
  const targets = [...new Set(pending.concat(soundcloudMissing))];
  if (!targets.length) return;
  let changed = false;
  for (const track of targets) {
    if (track.source !== "youtube" && track.source !== "soundcloud") continue;
    const pageURL =
      track.source === "youtube"
        ? "https://www.youtube.com/watch?v=" + track.mediaRef
        : normalizeSoundCloudURL(track.mediaRef);
    if (track.source === "soundcloud" && track.mediaRef !== pageURL) {
      track.mediaRef = pageURL;
      changed = true;
    }
    const meta = await fetchOEmbed({ source: track.source, pageURL: pageURL, mediaRef: pageURL });
    if (!meta.title || meta.title === "YouTube video" || meta.title === "SoundCloud song") continue;
    if (track.source === "soundcloud" && meta.streamRef && meta.streamRef !== track.streamRef) {
      track.streamRef = meta.streamRef;
      changed = true;
    }
    if (meta.title === track.title && meta.artist === track.artist && !changed) continue;
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
  const track = id ? state.tracks.find((item) => item.id === id) : null;
  const removedTitle = track ? track.title : "Song";
  hideConfirm();
  if (!id) return;
  await deleteTrack(id);
  state.tracks = state.tracks.filter((track) => track.id !== id);
  if (state.artistQueue) {
    state.artistQueue.ids = state.artistQueue.ids.filter((item) => item !== id);
    if (state.currentId === id || !state.artistQueue.ids.length) state.artistQueue = null;
  }
  if (state.currentId === id) {
    stopPlayback();
    state.currentId = null;
    state.playing = false;
    closePlayer();
  }
  render();
  renderManage();
  setNotice(removedTitle + " removed " + onThisDevice() + ".");
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
  if (shouldSkipStreamingTrack(track)) {
    skipPastStreamingTracks(1);
    return;
  }
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
    if (shouldSkipStreamingTrack(track)) {
      finishTrackChange();
      skipPastStreamingTracks(1);
      return;
    }
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
    if (
      (track.source === "youtube" || track.source === "soundcloud") &&
      streamingPlaybackUnavailable()
    ) {
      advancePastStreamingFailure();
      return;
    }
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
  streamingHold = false;
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
  if (state.artistQueue) {
    const track = moveArtistQueue(direction);
    if (!track) {
      stopArtistQueue();
      return;
    }
    if (track.id === state.currentId) {
      state.shuffleRewind = false;
      restart();
      return;
    }
    userPlay(track, playerIsOpen());
    return;
  }
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

function prepareArtURL(id, blob) {
  const existing = artURLs.get(id);
  if (existing) URL.revokeObjectURL(existing);
  const url = URL.createObjectURL(blob);
  artURLs.set(id, url);
  return url;
}

const ART_EDGE = 400;
const ART_KEEP = 96 * 1024;

async function fitArtwork(blob) {
  if (!blob || blob.size <= ART_KEEP) return blob;
  let bitmap = null;
  try {
    bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, ART_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return blob;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const fitted = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!fitted || fitted.size >= blob.size) return blob;
    return fitted;
  } catch {
    return blob;
  } finally {
    if (bitmap && bitmap.close) bitmap.close();
  }
}

function blobToDataURL(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => resolve("");
    reader.readAsDataURL(blob);
  });
}

async function artURLForTrack(track) {
  if (!track || track.source !== "local") return null;
  let blob = artBlobs.get(track.id);
  let stored = Boolean(blob);
  if (!blob) {
    blob = await getArtworkBlob(track.id);
    stored = Boolean(blob);
  }
  if (!blob) {
    const audio = await playableBlob(track);
    if (!audio) return null;
    const tags = await readID3(audio);
    if (!tags.artwork) return null;
    blob = tags.artwork;
    stored = false;
  }
  const fitted = await fitArtwork(blob);
  if (!stored || fitted !== blob) {
    await saveArtwork(track.id, fitted);
    blob = artBlobs.get(track.id) || fitted;
    const existing = artURLs.get(track.id);
    if (existing) URL.revokeObjectURL(existing);
    artURLs.delete(track.id);
  } else if (!artBlobs.has(track.id)) {
    artBlobs.set(track.id, blob);
  }
  if (artURLs.has(track.id)) return artURLs.get(track.id);
  return prepareArtURL(track.id, blob);
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

function isZeroTheme() {
  return document.documentElement.getAttribute("data-family-theme") === "zero";
}

function zeroPlayButtonClick() {
  const track = currentTrack() || songToStart();

  if (isAudiblyPlaying()) {
    if (!state.shuffle) {
      setShuffle(true);
      zeroPlayPhase = 2;
    } else {
      setShuffle(false);
      userPause();
      zeroPlayPhase = 0;
    }
    updateZeroPlayButton();
    return;
  }

  if (zeroPlayPhase === 0) {
    setShuffle(false);
    if (track) userPlay(track, playerIsOpen());
    zeroPlayPhase = 1;
  } else if (zeroPlayPhase === 1) {
    setShuffle(true);
    if (track) userPlay(track, playerIsOpen());
    zeroPlayPhase = 2;
  } else {
    setShuffle(false);
    zeroPlayPhase = 0;
  }
  updateZeroPlayButton();
}

function updateZeroPlayButton() {
  const playButton = document.getElementById("play-button");
  if (!playButton) return;
  if (!isZeroTheme()) {
    playButton.classList.remove("is-shuffle-on");
    return;
  }
  const playing = isAudiblyPlaying();
  const shuffleVisual = state.shuffle && (playing || zeroPlayPhase >= 2);
  playButton.classList.toggle("is-shuffle-on", shuffleVisual);
  let label = "Play";
  if (playing && state.shuffle) label = "Stop";
  else if (playing) label = "Shuffle";
  else if (zeroPlayPhase === 1) label = "Shuffle";
  else if (zeroPlayPhase === 2) label = "Stop";
  playButton.setAttribute("aria-label", label);
}

function setShuffle(on) {
  state.shuffle = on;
  state.shuffleHistory = [];
  state.shuffleRewind = false;
  if (on) startShuffle(state.currentId);
  saveShuffle();
  updateShuffleButton();
  updateZeroPlayButton();
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
  label.textContent = on ? "On" : "Off";
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
      setNotice("That song is not " + onThisDevice() + ".");
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

function tryPlayYouTube() {
  if (!pendingYtPlay || !ytReady || !ytPlayer || !window.YT) return;
  const track = currentTrack();
  if (!track || track.source !== "youtube" || track.mediaRef !== pendingYtVideo) return;
  try {
    const loadedId = ytPlayer.getVideoData ? ytPlayer.getVideoData().video_id : "";
    if (loadedId && loadedId !== track.mediaRef) return;
    const playerState = ytPlayer.getPlayerState ? ytPlayer.getPlayerState() : -1;
    if (playerState === YT.PlayerState.PLAYING) {
      pendingYtPlay = false;
      return;
    }
    if (
      playerState === YT.PlayerState.UNSTARTED ||
      playerState === YT.PlayerState.CUED ||
      playerState === YT.PlayerState.PAUSED ||
      playerState === YT.PlayerState.BUFFERING
    ) {
      ytPlayer.playVideo();
    }
  } catch { /* The player may not be ready yet. */ }
}

function playYouTube(track) {
  if (streamingPlaybackUnavailable()) {
    advancePastStreamingFailure();
    return;
  }
  audio().pause();
  pauseSoundCloud();
  pendingVideo = track.mediaRef;
  pendingYtVideo = track.mediaRef;
  pendingYtPlay = true;
  loadYouTubeAPI();
  if (!ytReady || !ytPlayer || !ytPlayer.loadVideoById) {
    armStreamingWatchdog();
    return;
  }
  const run = () => {
    if (!isSource("youtube")) return;
    const current = currentTrack();
    if (!current || current.mediaRef !== track.mediaRef) return;
    fitYouTube();
    ytPlayer.loadVideoById(track.mediaRef);
    tryPlayYouTube();
    armStreamingWatchdog();
  };
  requestAnimationFrame(() => requestAnimationFrame(run));
}

async function playSoundCloud(track) {
  if (streamingPlaybackUnavailable()) {
    advancePastStreamingFailure();
    return;
  }
  audio().pause();
  pauseYouTube();
  scWidget = null;
  await loadSoundCloudAPI();
  const playURL = await resolveSoundCloudPlayURL(track);
  const stage = document.getElementById("stage-sc");
  stage.replaceChildren();
  const frame = document.createElement("iframe");
  frame.id = "sc-frame";
  frame.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
  frame.setAttribute("scrolling", "no");
  frame.title = track.title || "SoundCloud";
  const widgetQuery =
    "url=" +
    encodeURIComponent(playURL) +
    "&auto_play=true&hide_related=true&show_comments=false&show_user=true&show_reposts=false&visual=true&show_teaser=false";
  frame.src = "https://w.soundcloud.com/player/?" + widgetQuery;
  stage.append(frame);
  if (!window.SC || !window.SC.Widget) {
    finishTrackChange();
    if (streamingPlaybackUnavailable()) advancePastStreamingFailure();
    else setNotice("SoundCloud could not load. Check your connection and try again.");
    return;
  }
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
  scWidget.bind(window.SC.Widget.Events.PAUSE, () => {
    if (!isSource("soundcloud")) return;
    if (streamingHold && appInBackground()) return;
    setPlaying(false);
  });
  scWidget.bind(window.SC.Widget.Events.FINISH, () => {
    if (isSource("soundcloud") && shouldAdvance()) step(1);
  });
  if (window.SC.Widget.Events.ERROR) {
    scWidget.bind(window.SC.Widget.Events.ERROR, () => {
      if (!isSource("soundcloud")) return;
      if (streamingPlaybackUnavailable()) advancePastStreamingFailure();
    });
  }
  armStreamingWatchdog();
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
    playerVars: {
      autoplay: 1,
      playsinline: 1,
      rel: 0,
      modestbranding: 1,
      controls: 1,
      fs: 1,
      iv_load_policy: 3,
      origin: window.location.origin
    },
    events: {
      onReady: () => {
        ytReady = true;
        allowYouTubeFullscreen();
        fitYouTube();
        if (pendingVideo && isSource("youtube")) {
          pendingYtVideo = pendingVideo;
          pendingYtPlay = true;
          ytPlayer.loadVideoById(pendingVideo);
          tryPlayYouTube();
        }
      },
      onStateChange: (event) => {
        if (!isSource("youtube") || !window.YT) return;
        if (
          pendingYtPlay &&
          (event.data === YT.PlayerState.UNSTARTED ||
            event.data === YT.PlayerState.CUED ||
            event.data === YT.PlayerState.PAUSED ||
            event.data === YT.PlayerState.BUFFERING)
        ) {
          tryPlayYouTube();
        }
        if (event.data === YT.PlayerState.PLAYING) {
          pendingYtPlay = false;
          finishTrackChange();
          setPlaying(true);
          applyPendingSeek();
        }
        if (event.data === YT.PlayerState.PAUSED) {
          if (streamingHold && appInBackground()) return;
          setPlaying(false);
        }
        if (event.data === YT.PlayerState.ENDED && youtubeActuallyEnded(event)) step(1);
      },
      onError: (event) => {
        finishTrackChange();
        noticeYouTubePlaybackError(event && event.data);
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
  allow.add("autoplay");
  allow.add("encrypted-media");
  allow.add("picture-in-picture");
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
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const existing = document.getElementById("sc-api");
    if (existing) {
      if (window.SC && window.SC.Widget) {
        finish();
        return;
      }
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener("error", finish, { once: true });
      queueMicrotask(() => {
        if (window.SC && window.SC.Widget) finish();
      });
      return;
    }
    const tag = document.createElement("script");
    tag.id = "sc-api";
    tag.src = "https://w.soundcloud.com/player/api.js";
    tag.onload = finish;
    tag.onerror = finish;
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

function moveArtistQueue(direction) {
  const queue = state.artistQueue;
  if (!queue || !queue.ids.length) return null;
  let index = queue.ids.indexOf(state.currentId);
  if (index < 0) index = Math.max(0, queue.index);
  const next = index + direction;
  if (direction > 0 && next >= queue.ids.length) return null;
  if (next < 0) return currentTrack();
  queue.index = next;
  return state.tracks.find((track) => track.id === queue.ids[next]) || null;
}

function stopArtistQueue() {
  state.artistQueue = null;
  const track = currentTrack();
  if (!track) {
    setPlaying(false);
    return;
  }
  if (track.source === "local") audio().pause();
  else if (track.source === "youtube") pauseYouTube();
  else pauseSoundCloud();
  setPlaying(false);
}

function step(direction) {
  if (state.artistQueue) {
    const track = moveArtistQueue(direction);
    if (!track) {
      stopArtistQueue();
      return;
    }
    if (track.id === state.currentId) {
      state.shuffleRewind = false;
      restart();
      return;
    }
    playTrack(track, { open: playerIsOpen() || track.source !== "local" });
    return;
  }
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
  clearStreamingWatchdog();
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

let sessionArtToken = 0;

function publishSession(track) {
  if (!("mediaSession" in navigator) || !("MediaMetadata" in window) || !track) return;
  const token = ++sessionArtToken;
  const meta = { title: track.title || "Song", artist: track.artist || "" };
  try {
    navigator.mediaSession.metadata = new MediaMetadata(meta);
  } catch { /* Some browsers reject metadata until playback starts. */ }
  if (track.source !== "local") return;
  void artURLForTrack(track).then(async () => {
    if (token !== sessionArtToken || currentTrack()?.id !== track.id) return;
    const blob = artBlobs.get(track.id);
    if (!blob) return;
    const src = await blobToDataURL(blob);
    if (!src || token !== sessionArtToken || currentTrack()?.id !== track.id) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: meta.title,
        artist: meta.artist,
        artwork: [{ src, sizes: "400x400", type: blob.type || "image/jpeg" }]
      });
    } catch { /* Ignore artwork the browser will not attach. */ }
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
    const pageURL = normalizeSoundCloudURL(url);
    return { source: "soundcloud", mediaRef: pageURL, pageURL: pageURL };
  }
  return null;
}

function normalizeSoundCloudURL(input) {
  let url;
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(String(input || ""));
  } catch {
    return String(input || "").trim();
  }
  url.protocol = "https:";
  url.hash = "";
  url.search = "";
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.href;
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

function parsePictureFrame(frame, v22) {
  if (!frame.length) return null;
  let mime = "image/jpeg";
  let i = 0;
  if (v22) {
    const format = String.fromCharCode(frame[0], frame[1], frame[2]).trim();
    if (format === "PNG") mime = "image/png";
    i = 3;
    while (i < frame.length && frame[i] !== 0) i += 1;
    i += 1;
  } else {
    const encoding = frame[0];
    i = 1;
    const mimeBytes = [];
    while (i < frame.length && frame[i] !== 0) {
      mimeBytes.push(frame[i]);
      i += 1;
    }
    i += 1;
    mime = mimeBytes.length
      ? new TextDecoder("latin1").decode(new Uint8Array(mimeBytes)).trim()
      : "image/jpeg";
    i += 1;
    if (encoding === 1 || encoding === 2) {
      while (i + 1 < frame.length && !(frame[i] === 0 && frame[i + 1] === 0)) i += 2;
      i += 2;
    } else {
      while (i < frame.length && frame[i] !== 0) i += 1;
      i += 1;
    }
  }
  const data = frame.subarray(i);
  if (data.length < 32) return null;
  return new Blob([data], { type: mime.split(";")[0].trim() || "image/jpeg" });
}


const ID3_READ_MIN = 256 * 1024;
const ID3_READ_MAX = 2 * 1024 * 1024;

async function id3HeadBytes(file) {
  const size = file.size || 0;
  if (!size) return new Uint8Array(0);
  let readLen = Math.min(size, ID3_READ_MIN);
  if (size >= 10) {
    const probe = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (probe[0] === 0x49 && probe[1] === 0x44 && probe[2] === 0x33) {
      const tagSize = syncsafe(probe, 6);
      readLen = Math.min(size, Math.max(readLen, 10 + tagSize));
      readLen = Math.min(readLen, ID3_READ_MAX);
    }
  }
  return new Uint8Array(await file.slice(0, readLen).arrayBuffer());
}

async function readID3(file) {
  const empty = { title: "", artist: "", artwork: null };
  try {
    const size = file.size || 0;
    const head = await id3HeadBytes(file);
    let title = "";
    let artist = "";
    let artwork = null;
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
      const version = head[3];
      const v22 = version === 2;
      let offset = 10;
      const tagSize = syncsafe(head, 6);
      if (head[5] & 0x40) {
        const extended = version === 4 ? syncsafe(head, offset) : be32(head, offset);
        offset += version === 4 ? extended : extended + 4;
      }
      const end = Math.min(head.length, 10 + tagSize);
      const headerSize = v22 ? 6 : 10;
      while (offset + headerSize < end) {
        const id = v22
          ? String.fromCharCode(head[offset], head[offset + 1], head[offset + 2])
          : String.fromCharCode(head[offset], head[offset + 1], head[offset + 2], head[offset + 3]);
        if (!id || id.charCodeAt(0) === 0) break;
        const frameSize = v22
          ? be24(head, offset + 3)
          : version === 4
            ? syncsafe(head, offset + 4)
            : be32(head, offset + 4);
        const start = offset + headerSize;
        if (frameSize <= 0 || start + frameSize > head.length) break;
        const frame = head.subarray(start, start + frameSize);
        if (id === "TIT2" || id === "TT2") title = decodeTextFrame(frame);
        else if (id === "TPE1" || id === "TP1") artist = decodeTextFrame(frame);
        else if ((id === "APIC" || id === "PIC") && !artwork) artwork = parsePictureFrame(frame, v22);
        offset = start + frameSize;
      }
    }
    if (!title || !artist) {
      const tail = new Uint8Array(await file.slice(Math.max(0, size - 128)).arrayBuffer());
      if (tail.length >= 128 && String.fromCharCode(tail[0], tail[1], tail[2]) === "TAG") {
        const decoder = new TextDecoder("latin1");
        if (!title) title = decoder.decode(tail.subarray(3, 33)).replace(/\0/g, "").trim();
        if (!artist) artist = decoder.decode(tail.subarray(33, 63)).replace(/\0/g, "").trim();
      }
    }
    return { title: title.trim(), artist: artist.trim(), artwork };
  } catch {
    return empty;
  }
}

function be24(bytes, offset) {
  return ((bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2]) >>> 0;
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
    const request = indexedDB.open("waynesmusic", 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("tracks")) db.createObjectStore("tracks", { keyPath: "id" });
      if (!db.objectStoreNames.contains("files")) db.createObjectStore("files", { keyPath: "id" });
      if (!db.objectStoreNames.contains("artwork")) db.createObjectStore("artwork", { keyPath: "id" });
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

async function saveLocal(track, blob, artwork) {
  const type = blob.type && blob.type.startsWith("audio/") ? blob.type : mimeFor(track.mediaRef || "", "");
  const stored = blob.type === type ? blob : new Blob([await blob.arrayBuffer()], { type });
  fileBlobs.set(track.id, stored);
  prepareURL(track.id, stored);
  const db = await openDB();
  const fitted = artwork ? await fitArtwork(artwork) : null;
  const stores = fitted ? ["tracks", "files", "artwork"] : ["tracks", "files"];
  const tx = db.transaction(stores, "readwrite");
  tx.objectStore("tracks").put(track);
  tx.objectStore("files").put({ id: track.id, blob: stored });
  if (fitted) {
    artBlobs.set(track.id, fitted);
    tx.objectStore("artwork").put({ id: track.id, blob: fitted });
  }
  await transactionDone(tx);
}

async function saveArtwork(id, artwork) {
  const fitted = await fitArtwork(artwork);
  artBlobs.set(id, fitted);
  const db = await openDB();
  const tx = db.transaction("artwork", "readwrite");
  tx.objectStore("artwork").put({ id, blob: fitted });
  await transactionDone(tx);
}

async function getArtworkBlob(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("artwork", "readonly");
    const request = tx.objectStore("artwork").get(id);
    request.onsuccess = () => resolve(request.result ? request.result.blob : null);
    request.onerror = () => reject(request.error);
  });
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

function initFamilyTheme() {
  const picker = document.getElementById("theme-picker");
  if (!picker) return;
  let theme = localStorage.getItem(FAMILY_THEME_STORAGE);
  if (!FAMILY_THEME_META[theme]) theme = DEFAULT_FAMILY_THEME;
  applyFamilyTheme(theme);
  picker.querySelectorAll(".theme-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.theme;
      if (!FAMILY_THEME_META[next]) return;
      const current = document.documentElement.getAttribute("data-family-theme");
      const target = current === next ? "zero" : next;
      if (target === "zero") {
        try {
          localStorage.setItem(ZERO_HERO_FOR_KEY, next);
        } catch (_) {}
      }
      applyFamilyTheme(target);
      try {
        localStorage.setItem(FAMILY_THEME_STORAGE, target);
      } catch (_) {}
    });
  });
}

const ZERO_HERO_FOR_KEY = "family-theme-zero-for";

const FAMILY_HEROES = {
  jori: "/heroes/jori.jpg",
  wayne: "/heroes/wayne.jpeg",
  jacob: "/heroes/jacob.jpg",
  dan: "/heroes/dan.jpg",
  steff: "/heroes/steff.jpg"
};

const FAMILY_HEROES_BW = {
  jori: "/heroes/joriBW.jpg",
  wayne: "/heroes/wayneBW.jpg",
  jacob: "/heroes/jacobBW.jpg",
  dan: "/heroes/danBW.jpg",
  steff: "/heroes/steffBW.jpg"
};

function zeroHeroFor() {
  try {
    const stored = localStorage.getItem(ZERO_HERO_FOR_KEY);
    if (stored && FAMILY_HEROES_BW[stored]) return stored;
  } catch (_) {}
  return DEFAULT_FAMILY_THEME;
}

function applyHomeHero(theme) {
  const img = document.getElementById("home-hero");
  if (!img) return;
  let src;
  if (theme === "zero") {
    const key = zeroHeroFor();
    src = FAMILY_HEROES_BW[key] || FAMILY_HEROES_BW[DEFAULT_FAMILY_THEME];
  } else {
    src = FAMILY_HEROES[theme] || FAMILY_HEROES[DEFAULT_FAMILY_THEME];
  }
  if (src && img.getAttribute("src") !== src) img.src = src;
}

function applyFamilyTheme(theme) {
  document.documentElement.setAttribute("data-family-theme", theme);
  applyHomeHero(theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", FAMILY_THEME_META[theme]);
  const zeroFor = zeroHeroFor();
  document.querySelectorAll(".theme-chip").forEach((btn) => {
    const on = theme === "zero" ? btn.dataset.theme === zeroFor : btn.dataset.theme === theme;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  if (theme === "zero") {
    zeroPlayPhase = 0;
    if (state.shuffle) {
      state.shuffle = false;
      state.shuffleHistory = [];
      state.shuffleRewind = false;
      saveShuffle();
    }
  } else {
    zeroPlayPhase = 0;
  }
  updateShuffleButton();
  updateZeroPlayButton();
}

async function deleteTrack(id) {
  fileBlobs.delete(id);
  artBlobs.delete(id);
  const url = fileURLs.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    fileURLs.delete(id);
  }
  const artUrl = artURLs.get(id);
  if (artUrl) {
    URL.revokeObjectURL(artUrl);
    artURLs.delete(id);
  }
  if (state.readyId === id) state.readyId = null;
  const db = await openDB();
  const tx = db.transaction(["tracks", "files", "artwork"], "readwrite");
  tx.objectStore("tracks").delete(id);
  tx.objectStore("files").delete(id);
  tx.objectStore("artwork").delete(id);
  await transactionDone(tx);
}
