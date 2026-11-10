import { reduceMotion } from "../settings.js";

/**
 * A modal <dialog> with animated opening and closing. Escape and clicks on the
 * backdrop close it too (animated, rather than the browser's instant close).
 *
 * - `show()` animates it in (skipped when Reduce motion is on).
 * - `hide(done)` animates it out and must call `done()` when finished.
 * - `onOpen()` runs every time it opens, motion or not.
 */
export function createDialog(dialog, { show, hide, onOpen }) {
  let closing = false;

  function open() {
    if (dialog.open) return;
    closing = false;
    dialog.showModal();
    onOpen?.();
    if (!reduceMotion()) show();
  }

  function close() {
    if (!dialog.open || closing) return;
    closing = true;
    const done = () => dialog.close();
    if (reduceMotion()) done();
    else hide(done);
  }

  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  // The dialog element itself is the backdrop; its card sits inside.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) close();
  });

  return { open, close };
}
