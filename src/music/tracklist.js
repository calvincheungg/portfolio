import { gsap } from "gsap";
import { music } from "./music.js";
import { formatTime } from "../lib/format.js";
import { createPopover, popIn, popOut } from "../ui/popover.js";

// Song list for a playlist: opened from the now-playing widget or the CD
// player's list button. Clicking a song jumps straight to it.

const panel = document.getElementById("track-list");
const titleEl = document.getElementById("track-list-title");
const countEl = document.getElementById("track-list-count");
const itemsEl = document.getElementById("track-list-items");
const closeBtn = document.getElementById("track-list-close");
const widget = document.getElementById("now-playing");
const widgetBtn = document.getElementById("now-playing-list");

let shownPlaylist = null; // whose songs are listed

function render(playlist) {
  shownPlaylist = playlist;
  const tracks = music.tracksFor(playlist);
  titleEl.textContent = playlist.title;
  countEl.textContent = tracks.length ? `${tracks.length} songs` : "Songs";

  if (!tracks.length) {
    itemsEl.innerHTML = `<li class="tl-empty">Song list isn't available for this playlist.</li>`;
    return;
  }
  itemsEl.replaceChildren(
    ...tracks.map((track, i) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tl-item";
      button.innerHTML = `
        <span class="tl-num"><span class="tl-index"></span><span class="tl-bars" aria-hidden="true"><i></i><i></i><i></i></span></span>
        <span class="tl-text"><span class="tl-song"></span><span class="tl-artist"></span></span>
        <span class="tl-dur"></span>`;
      button.querySelector(".tl-index").textContent = i + 1;
      button.querySelector(".tl-song").textContent = track.title;
      button.querySelector(".tl-artist").textContent = track.artist;
      button.querySelector(".tl-dur").textContent = formatTime(track.duration);
      button.addEventListener("click", () => music.playTrack(playlist, i));
      li.append(button);
      return li;
    })
  );
  markCurrent();
}

// Highlight the song that's playing (if it's in the listed playlist).
function markCurrent() {
  const { playlist, index, isPaused } = music.state;
  itemsEl.querySelectorAll(".tl-item").forEach((button, i) => {
    const current = playlist === shownPlaylist && i === index;
    button.classList.toggle("is-current", current);
    button.classList.toggle("is-playing", current && !isPaused);
    if (current) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  });
}

// Sit just above the widget when it's showing, else at the bottom.
function place() {
  const widgetVisible = getComputedStyle(widget).visibility !== "hidden";
  const bottom = widgetVisible ? window.innerHeight - widget.getBoundingClientRect().top + 10 : 16;
  panel.style.bottom = `${bottom}px`;
}

gsap.set(panel, { autoAlpha: 0, xPercent: -50 }); // centred via left: 50%

// Clicks on the widget or the 3D scene don't close it (the CD player's own list
// button lives in the scene).
const popover = createPopover({
  panel,
  trigger: widgetBtn,
  isInside: (target) => panel.contains(target) || widget.contains(target) || target.id === "stage",
  show: () => popIn(panel, { y: 16 }, { ease: "back.out(1.6)" }),
  hide: () => popOut(panel, { y: 10 }, { duration: 0.18 }),
});
closeBtn.addEventListener("click", popover.close);

/** Show the songs of `playlist` (defaults to what's playing). */
export function openTrackList(playlist = music.state.playlist) {
  if (!playlist) return;
  if (playlist !== shownPlaylist || !itemsEl.children.length) render(playlist);
  else markCurrent();
  place();
  popover.open();
  itemsEl.querySelector(".is-current")?.scrollIntoView({ block: "center" });
}

// The widget's list button opens what's playing (the popover's own toggle
// handles closing).
widgetBtn.addEventListener("click", () => popover.isOpen && openTrackList());

music.subscribe((state) => {
  widgetBtn.disabled = !state.playlist || !music.tracksFor(state.playlist).length;
  if (!popover.isOpen) return;
  // Follow a different playlist being loaded (e.g. a new CD) while open.
  if (state.playlist && state.playlist !== shownPlaylist) render(state.playlist);
  else markCurrent();
  place();
});

// Keep it above the widget as that changes size (minimize, etc.).
new ResizeObserver(() => popover.isOpen && place()).observe(widget);
