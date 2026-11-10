import { gsap } from "gsap";
import { reduceMotion } from "../settings.js";
import { createPopover } from "./popover.js";

// Contact links unroll from the Contact button like a rope ladder.

const wrap = document.querySelector(".contact");
const ladder = document.getElementById("contact-ladder");
const ropes = ladder.querySelectorAll(".rope");
const rungs = ladder.querySelectorAll(".rung");

// One timeline for the unroll; closing plays it backwards, faster.
const unroll = gsap
  .timeline({ paused: true })
  .set(ladder, { autoAlpha: 1 })
  // Ropes unfurl downward from the Contact link.
  .fromTo(ropes, { scaleY: 0 }, { scaleY: 1, duration: 0.45, ease: "power2.out" }, 0)
  // Each rung flips down off the roll, one after another, and bounces into place.
  .fromTo(
    rungs,
    { rotationX: -110, y: -24, autoAlpha: 0, transformOrigin: "50% 0%" },
    { rotationX: 0, y: 0, autoAlpha: 1, duration: 0.9, ease: "elastic.out(1, 0.45)", stagger: 0.1 },
    0.06
  )
  // The whole ladder swings from its top and settles.
  .fromTo(
    ladder,
    { rotation: -7, transformOrigin: "50% 0%" },
    { rotation: 0, duration: 1.5, ease: "elastic.out(1, 0.28)" },
    0
  );

createPopover({
  panel: ladder,
  trigger: document.getElementById("contact-toggle"),
  isInside: (target) => wrap.contains(target),
  show: () => (reduceMotion() ? unroll.progress(1).pause() : unroll.timeScale(1).play()),
  hide: () => (reduceMotion() ? unroll.progress(0).pause() : unroll.timeScale(2.2).reverse()),
});
