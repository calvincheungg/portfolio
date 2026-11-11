import * as THREE from "three";
import { canvas, camera } from "./stage.js";

// Mouse/touch on the 3D stage: hover cursors, grabbing and dragging toys,
// double-click, and opening the toy menu (right-click, or long-press on touch).

const LONG_PRESS_MS = 500;

// Class put on the canvas while hovering a toy, by cursor: the toy's
// `cursorFor(hit)` if it has one, else its `cursor`, else the grab hand.
// ("none" hides it, for toys that draw their own, like the brush preview.)
const CURSOR_CLASS = { grab: "grab", pointer: "point", crosshair: "draw", none: "nocursor" };

/**
 * - `getToy()` returns the current toy (or null while one is loading).
 * - `openMenu(x, y)` opens the toy menu at a screen position.
 * Returns `releaseDrag()`, for letting go when the toy changes.
 */
export function setupPointer({ getToy, openMenu }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let drag = null; // { handle, pointerId }
  let longPress = null; // { timer, x, y }

  function setPointer(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  }

  function pick(e) {
    const toy = getToy();
    if (!toy) return undefined;
    setPointer(e);
    return raycaster.intersectObjects(toy.pickables, false)[0];
  }

  function cancelLongPress() {
    if (longPress) clearTimeout(longPress.timer);
    longPress = null;
  }

  function releaseDrag() {
    cancelLongPress();
    if (!drag) return;
    drag.handle.release();
    if (canvas.hasPointerCapture(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId);
    drag = null;
    canvas.classList.remove("grabbing");
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return; // right-click opens the menu instead
    const hit = pick(e);

    if (!hit) {
      // Touch screens have no right-click: a long press on empty space opens the menu.
      if (e.pointerType === "touch") {
        longPress = {
          x: e.clientX,
          y: e.clientY,
          timer: setTimeout(() => openMenu(e.clientX, e.clientY), LONG_PRESS_MS),
        };
      }
      return;
    }

    const toy = getToy();
    drag = { handle: toy.grab(hit), pointerId: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
    if (!toy.cursor) canvas.classList.add("grabbing");
  });

  function setCursor(kind) {
    for (const [name, cls] of Object.entries(CURSOR_CLASS)) canvas.classList.toggle(cls, name === kind);
  }

  canvas.addEventListener("pointermove", (e) => {
    if (longPress && Math.hypot(e.clientX - longPress.x, e.clientY - longPress.y) > 10) cancelLongPress();
    const toy = getToy();
    const hit = toy && (toy.hover || !drag) ? pick(e) : undefined;
    // Toys that track the pointer (e.g. to show a brush) hear about every
    // move; touch has nothing to hover with.
    toy?.hover?.(e.pointerType === "touch" ? null : hit ?? null);
    if (!drag) {
      if (toy) setCursor(hit ? (toy.cursorFor?.(hit) ?? toy.cursor ?? "grab") : null);
      return;
    }
    setPointer(e);
    drag.handle.move(raycaster.ray);
  });

  canvas.addEventListener("pointerleave", () => getToy()?.hover?.(null));

  // Toys can use the scroll wheel over themselves (the CD player's card file).
  canvas.addEventListener(
    "wheel",
    (e) => {
      const toy = getToy();
      if (toy?.wheel?.(pick(e) ?? null, e)) e.preventDefault();
    },
    { passive: false }
  );

  canvas.addEventListener("pointerup", releaseDrag);
  canvas.addEventListener("pointercancel", releaseDrag);

  canvas.addEventListener("dblclick", (e) => {
    const toy = getToy();
    const hit = toy?.doubleClick && pick(e);
    if (hit) toy.doubleClick(hit);
  });

  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    releaseDrag();
    openMenu(e.clientX, e.clientY);
  });

  return { releaseDrag };
}
