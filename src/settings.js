// Visitor settings (theme, graphics quality, menu borders, reduce motion), remembered in
// this browser. Anything not chosen yet follows the device.

import { load, save } from "./lib/storage.js";

const KEY = "portfolio-settings";
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const systemReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const isTouch = window.matchMedia("(pointer: coarse)").matches;

const saved = load(KEY, {}); // only what the visitor has actually picked
const state = {
  // "light" | "dark" once picked; until then "system" (follows the device).
  theme: saved.theme ?? "system",
  quality: saved.quality ?? (isTouch ? "low" : "high"), // "low" | "high"
  frame: saved.frame ?? "fleur", // menu borders: a key of FRAME_STYLES (src/ui/ascii.js)
  reduceMotion: saved.reduceMotion ?? systemReducedMotion.matches,
};

const listeners = new Set();
const notify = (key) => listeners.forEach((fn) => fn(key));

export const getSetting = (key) => state[key];

export function setSetting(key, value) {
  if (state[key] === value) return;
  state[key] = value;
  saved[key] = value;
  save(KEY, saved); // (if it can't be saved, it still applies for this visit)
  if (key === "theme") applyTheme();
  if (key === "reduceMotion") applyMotion();
  notify(key);
}

/** Subscribe to changes; returns an unsubscribe function. */
export function onSettingChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const reduceMotion = () => state.reduceMotion;

/** The theme actually showing: "light" or "dark". */
export const theme = () =>
  state.theme === "system" ? (systemDark.matches ? "dark" : "light") : state.theme;

function applyTheme() {
  document.documentElement.dataset.theme = theme();
}

// CSS animations check this too: <html data-reduce-motion>.
function applyMotion() {
  document.documentElement.toggleAttribute("data-reduce-motion", state.reduceMotion);
}

systemDark.addEventListener("change", () => {
  if (state.theme !== "system") return;
  applyTheme();
  notify("theme");
});
systemReducedMotion.addEventListener("change", () => {
  if ("reduceMotion" in saved) return;
  state.reduceMotion = systemReducedMotion.matches;
  applyMotion();
  notify("reduceMotion");
});

applyTheme();
applyMotion();
