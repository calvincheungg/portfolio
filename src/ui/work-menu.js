import { gsap } from "gsap";
import { reduceMotion } from "../settings.js";
import { createPopover, popIn, popOut } from "./popover.js";

// The Work drop-down in the top-left corner: the resume, then project links.
// The Resume link opens the in-page viewer (see resume.js).

const panel = document.getElementById("work-menu");
const rows = panel.querySelectorAll(".work-item, .work-heading");

gsap.set(panel, { autoAlpha: 0 });
const menu = createPopover({
  panel,
  trigger: document.getElementById("work-toggle"),
  show() {
    popIn(panel, { y: -8, scale: 0.94, transformOrigin: "0% 0%" });
    // Rows drop in one after another.
    if (!reduceMotion()) {
      gsap.fromTo(rows, { y: -6, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.3, stagger: 0.05, delay: 0.05, ease: "power2.out", overwrite: true });
    }
  },
  hide: () => popOut(panel, { y: -6, scale: 0.97 }),
});

// Picking anything closes the menu.
panel.addEventListener("click", (e) => {
  if (e.target.closest("a")) menu.close();
});
