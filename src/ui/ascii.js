// ASCII-art pieces for the site's menus and panels.
//
// asciiFrame(el)  draws a box of text characters behind el's content, sized to
//                 whole characters and redrawn whenever el resizes. The look
//                 comes from the "frame" setting (FRAME_STYLES below). A
//                 `data-ascii-title` on el is written into the top edge:
//                 +-[ Title ]------+
// asciiRange(input)  shows a range input as a text bar, e.g. [#####-----].
//
// Both use the .ascii-frame / .ascii-bar text styles in ascii.css.

import { getSetting, onSettingChange } from "../settings.js";

const cell = { w: 0, h: 0 }; // one character of the frame font, in px
const redraws = new Set();

function measure() {
  const probe = document.createElement("span");
  probe.className = "ascii-frame";
  probe.style.visibility = "hidden";
  probe.textContent = "-".repeat(100);
  document.body.append(probe);
  cell.w = probe.getBoundingClientRect().width / 100;
  cell.h = parseFloat(getComputedStyle(probe).lineHeight);
  probe.remove();
}

// Character widths change once Space Mono arrives.
document.fonts?.ready.then(() => {
  cell.w = 0;
  for (const redraw of redraws) redraw();
});

onSettingChange((key) => {
  if (key === "frame") for (const redraw of redraws) redraw();
});

/** Characters (axis "w") or lines (axis "h") that fit in `px`, at least `min`. */
function fit(px, axis, min = 2) {
  if (!cell.w) measure();
  return Math.max(min, Math.floor(px / cell[axis]));
}

// Border styles. Each gives the top-left `corner` (the other corners are
// mirrored; `foot` replaces it on the bottom edge), the `fill` pattern along
// the edges, the left-side character for row i of n (mirrored on the right),
// how a title is wrapped, and an optional `mid` ornament centred on the bottom.
export const FRAME_STYLES = {
  plain: { corner: "+", fill: "-", side: () => "|", title: (t) => `-[ ${t} ]` },
  round: { corner: ".", foot: "'", fill: "-", side: () => "|", title: (t) => `-( ${t} )` },
  double: { corner: "#", fill: "=", side: () => "|", title: (t) => `=[ ${t} ]` },
  // Roses in the corners, a vine round the edges and a fleur-de-lis below.
  fleur: {
    corner: "@}",
    fill: "-,-'",
    side: (i, n) => (n > 8 && i === n >> 1 ? "@" : i % 2 ? "(" : ")"),
    title: (t) => `-~[ ${t} ]~`,
    mid: "'-,(\\|/),-'",
  },
};

const MIRROR = { "(": ")", ")": "(", "{": "}", "}": "{", "[": "]", "]": "[", "<": ">", ">": "<", "/": "\\", "\\": "/" };
const mirror = (s) => [...s].reverse().map((c) => MIRROR[c] ?? c).join("");
const tile = (pattern, n) => pattern.repeat(Math.ceil(n / pattern.length)).slice(0, n);

/** Write `text` over `line` starting at column `at` (clipped to the line). */
const stamp = (line, text, at) => line.slice(0, at) + text.slice(0, line.length - at) + line.slice(at + text.length);

/** The frame's text for a box `cols` characters by `rows` lines. */
export function drawFrame(cols, rows, title, style = FRAME_STYLES[getSetting("frame")] ?? FRAME_STYLES.plain) {
  const edge = (corner) => {
    if (cols < corner.length * 2 + 1) corner = corner.at(-1) === style.fill[0] ? corner.slice(-1) : corner[0];
    return corner + tile(style.fill, cols - corner.length * 2) + mirror(corner);
  };
  let top = edge(style.corner);
  if (title) top = stamp(top, style.title(title), style.corner.length).slice(0, cols - style.corner.length) + mirror(style.corner);
  let bottom = edge(style.foot ?? style.corner);
  const { mid } = style;
  if (mid && cols >= mid.length + 2 * style.corner.length + 4) bottom = stamp(bottom, mid, (cols - mid.length) >> 1);
  const lines = [top];
  for (let i = 1; i < rows - 1; i++) {
    const side = style.side(i, rows);
    lines.push(side + " ".repeat(cols - 2) + mirror(side));
  }
  lines.push(bottom);
  return lines.join("\n");
}

/** Frame el in text characters. Returns a function that removes the frame. */
export function asciiFrame(el) {
  const frame = document.createElement("span");
  frame.className = "ascii-frame";
  frame.setAttribute("aria-hidden", "true");
  el.prepend(frame);

  function redraw() {
    // Rounded down so the frame never spills past el (some cards clip).
    frame.textContent = drawFrame(fit(el.offsetWidth, "w"), fit(el.offsetHeight, "h"), el.dataset.asciiTitle);
  }

  const observer = new ResizeObserver(redraw);
  observer.observe(el);
  redraws.add(redraw);
  return () => {
    observer.disconnect();
    redraws.delete(redraw);
    frame.remove();
  };
}

/**
 * Show a range input as a text bar. The input stays on top (invisible) so it
 * still takes clicks, drags and keys. Returns `{ update, dispose }`: call
 * update() when the value is changed from script. `fill` and `head` draw the
 * filled part:
 * "#" gives [####----], "=" with head ">" gives [===>----].
 * With `marker` the bar is a track of `fill` with just a marker at the value,
 * e.g. [####|######] (the marker is a .ascii-mark span, so it can be styled).
 */
export function asciiRange(input, { fill = "#", head = "", marker = "" } = {}) {
  const wrap = document.createElement("span");
  wrap.className = "ascii-range";
  input.before(wrap);
  const bar = document.createElement("span");
  bar.className = "ascii-bar";
  bar.setAttribute("aria-hidden", "true");
  wrap.append(bar, input);
  const mark = document.createElement("span");
  mark.className = "ascii-mark";
  mark.textContent = marker;

  function update() {
    const cells = fit(wrap.clientWidth, "w", 6) - 2;
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 0;
    const t = Math.min(1, Math.max(0, max > min ? (Number(input.value) - min) / (max - min) : 0));
    if (marker) {
      const at = Math.round(t * (cells - 1));
      bar.replaceChildren(`[${fill.repeat(at)}`, mark, `${fill.repeat(cells - 1 - at)}]`);
      return;
    }
    const filled = Math.round(t * cells);
    const done = filled && head ? fill.repeat(filled - 1) + head : fill.repeat(filled);
    bar.textContent = `[${done}${"-".repeat(cells - filled)}]`;
  }

  input.addEventListener("input", update);
  const observer = new ResizeObserver(update);
  observer.observe(wrap);
  redraws.add(update);
  update();
  return {
    update,
    dispose() {
      observer.disconnect();
      redraws.delete(update);
    },
  };
}
