import { gsap } from "gsap";
import { reduceMotion } from "../settings.js";

// Hovering (or keyboard-focusing) a corner button (Work, Contact, About,
// Settings) springs its brackets apart, [ Work ], and sprinkles ASCII sparkles
// that fall from it and twinkle out.
//
// The bracket gap is the --spread variable, used by .ascii-btn's brackets
// (ascii.css). Dialog buttons get the spread but not the sparkles.

const SPARKS = ["*", "+", ".", "'", "`", "\u00b7", "\u00b0", "x"]; // · and °
const BURST = 5; // sparkles on arrival
const TRICKLE = 0.12; // seconds between sparkles while you stay

const pick = (list) => list[(Math.random() * list.length) | 0];

/** One sparkle falling from somewhere along the bottom of `btn`. */
function sparkle(btn) {
  const box = btn.getBoundingClientRect();
  const el = document.createElement("span");
  el.className = "ascii-spark";
  el.setAttribute("aria-hidden", "true");
  el.textContent = pick(SPARKS);
  if (Math.random() < 0.4) el.classList.add("dim");
  el.style.left = `${box.left + Math.random() * box.width}px`;
  el.style.top = `${box.bottom - 6}px`;
  document.body.append(el);
  const fall = 26 + Math.random() * 46;
  const duration = 0.9 + Math.random() * 0.7;
  gsap
    .timeline({ onComplete: () => el.remove() })
    .fromTo(el, { autoAlpha: 0, scale: 0.6 }, { autoAlpha: 1, scale: 1, duration: 0.12 })
    .to(el, { y: fall, x: (Math.random() - 0.5) * 22, rotation: (Math.random() - 0.5) * 120, duration, ease: "power1.in" }, 0)
    .to(el, { autoAlpha: 0, duration: duration * 0.45, ease: "power1.in" }, duration * 0.55)
    // Twinkle: change shape once or twice on the way down.
    .call(() => (el.textContent = pick(SPARKS)), null, duration * 0.35)
    .call(() => (el.textContent = pick(SPARKS)), null, duration * 0.7);
}

for (const btn of document.querySelectorAll(".text-btn.ascii-btn")) {
  const corner = !!btn.closest(".overlay");
  let trickle = null;

  const spread = (px, ease) => {
    if (reduceMotion()) return;
    gsap.to(btn, { "--spread": `${px}px`, duration: px ? 0.35 : 0.25, ease, overwrite: true });
  };

  function open() {
    spread(5, "back.out(3)");
    if (!corner || reduceMotion() || trickle) return;
    for (let i = 0; i < BURST; i++) gsap.delayedCall(i * 0.03, sparkle, [btn]);
    const loop = () => {
      sparkle(btn);
      trickle = gsap.delayedCall(TRICKLE * (0.6 + Math.random() * 0.8), loop);
    };
    trickle = gsap.delayedCall(0.2, loop);
  }

  function close() {
    spread(0, "power2.out");
    trickle?.kill();
    trickle = null;
  }

  btn.addEventListener("pointerenter", open);
  btn.addEventListener("pointerleave", close);
  btn.addEventListener("focus", () => btn.matches(":focus-visible") && open());
  btn.addEventListener("blur", close);
}
