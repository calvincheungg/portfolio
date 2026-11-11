// ASCII-art pieces for the site's menus and panels.
//
// asciiFrame(el)  draws a +----+ box of text characters behind el's content,
//                 sized to whole characters and redrawn whenever el resizes.
//                 A `data-ascii-title` on el is written into the top edge:
//                 +-[ Title ]------+
// asciiRange(input)  shows a range input as a text bar, e.g. [#####-----].
//
// Both use the .ascii-frame / .ascii-bar text styles in ascii.css.

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

/** Characters (axis "w") or lines (axis "h") that fit in `px`, at least `min`. */
function fit(px, axis, min = 2) {
  if (!cell.w) measure();
  return Math.max(min, Math.floor(px / cell[axis]));
}

/** Frame el in text characters. Returns a function that removes the frame. */
export function asciiFrame(el) {
  const frame = document.createElement("span");
  frame.className = "ascii-frame";
  frame.setAttribute("aria-hidden", "true");
  el.prepend(frame);

  function redraw() {
    // Rounded down so the frame never spills past el (some cards clip).
    const cols = fit(el.offsetWidth, "w");
    const rows = fit(el.offsetHeight, "h");
    const edge = `+${"-".repeat(cols - 2)}+`;
    const title = el.dataset.asciiTitle;
    const top = title ? `+${`-[ ${title} ]${"-".repeat(cols)}`.slice(0, cols - 2)}+` : edge;
    const side = `|${" ".repeat(cols - 2)}|`;
    frame.textContent = [top, ...Array(rows - 2).fill(side), edge].join("\n");
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
 */
export function asciiRange(input, { fill = "#", head = "" } = {}) {
  const wrap = document.createElement("span");
  wrap.className = "ascii-range";
  input.before(wrap);
  const bar = document.createElement("span");
  bar.className = "ascii-bar";
  bar.setAttribute("aria-hidden", "true");
  wrap.append(bar, input);

  function update() {
    const cells = fit(wrap.clientWidth, "w", 6) - 2;
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 0;
    const t = max > min ? (Number(input.value) - min) / (max - min) : 0;
    const filled = Math.round(Math.min(1, Math.max(0, t)) * cells);
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
