import * as THREE from "three";
import { canvas, camera } from "./stage.js";

// Mouse/touch on the 3D stage: hover cursors, grabbing and dragging toys,
// double-click, and opening the toy menu (right-click, or long-press on touch).

const LONG_PRESS_MS = 500;

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
    if (toy.cursor !== "pointer") canvas.classList.add("grabbing");
  });

  canvas.addEventListener("pointermove", (e) => {
    if (longPress && Math.hypot(e.clientX - longPress.x, e.clientY - longPress.y) > 10) cancelLongPress();
    if (!drag) {
      // Toys can ask for a pointer cursor (buttons) instead of the grab hand.
      const toy = getToy();
      if (toy) canvas.classList.toggle(toy.cursor === "pointer" ? "point" : "grab", !!pick(e));
      return;
    }
    setPointer(e);
    drag.handle.move(raycaster.ray);
  });

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
