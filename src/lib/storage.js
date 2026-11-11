// Things remembered in this browser between visits (settings, paint, music),
// as JSON in localStorage. Storage can be blocked or full (private windows,
// locked-down browsers), so reads fall back to a default and failed writes
// are ignored: the site works the same, it just won't remember.

/** The value saved under `key`, or `fallback` if there's none (or it can't be read). */
export function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Save `value` under `key`, if the browser allows it. */
export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
