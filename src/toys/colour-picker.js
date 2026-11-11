import { gsap } from "gsap";
import { asciiFrame, asciiRange } from "../ui/ascii.js";
import { popIn } from "../ui/popover.js";
import { reduceMotion } from "../settings.js";
import * as storage from "../lib/storage.js";
import { hexToHsl, hslToHex, parseHex } from "./colour.js";

// The drawing board's colour picker: an ASCII box of hue / saturation /
// lightness bars and a hex field, with the recent colours along the bottom.
// It drops down from the toolbar under its + button. (Styles in drawing.css.)

// The sliders: key, label, max.
const HSL_SLIDERS = [
  ["h", "Hue", 360],
  ["s", "Saturation", 100],
  ["l", "Lightness", 100],
];

// Colours from the picker that have been drawn with, newest first, per side
// of the board.
const RECENT_KEY = "portfolio-recent-colours";
const MAX_RECENT = 8;

function loadRecent() {
  const recent = { chalk: [], paint: [] };
  const saved = storage.load(RECENT_KEY, {});
  for (const side in recent) {
    if (Array.isArray(saved[side])) recent[side] = saved[side].filter((c) => /^#[0-9a-f]{6}$/.test(c)).slice(0, MAX_RECENT);
  }
  return recent;
}

const PICKER_HTML = `
  <div class="draw-picker-head">
    <i class="draw-preview"></i>
    <label class="draw-hex">hex <span>[#<input type="text" maxlength="7" spellcheck="false" autocomplete="off" aria-label="Hex colour">]</span></label>
  </div>
  ${HSL_SLIDERS.map(
    ([key, label, max]) => `<label class="draw-slider draw-${key}">
      <span>${label}<output data-for="${key}"></output></span>
      <input type="range" data-hsl="${key}" min="0" max="${max}" step="1">
    </label>`
  ).join("")}
  <p class="ascii-rule">recent</p>
  <div class="draw-recent" role="group" aria-label="Recent colours"></div>`;

/**
 * Build the picker into the toolbar `bar`.
 *
 * - `anchor()`: the + button it opens from (kept in step with aria-expanded).
 * - `side()`: "chalk" or "paint" (each keeps its own recent colours).
 * - `colour()`: the colour in use; `erasing()`: true while the eraser is.
 * - `onPick(hex)`: a colour was made or chosen in the picker.
 * - `onOpen()`: it's opening (so other panels can close).
 */
export function createColourPicker({ bar, anchor, side, colour, erasing, onPick, onOpen }) {
  const picker = document.createElement("div");
  picker.className = "draw-picker card";
  picker.id = "draw-picker";
  picker.setAttribute("role", "group");
  picker.setAttribute("aria-label", "Colour picker");
  picker.dataset.asciiTitle = "colour";
  picker.hidden = true;
  picker.innerHTML = PICKER_HTML;
  bar.append(picker);
  const unframe = asciiFrame(picker);

  const hslInputs = picker.querySelectorAll("input[data-hsl]");
  const hexInput = picker.querySelector(".draw-hex input");
  const preview = picker.querySelector(".draw-preview");
  const recentEl = picker.querySelector(".draw-recent");
  const recentRule = picker.querySelector(".ascii-rule");
  const hslBars = [...hslInputs].map((input) => asciiRange(input, { marker: "|" }));
  const recent = loadRecent();

  // The colour picked, as hue / saturation / lightness, and exactly as typed
  // when it was typed (HSL in whole numbers can't hit every hex colour).
  const hsl = { h: 0, s: 60, l: 50 };
  let pickedHex = hslToHex(hsl);
  const pick = (hex) => {
    pickedHex = hex;
    Object.assign(hsl, hexToHsl(hex));
  };

  // ----- Recent colours, bracketed when in use -----
  function renderRecent() {
    const list = recent[side()];
    recentEl.hidden = recentRule.hidden = !list.length; // nothing shown until there are some
    recentEl.innerHTML = list
      .map((c) => `<button class="draw-pick" type="button" data-color="${c}" aria-label="${c}" title="${c}"><span><i style="--c:${c}"></i></span></button>`)
      .join("");
    syncRecent();
  }

  function syncRecent() {
    for (const btn of recentEl.querySelectorAll("[data-color]")) {
      btn.setAttribute("aria-pressed", String(!erasing() && btn.dataset.color === colour()));
    }
  }

  // ----- Showing a colour -----
  // What the picker shows. Usually just `hsl`, but when a colour is chosen
  // from elsewhere (a swatch, a recent colour, the tray) it glides there.
  const shown = { ...hsl };

  /** Show the picker at `shown`; `hex` is the exact colour once it's arrived. */
  function paintPicker(hex) {
    const view = { h: ((Math.round(shown.h) % 360) + 360) % 360, s: Math.round(shown.s), l: Math.round(shown.l) };
    hex ??= hslToHex(view);
    for (const input of hslInputs) {
      const key = input.dataset.hsl;
      input.value = view[key];
      picker.querySelector(`output[data-for="${key}"]`).textContent = key === "h" ? `${view.h}°` : `${view[key]}%`;
    }
    picker.style.setProperty("--h", view.h);
    picker.style.setProperty("--s", `${view.s}%`);
    picker.style.setProperty("--l", `${view.l}%`);
    preview.style.setProperty("--c", hex);
    if (document.activeElement !== hexInput) hexInput.value = hex.slice(1);
    for (const slider of hslBars) slider.update();
  }

  /** Show the current colour straight away (stopping any glide). */
  function syncPicker() {
    gsap.killTweensOf(shown);
    Object.assign(shown, hsl);
    paintPicker(pickedHex);
  }

  /** Pick `hex` and slide the picker's bars, numbers and swatch over to it. */
  function glideTo(hex) {
    pick(hex);
    if (picker.hidden || reduceMotion()) return syncPicker();
    gsap.killTweensOf(shown);
    let h = hsl.h; // the short way round the hue circle
    while (h - shown.h > 180) h -= 360;
    while (shown.h - h > 180) h += 360;
    gsap.to(shown, { h, s: hsl.s, l: hsl.l, duration: 0.5, ease: "power3.out", onUpdate: () => paintPicker(), onComplete: syncPicker });
  }

  // ----- Input -----
  picker.addEventListener("input", (e) => {
    const key = e.target.dataset.hsl;
    if (key) {
      hsl[key] = Number(e.target.value);
      pickedHex = hslToHex(hsl);
    } else if (e.target === hexInput) {
      const hex = parseHex(hexInput.value);
      if (!hex) return; // still typing
      pick(hex);
    }
    syncPicker();
    onPick(pickedHex);
  });
  hexInput.addEventListener("blur", syncPicker); // tidy up whatever was typed
  hexInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") hexInput.blur();
  });
  recentEl.addEventListener("click", (e) => {
    const color = e.target.closest("[data-color]")?.dataset.color;
    if (!color) return;
    glideTo(color);
    onPick(color);
  });

  return {
    get open() {
      return !picker.hidden;
    },

    show(show) {
      picker.hidden = !show;
      anchor()?.setAttribute("aria-expanded", String(show));
      if (!show) return;
      onOpen();
      pick(colour());
      syncPicker();
      renderRecent();
      // Under the + button, kept within the toolbar.
      const btn = anchor();
      const left = btn.offsetLeft + btn.offsetWidth / 2 - picker.offsetWidth / 2;
      picker.style.left = `${Math.max(0, Math.min(left, bar.clientWidth - picker.offsetWidth))}px`;
      popIn(picker, { y: -6, scale: 0.96, transformOrigin: "50% 0%" });
    },

    /** Catch up with a colour chosen elsewhere (a swatch, the tray, the eraser). */
    sync() {
      syncRecent();
      if (!picker.hidden && pickedHex !== colour()) glideTo(colour());
    },

    /** Keep a picker colour that's been drawn with at the front of the recent list. */
    remember(hex) {
      const list = recent[side()];
      if (list[0] === hex) return;
      recent[side()] = [hex, ...list.filter((c) => c !== hex)].slice(0, MAX_RECENT);
      storage.save(RECENT_KEY, recent);
      renderRecent();
    },

    dispose() {
      gsap.killTweensOf(shown);
      for (const slider of hslBars) slider.dispose();
      unframe();
      picker.remove();
    },
  };
}
