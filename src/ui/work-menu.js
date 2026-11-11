import { gsap } from "gsap";
import { reduceMotion } from "../settings.js";
import { createPopover, popIn, popOut } from "./popover.js";
import { flapIn } from "./splitflap.js";
import { shakeOnHover } from "./shake.js";

// The Work drop-down in the top-left corner: the resume, then project links.
// The Resume link opens the in-page viewer (see resume.js).

const panel = document.getElementById("work-menu");
const rows = panel.querySelectorAll(".work-item, .work-heading, .work-desc");

gsap.set(panel, { autoAlpha: 0 });
const menu = createPopover({
  panel,
  trigger: document.getElementById("work-toggle"),
  show() {
    popIn(panel, { y: -8, scale: 0.94, transformOrigin: "0% 0%" });
    flapIn(panel); // the labels click over like a departures board
    // Rows drop in one after another.
    if (!reduceMotion()) {
      gsap.fromTo(rows, { y: -6, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.3, stagger: 0.05, delay: 0.05, ease: "power2.out", overwrite: true });
    }
  },
  hide() {
    settle();
    popOut(panel, { y: -6, scale: 0.97 });
  },
});

// Picking anything closes the menu.
panel.addEventListener("click", (e) => {
  if (e.target.closest("a")) menu.close();
});

// ----- Resume shakes while you're on it (see shake.js) -----
const resume = document.getElementById("resume-link");
const { settle } = shakeOnHover(resume, resume.querySelector(".shake"));

// ----- Project arrows (->) nudge toward the link while you're on it -----
for (const row of panel.querySelectorAll(".work-item")) {
  const arrow = row.querySelector(".arrow");
  if (!arrow) continue;
  const enter = () => {
    if (reduceMotion()) return;
    gsap.killTweensOf(arrow);
    gsap
      .timeline()
      .to(arrow, { x: 6, duration: 0.3, ease: "back.out(3)" })
      .to(arrow, { x: 3, duration: 0.45, ease: "sine.inOut", repeat: -1, yoyo: true });
  };
  const leave = () => {
    gsap.killTweensOf(arrow);
    gsap.to(arrow, { x: 0, duration: 0.3, ease: "power2.out" });
  };
  row.addEventListener("pointerenter", enter);
  row.addEventListener("pointerleave", leave);
  row.addEventListener("focus", () => row.matches(":focus-visible") && enter());
  row.addEventListener("blur", leave);
}
