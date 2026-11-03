import { gsap } from "gsap";
import TRACKS from "virtual:playlist-tracks";
import { reduceMotion } from "./settings.js";

// Music playback through Spotify's embedded player, plus the "now playing"
// widget that keeps it going while visitors switch toys.
//
// Visitors can't sign in to Spotify through the site, so this uses Spotify's
// official embed: people logged in to Spotify in that browser hear full tracks,
// everyone else hears 30-second previews. The embed stays visible in the widget
// (Spotify expects its player to be shown).
//
// The embed doesn't say which song is playing and can't skip tracks, so we
// play a playlist one track at a time from its track list (TRACKS, fetched by
// the plugin in vite.config.js). If a list is empty (Spotify unreachable at
// build time) the playlist plays as a whole, without track names or skipping.

const API_URL = "https://open.spotify.com/embed/iframe-api/v1";
const RESTART_THRESHOLD = 3000; // ms in: "back" restarts the song instead

const widget = document.getElementById("now-playing");
const labelEl = document.getElementById("now-playing-label");
const titleEl = document.getElementById("now-playing-title");
const discEl = widget.querySelector(".np-disc");
const prevBtn = document.getElementById("now-playing-prev");
const toggleBtn = document.getElementById("now-playing-toggle");
const nextBtn = document.getElementById("now-playing-next");
const ejectBtn = document.getElementById("now-playing-eject");
const minimizeBtn = document.getElementById("now-playing-minimize");
const embedSlot = document.getElementById("now-playing-embed");
const seekInput = document.getElementById("now-playing-seek");
const elapsedEl = document.getElementById("now-playing-elapsed");
const totalEl = document.getElementById("now-playing-total");

// position/duration are in ms, as Spotify reports them; positionAt is when
// position was last reported, so the scrubber can move smoothly in between.
const state = {
  playlist: null,
  queue: [], // the playlist's tracks
  index: 0,
  track: null, // { title, artist, uri, duration } or null if unknown
  isPaused: true,
  position: 0,
  duration: 0,
  positionAt: 0,
};
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn(state));

let apiPromise = null;
let controllerPromise = null;

// https://open.spotify.com/playlist/ID?si=… → spotify:playlist:ID
function toUri(url) {
  const match = url.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(playlist|album|track)\/([A-Za-z0-9]+)/);
  return match ? `spotify:${match[1]}:${match[2]}` : url;
}

function loadApi() {
  apiPromise ??= new Promise((resolve, reject) => {
    window.onSpotifyIframeApiReady = resolve;
    const script = document.createElement("script");
    script.src = API_URL;
    script.async = true;
    script.onerror = () => {
      apiPromise = null;
      reject(new Error("Couldn't load Spotify's player"));
    };
    document.head.append(script);
  });
  return apiPromise;
}

function getController(uri) {
  controllerPromise ??= loadApi().then(
    (api) =>
      new Promise((resolve) => {
        const slot = document.createElement("div");
        embedSlot.replaceChildren(slot);
        api.createController(slot, { uri, width: "100%", height: 80 }, (controller) => {
          controller.addListener("playback_update", onPlaybackUpdate);
          resolve(controller);
        });
      })
  );
  return controllerPromise;
}

let endedTrack = null; // the track we've already advanced past

function onPlaybackUpdate(e) {
  if (!state.playlist) return;
  state.isPaused = e.data.isPaused;
  state.position = e.data.position ?? state.position;
  state.duration = e.data.duration ?? state.duration;
  state.positionAt = performance.now();
  notify();

  // When a track finishes, Spotify reports position == duration (still "not
  // paused", and sometimes twice) and then goes quiet. Move on, once.
  const atEnd = state.duration > 0 && state.position >= state.duration - 250;
  if (atEnd && state.queue.length && endedTrack !== state.track) {
    endedTrack = state.track;
    music.next();
  }
}

// Load whatever is at state.index (or the whole playlist if there's no list).
async function startTrack() {
  state.track = state.queue[state.index] ?? null;
  Object.assign(state, { position: 0, duration: 0, positionAt: performance.now(), isPaused: false });
  notify();
  const uri = state.track?.uri ?? toUri(state.playlist.url);
  try {
    const firstLoad = !controllerPromise;
    const controller = await getController(uri);
    if (!firstLoad) controller.loadUri(uri);
    controller.play();
  } catch (err) {
    console.error(err);
    state.isPaused = true;
    notify();
  }
}

// ---------- Widget ----------

gsap.set(widget, { autoAlpha: 0, xPercent: -50 }); // centred via left: 50%
let widgetShown = false;
let minimized = false;

// Collapse to just the title row. The Spotify frame is only shrunk, never
// removed, so the music keeps playing.
function setMinimized(next) {
  minimized = next;
  minimizeBtn.setAttribute("aria-expanded", String(!minimized));
  minimizeBtn.setAttribute("aria-label", minimized ? "Expand player" : "Minimize player");
  const size = minimized ? { height: 0, paddingTop: 0 } : { height: 90, paddingTop: 10 };
  gsap.killTweensOf(embedSlot);
  if (reduceMotion()) gsap.set(embedSlot, size);
  else gsap.to(embedSlot, { ...size, duration: 0.35, ease: minimized ? "power2.inOut" : "back.out(1.4)" });
}

function showWidget(show) {
  if (show === widgetShown) return;
  widgetShown = show;
  gsap.killTweensOf(widget);
  if (reduceMotion()) gsap.set(widget, { autoAlpha: show ? 1 : 0, y: 0 });
  else if (show) gsap.fromTo(widget, { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: "back.out(1.6)" });
  else gsap.to(widget, { autoAlpha: 0, y: 16, duration: 0.2, ease: "power1.in" });
}

listeners.add(() => {
  const { playlist, track } = state;
  // "Artist: Song" when we know the track; otherwise the playlist's name.
  titleEl.textContent = track ? `${track.artist}: ${track.title}` : (playlist?.title ?? "");
  titleEl.title = titleEl.textContent; // full text on hover when truncated
  labelEl.textContent = track && playlist ? `Now playing · ${playlist.title}` : "Now playing";
  discEl.style.setProperty("--label", playlist?.color ?? "transparent");
  discEl.classList.toggle("spinning", !!playlist && !state.isPaused);

  widget.classList.toggle("is-paused", state.isPaused);
  toggleBtn.setAttribute("aria-label", state.isPaused ? "Play" : "Pause");
  prevBtn.disabled = nextBtn.disabled = !state.queue.length;
});

minimizeBtn.addEventListener("click", () => setMinimized(!minimized));
prevBtn.addEventListener("click", () => music.previous());
toggleBtn.addEventListener("click", () => music.toggle());
nextBtn.addEventListener("click", () => music.next());
ejectBtn.addEventListener("click", () => music.stop());

// ---------- Scrubber ----------

const formatTime = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

let scrubbing = false; // the visitor is dragging it

function currentPosition() {
  const elapsed = state.isPaused ? 0 : performance.now() - state.positionAt;
  return Math.min(state.position + elapsed, state.duration);
}

function drawScrubber(position = currentPosition()) {
  const duration = state.duration;
  seekInput.max = String(duration);
  seekInput.value = String(position);
  seekInput.disabled = !duration;
  seekInput.style.setProperty("--progress", duration ? `${(position / duration) * 100}%` : "0%");
  elapsedEl.textContent = formatTime(position);
  totalEl.textContent = formatTime(duration);
}

// Spotify only reports the position every so often; animate in between.
function tickScrubber() {
  if (widgetShown && !scrubbing) drawScrubber();
  requestAnimationFrame(tickScrubber);
}
requestAnimationFrame(tickScrubber);

seekInput.addEventListener("input", () => {
  scrubbing = true;
  drawScrubber(Number(seekInput.value));
});

seekInput.addEventListener("change", () => {
  scrubbing = false;
  music.seek(Number(seekInput.value));
});

// ---------- Public API ----------

export const music = {
  get state() {
    return state;
  },

  /** The songs in a playlist (empty if its track list couldn't be fetched). */
  tracksFor(playlist) {
    return TRACKS[playlist.url] ?? [];
  },

  /** Jump to a song in a playlist, loading that playlist if needed. */
  playTrack(playlist, index) {
    showWidget(true);
    if (state.playlist !== playlist) {
      state.playlist = playlist;
      state.queue = this.tracksFor(playlist);
    }
    state.index = index;
    startTrack();
  },

  /** Play a playlist from PLAYLISTS (resumes it if it's the current one). */
  async play(playlist) {
    showWidget(true);
    if (state.playlist === playlist) {
      if (state.isPaused) this.toggle();
      return;
    }
    state.playlist = playlist;
    state.queue = this.tracksFor(playlist);
    state.index = 0;
    await startTrack();
  },

  async toggle() {
    if (!state.playlist || !controllerPromise) return;
    (await controllerPromise).togglePlay();
  },

  next() {
    if (!state.queue.length) return;
    state.index = (state.index + 1) % state.queue.length;
    startTrack();
  },

  /** Back to the start of the song, or to the previous one if near the start. */
  previous() {
    if (!state.queue.length) return;
    if (currentPosition() > RESTART_THRESHOLD) {
      this.seek(0);
      return;
    }
    state.index = (state.index - 1 + state.queue.length) % state.queue.length;
    startTrack();
  },

  async seek(ms) {
    state.position = ms;
    state.positionAt = performance.now();
    (await controllerPromise)?.seek(ms / 1000);
  },

  /** Stop and hide the widget. */
  async stop() {
    if (!state.playlist) return;
    Object.assign(state, { playlist: null, queue: [], track: null, isPaused: true });
    notify();
    showWidget(false);
    (await controllerPromise)?.pause();
  },

  /** Subscribe to state changes; returns an unsubscribe function. */
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
