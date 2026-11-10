/** Milliseconds as a clock time: "3:45". */
export function formatTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Milliseconds as a running length: "47 min" or "1 hr 12 min". */
export function formatLength(ms) {
  const minutes = Math.round(ms / 60000);
  const h = Math.floor(minutes / 60);
  return h ? `${h} hr ${minutes % 60} min` : `${minutes} min`;
}
