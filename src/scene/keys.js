// Keyboard shortcuts for the toys.
//
// A toy's keys only work when they aren't meant for something else: typing in
// a text field, keys a focused control uses itself (Space and Enter press a
// button; arrows move a slider or radio group), keys held with Ctrl / Cmd /
// Alt, or while a menu or dialog is open.

const TYPING = 'textarea, select, [contenteditable], input:not([type="radio"], [type="checkbox"], [type="range"], [type="button"])';
const CONTROL = 'button, a, summary, input, [role="slider"]';
const CONTROL_KEYS = new Set([" ", "Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);

function keysFree(e) {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return false;
  const target = e.target instanceof Element ? e.target : null;
  if (target?.closest(`${TYPING}, [role="menu"], dialog`)) return false;
  if (CONTROL_KEYS.has(e.key) && target?.closest(CONTROL)) return false;
  // An open popover (Work, Contact, Settings, the toy menu, the song list…).
  // (The now-playing widget's minimize button is "expanded" whenever the widget is.)
  return !document.querySelector('dialog[open], [aria-expanded="true"]:not(#now-playing-minimize)');
}

/**
 * Call `handler(key, e)` for each key pressed while the keys are free; `key`
 * is lower case for letters ("s"), else the key's name ("ArrowUp", " ").
 * Return true from it for a key it used (stopping Space and the arrows from
 * scrolling the page). Returns a function that stops listening.
 */
export function onToyKeys(handler) {
  function onKey(e) {
    if (!keysFree(e)) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (handler(key, e)) e.preventDefault();
  }
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}
