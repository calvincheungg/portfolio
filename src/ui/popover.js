import { gsap } from "gsap";
import { reduceMotion } from "../settings.js";

/**
 * Open/closed state for a floating panel (menu, ladder, list…). It closes on
 * Escape or a click outside, and keeps the trigger's aria-expanded in sync.
 *
 * - `show()` / `hide()` animate the panel.
 * - `trigger` (optional) toggles it when clicked.
 * - `isInside(target)` decides which clicks don't close it (default: the panel
 *   and the trigger).
 */
export function createPopover({ panel, trigger, show, hide, isInside, onChange }) {
  let open = false;
  const inside = isInside ?? ((target) => panel.contains(target) || !!trigger?.contains(target));

  function set(next) {
    if (next === open) return;
    open = next;
    trigger?.setAttribute("aria-expanded", String(open));
    (open ? show : hide)();
    onChange?.(open);
  }

  trigger?.addEventListener("click", () => set(!open));
  document.addEventListener("pointerdown", (e) => {
    if (open && !inside(e.target)) set(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !open) return;
    set(false);
    trigger?.focus();
  });

  return {
    open: () => set(true),
    close: () => set(false),
    toggle: () => set(!open),
    get isOpen() {
      return open;
    },
  };
}

// Where each animated property rests once the panel is in place.
const restingValue = (key) => (key === "scale" ? 1 : 0);

/** Fade a panel in from `from` (e.g. `{ y: 8, scale: 0.94 }`), settling with a bounce. */
export function popIn(el, from, { duration = 0.4, ease = "back.out(2)" } = {}) {
  const rest = Object.fromEntries(
    Object.keys(from)
      .filter((key) => key !== "transformOrigin")
      .map((key) => [key, restingValue(key)])
  );
  gsap.killTweensOf(el);
  if (reduceMotion()) return gsap.set(el, { autoAlpha: 1, ...rest });
  return gsap.fromTo(el, { autoAlpha: 0, ...from }, { autoAlpha: 1, ...rest, duration, ease });
}

/** Fade a panel out, drifting toward `to` (e.g. `{ y: 6 }`). */
export function popOut(el, to = {}, { duration = 0.15 } = {}) {
  gsap.killTweensOf(el);
  if (reduceMotion()) return gsap.set(el, { autoAlpha: 0 });
  return gsap.to(el, { autoAlpha: 0, ...to, duration, ease: "power1.in" });
}
