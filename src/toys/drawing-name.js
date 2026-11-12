import { makeCanvas, seeded } from "./textures.js";
import { grey, hexToRGB, toned } from "./colour.js";

// "Calvin", already painted on the drawing board's canvas when it opens: in
// blackletter, in red with the thickest flat brush, as if by mouse (confident
// strokes along the letters, a little off, overshooting the ends).
//
// The letters are thinned to their centre lines, which are then painted over
// as brush strokes, in colour and in relief (how high the paint stands).

// Seeded afresh for each painting, so it's the same every visit.
let rand = seeded(1);

const NAME_TEXT = "Calvin";
export const NAME_FONT = '"UnifrakturMaguntia"'; // blackletter, loaded with the site's Google Fonts
const NAME_INK = "#c0392b";
const NAME_PAINT = { thickness: 1, chunk: 0.35 }; // raised, a little streaky
const SKELETON_SCALE = 3; // letters are thinned to centre lines at 1/3 ink resolution
const FLAT_ANGLE = (-40 * Math.PI) / 180; // the brush's edge, from horizontal

/** Path through `points`, shifted by (dx, dy). */
function tracePath(c, points, dx = 0, dy = 0) {
  c.beginPath();
  points.forEach(([x, y], i) => (i ? c.lineTo(x + dx, y + dy) : c.moveTo(x + dx, y + dy)));
}

/** Font, position and size of the name on the ink canvas. */
function nameLayout(c, fontFamily, ink) {
  let size = ink.h * 0.46;
  c.font = `${size}px ${fontFamily}`;
  size *= Math.min(1, (ink.w * 0.7) / c.measureText(NAME_TEXT).width);
  const font = `${size}px ${fontFamily}`;
  c.font = font;
  const m = c.measureText(NAME_TEXT);
  return {
    font,
    x: (ink.w - m.width) / 2,
    baseline: ink.h / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2,
  };
}

/**
 * One flat-brush stroke along `points`: the ribbon the brush's edge sweeps out
 * plus bristle streaks, in colour (into `cc`) and relief (into `rc`). `lift`
 * raises it, for paint laid over other paint.
 */
function flatStroke(cc, rc, points, width, color, { thickness, chunk, lift = 0 }) {
  const ex = Math.cos(FLAT_ANGLE);
  const ey = Math.sin(FLAT_ANGLE);
  const hx = ex * width * 0.45;
  const hy = ey * width * 0.45;
  for (const [c, fill] of [[cc, color], [rc, grey(150 * thickness + lift)]]) {
    c.beginPath();
    points.forEach(([px, py]) => c.lineTo(px + hx, py + hy));
    [...points].reverse().forEach(([px, py]) => c.lineTo(px - hx, py - hy));
    c.closePath();
    c.fillStyle = c.strokeStyle = fill;
    c.fill();
    c.lineWidth = width * 0.12; // so tight turns and dabs still leave paint
    c.stroke();
  }
  const rgb = hexToRGB(color);
  const count = Math.round(Math.min(26, Math.max(8, width / 1.8)));
  for (let b = 0; b < count; b++) {
    const along = (rand() - 0.5) * width * (1 + 0.1 * chunk);
    const across = (rand() - 0.5) * width * (0.06 + 0.1 * chunk);
    const dx = ex * along - ey * across;
    const dy = ey * along + ex * across;
    const tone = (rand() - 0.5) * (0.03 + 0.22 * chunk);
    const ridge = (150 + (rand() - 0.5) * 210 * chunk) * thickness + lift;
    const bristle = width * (0.05 + rand() * 0.06);
    for (const [c, stroke] of [[cc, toned(rgb, tone)], [rc, grey(ridge)]]) {
      tracePath(c, points, dx, dy);
      c.strokeStyle = stroke;
      c.lineWidth = bristle;
      c.stroke();
    }
  }
}

/**
 * A daub of paint for the dot on the i, as dabbed with a mouse: a lumpy,
 * slightly squashed blob at a tilt, a little flick where the brush dragged
 * off, and streaks across it in the brush's direction. Colour and relief as
 * flatStroke.
 */
function daub(cc, rc, x, y, radius, color, paint) {
  const { thickness, chunk } = paint;
  const tilt = rand() * Math.PI;
  const squash = [1.1 + rand() * 0.15, 0.82 + rand() * 0.1];
  const lumps = [0, 1].map(() => ({ amp: 0.06 + rand() * 0.07, phase: rand() * 6.3 }));
  const outline = Array.from({ length: 28 }, (_, k) => {
    const a = (k / 28) * Math.PI * 2;
    const r = radius * (1 + lumps[0].amp * Math.sin(2 * a + lumps[0].phase) + lumps[1].amp * Math.sin(3 * a + lumps[1].phase));
    const px = Math.cos(a) * r * squash[0];
    const py = Math.sin(a) * r * squash[1];
    return [x + px * Math.cos(tilt) - py * Math.sin(tilt), y + px * Math.sin(tilt) + py * Math.cos(tilt)];
  });
  const rgb = hexToRGB(color);
  for (const [c, fill] of [[cc, color], [rc, grey(150 * thickness)]]) {
    tracePath(c, outline);
    c.closePath();
    c.fillStyle = fill;
    c.fill();
  }
  // Streaks across it, as the brush moved through.
  const ex = Math.cos(FLAT_ANGLE + Math.PI / 2);
  const ey = Math.sin(FLAT_ANGLE + Math.PI / 2);
  for (const c of [cc, rc]) {
    c.save();
    tracePath(c, outline);
    c.closePath();
    c.clip();
  }
  for (let b = 0; b < 9; b++) {
    const off = (rand() - 0.5) * radius * 2;
    const ox = x - ey * off;
    const oy = y + ex * off;
    const line = [[ox - ex * radius * 1.5, oy - ey * radius * 1.5], [ox + ex * radius * 1.5, oy + ey * radius * 1.5]];
    const tone = (rand() - 0.5) * (0.03 + 0.18 * chunk);
    const ridge = (150 + (rand() - 0.5) * 160 * chunk) * thickness;
    const width = radius * (0.08 + rand() * 0.12);
    for (const [c, stroke] of [[cc, toned(rgb, tone)], [rc, grey(ridge)]]) {
      tracePath(c, line);
      c.strokeStyle = stroke;
      c.lineWidth = width;
      c.stroke();
    }
  }
  for (const c of [cc, rc]) c.restore();
  // The flick where the brush left.
  const away = rand() * Math.PI * 2;
  const reach = radius * (0.9 + rand() * 0.5);
  flatStroke(
    cc,
    rc,
    [[x + Math.cos(away) * radius * 0.4, y + Math.sin(away) * radius * 0.4], [x + Math.cos(away) * reach, y + Math.sin(away) * reach]],
    radius * 0.9,
    color,
    paint
  );
}

/** Thin a 0/1 pixel mask (in place) to one-pixel-wide centre lines (Zhang–Suen). */
function thin(on, w, h) {
  const remove = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const pass of [0, 1]) {
      remove.length = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!on[i]) continue;
          // Neighbours clockwise from straight up.
          const n = [on[i - w], on[i - w + 1], on[i + 1], on[i + w + 1], on[i + w], on[i + w - 1], on[i - 1], on[i - w - 1]];
          const count = n.reduce((a, b) => a + b, 0);
          if (count < 2 || count > 6) continue;
          let rises = 0;
          for (let k = 0; k < 8; k++) if (!n[k] && n[(k + 1) % 8]) rises++;
          if (rises !== 1) continue;
          const [up, , right, , down, , left] = n;
          if (pass === 0 ? up * right * down || right * down * left : up * right * left || up * down * left) continue;
          remove.push(i);
        }
      }
      for (const i of remove) on[i] = 0;
      if (remove.length) changed = true;
    }
  }
}

/**
 * Follow one-pixel-wide lines into paths of pixel indexes. A path that
 * touches no other is marked `alone` (dots, and some whole letters).
 */
function traceLines(on, w) {
  const offsets = [-w, 1, w, -1, -w - 1, -w + 1, w + 1, w - 1]; // straight neighbours first
  const near = (i) => offsets.map((d) => i + d).filter((j) => on[j]);
  const seen = new Uint8Array(on.length);
  const paths = [];
  function walk(start) {
    const path = [];
    // Start from a line already drawn, if this one branches off it.
    const from = near(start).find((j) => seen[j]);
    if (from !== undefined) path.push(from);
    let joined = from !== undefined;
    for (let i = start; i !== undefined; ) {
      seen[i] = 1;
      path.push(i);
      const next = near(i).filter((j) => !seen[j]);
      if (!next.length) {
        // Run into a line already drawn? Meet it.
        const meet = near(i).find((j) => seen[j] && !path.slice(-4).includes(j));
        if (meet !== undefined) {
          path.push(meet);
          joined = true;
        }
        break;
      }
      i = next[0];
    }
    // Drop the little spurs thinning leaves on serifs; keep dots (like the i's).
    path.alone = !joined;
    if (path.length >= 6 || path.alone) paths.push(path);
  }
  for (let i = 0; i < on.length; i++) if (on[i] && !seen[i] && near(i).length === 1) walk(i); // ends
  for (let i = 0; i < on.length; i++) if (on[i] && !seen[i]) walk(i); // loops
  return paths;
}

/** The centre lines of the name's letters, as paths in ink pixels. */
function letterLines(layout, ink) {
  const w = Math.ceil(ink.w / SKELETON_SCALE);
  const h = Math.ceil(ink.h / SKELETON_SCALE);
  const c = makeCanvas(w, h).getContext("2d", { willReadFrequently: true });
  c.scale(1 / SKELETON_SCALE, 1 / SKELETON_SCALE);
  c.font = layout.font;
  c.fillText(NAME_TEXT, layout.x, layout.baseline);
  const alpha = c.getImageData(0, 0, w, h).data;
  const on = new Uint8Array(w * h);
  for (let i = 0; i < on.length; i++) on[i] = alpha[i * 4 + 3] > 127 ? 1 : 0;
  thin(on, w, h);
  return traceLines(on, w).map((path) =>
    Object.assign(
      path.map((i) => [((i % w) + 0.5) * SKELETON_SCALE, (Math.floor(i / w) + 0.5) * SKELETON_SCALE]),
      { alone: path.alone }
    )
  );
}

/** Average each point with its neighbours, `passes` times (irons out pixel steps). */
function smoothPath(points, passes) {
  let pts = points;
  for (let p = 0; p < passes; p++) {
    pts = pts.map((pt, i) => {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      return [(a[0] + 2 * pt[0] + b[0]) / 4, (a[1] + 2 * pt[1] + b[1]) / 4];
    });
  }
  return pts;
}

/** Points every `step` pixels along the path. */
function resample(points, step) {
  const out = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const len = Math.hypot(bx - ax, by - ay);
    let t = step - carry;
    while (t <= len) {
      out.push([ax + ((bx - ax) * t) / len, ay + ((by - ay) * t) / len]);
      t += step;
    }
    carry = len - (t - step);
  }
  if (out.length === 1 || Math.hypot(...out.at(-1).map((v, k) => v - points.at(-1)[k])) > step / 2) out.push(points.at(-1));
  return out;
}

/**
 * Make a clean line look drawn by mouse, but confidently: one continuous
 * stroke, a little off target, with a gentle drift and ends that overshoot.
 */
function mouseStroke(line, shift) {
  let pts = smoothPath(resample(line, 4), 3);
  if (pts.length < 2) {
    const [x, y] = pts[0];
    return [[x - 3, y - 2], [x + 4, y + 3]]; // a dab
  }
  // Overshoot both ends along the line.
  const extend = (a, b, by) => {
    const len = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    return [a[0] + ((a[0] - b[0]) / len) * by, a[1] + ((a[1] - b[1]) / len) * by];
  };
  pts = [extend(pts[0], pts[1], 4 + rand() * 10), ...pts, extend(pts.at(-1), pts.at(-2), 8 + rand() * 16)];

  const own = [shift[0] + (rand() - 0.5) * 10, shift[1] + (rand() - 0.5) * 8];
  const drift = { amp: 0.6 + rand() * 1.4, freq: 0.01 + rand() * 0.02, phase: rand() * 6.3 };
  let travelled = 0;
  pts = pts.map((pt, i) => {
    if (i) travelled += Math.hypot(pt[0] - pts[i - 1][0], pt[1] - pts[i - 1][1]);
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / len;
    const ny = (b[0] - a[0]) / len;
    const wobble = drift.amp * Math.sin(travelled * drift.freq + drift.phase);
    return [pt[0] + own[0] + nx * wobble, pt[1] + own[1] + ny * wobble];
  });

  return pts;
}

/**
 * Blackletter's "v" reads like a "b", so it's painted as a plain V instead:
 * centre lines for a left arm (thick, the way a flat brush meets it) and a
 * thinner right arm meeting at a point on the baseline, with a small entry
 * hook and a curl at the top right. Returns the lines and the x range the
 * font's own "v" covers.
 */
function plainV(c, layout) {
  c.font = layout.font;
  const before = c.measureText(NAME_TEXT.slice(0, NAME_TEXT.indexOf("v"))).width;
  const through = c.measureText(NAME_TEXT.slice(0, NAME_TEXT.indexOf("v") + 1)).width;
  const x0 = layout.x + before;
  const x1 = layout.x + through;
  const w = x1 - x0;
  const top = layout.baseline - c.measureText("x").actualBoundingBoxAscent;
  const h = layout.baseline - top;
  const point = [x0 + w * 0.5, layout.baseline - h * 0.04];
  const lines = [
    // Left arm, from a little hook at the top down to the point.
    [[x0 + w * 0.08, top + h * 0.12], [x0 + w * 0.2, top], [x0 + w * 0.3, top + h * 0.3], point],
    // Right arm, from a curl at the top right down to the point.
    [[x1 - w * 0.22, top + h * 0.06], [x1 - w * 0.08, top - h * 0.02], [x1 - w * 0.06, top + h * 0.14], [x0 + w * 0.68, top + h * 0.55], point],
  ];
  return { lines, x0, x1 };
}

/**
 * The name, as colour and relief images the size of the ink canvas (`ink`,
 * { w, h } in px), painted with a flat brush `brush` px wide.
 */
export function paintedName(fontFamily, ink, brush) {
  rand = seeded(2701);
  const color = makeCanvas(ink.w, ink.h);
  const relief = makeCanvas(ink.w, ink.h);
  const cc = color.getContext("2d");
  const rc = relief.getContext("2d");
  for (const c of [cc, rc]) {
    c.lineCap = "round";
    c.lineJoin = "round";
  }
  // The letters' centre lines, gone over by mouse. A tiny one on its own is
  // the i's dot, which gets a daub instead of a stroke.
  const layout = nameLayout(cc, fontFamily, ink);
  const shift = [(rand() - 0.5) * 16, (rand() - 0.5) * 10];
  const v = plainV(cc, layout);
  const inV = (line) => line.filter(([px]) => px > v.x0 && px < v.x1).length > line.length * 0.6;
  const lines = [...letterLines(layout, ink).filter((line) => !inV(line)), ...v.lines];
  for (const line of lines) {
    const xs = line.map(([px]) => px);
    const ys = line.map(([, py]) => py);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (line.alone && span < brush * 0.5) {
      const cx = xs.reduce((a, b) => a + b, 0) / xs.length + shift[0];
      const cy = ys.reduce((a, b) => a + b, 0) / ys.length + shift[1];
      daub(cc, rc, cx, cy, brush * 0.4, NAME_INK, NAME_PAINT);
    } else {
      flatStroke(cc, rc, mouseStroke(line, shift), brush, NAME_INK, NAME_PAINT);
    }
  }
  return { color, relief };
}
