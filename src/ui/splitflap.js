import { gsap } from "gsap";
import { reduceMotion } from "../settings.js";

// Split-flap text, like an airport departures board: each letter clicks
// through the alphabet in order until it lands on the right one, the letters
// starting one after another from the left.
//
// flapIn(root)  plays it on every [data-flap] element inside root. Long text
//               (a paragraph) flaps faster, so it all settles in about a second.
//
// Screen readers get the real text from a hidden copy beside each element,
// rather than the letters flicking past.

const FLAPS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const FLIP = 0.04; // seconds per flap
const STAGGER = 0.035; // seconds between neighbouring letters starting

/** Flap host's text in to its real text (kept in data-flap-text). */
function flap(host, startDelay) {
  // First time: split host into the letters people see (which flap) and a
  // hidden copy of the real text for screen readers.
  if (!host.flapLetters) {
    const letters = document.createElement("span");
    letters.setAttribute("aria-hidden", "true");
    letters.textContent = host.textContent;
    const copy = document.createElement("span");
    copy.className = "visually-hidden";
    copy.textContent = host.textContent;
    host.dataset.flapText = host.textContent;
    host.replaceChildren(letters, copy);
    host.flapLetters = letters;
  }
  const el = host.flapLetters;
  const text = host.dataset.flapText;
  const letterCount = text.replace(/\s/g, "").length;
  // Short labels: one letter after another. Long text: spread over ~1s.
  const stagger = Math.min(STAGGER, 1 / Math.max(letterCount, 1));
  const maxFlaps = letterCount > 40 ? 6 : 13;
  gsap.killTweensOf(el.flapClock ?? {});
  if (reduceMotion()) {
    el.textContent = text;
    return;
  }
  // For each letter: when it starts, and the run of flaps it shows on the way.
  const letters = [...text].map((ch, i) => {
    const at = FLAPS.indexOf(ch);
    if (at < 0) return { ch, start: 0, flaps: [] }; // spaces and symbols just appear
    const count = 3 + Math.floor(Math.random() * (maxFlaps - 2));
    const flaps = Array.from({ length: count }, (_, k) => FLAPS[(at - count + k + FLAPS.length * 2) % FLAPS.length]);
    return { ch, start: i * stagger, flaps };
  });
  const end = Math.max(...letters.map((l) => l.start + l.flaps.length * FLIP));
  const clock = (el.flapClock = { t: 0 });
  const paint = () => {
    el.textContent = letters
      .map(({ ch, start, flaps }) => {
        if (!flaps.length) return ch;
        const n = Math.floor((clock.t - start) / FLIP);
        if (n < 0) return flaps[0];
        return n < flaps.length ? flaps[n] : ch;
      })
      .join("");
  };
  paint();
  gsap.to(clock, { t: end, duration: end, delay: startDelay, ease: "none", onUpdate: paint, onComplete: () => (el.textContent = text) });
}

/** Flap in every [data-flap] inside root, each a moment after the last. */
export function flapIn(root, { delay = 0.05, gap = 0.08 } = {}) {
  root.querySelectorAll("[data-flap]").forEach((el, i) => flap(el, delay + i * gap));
}
