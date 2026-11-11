import * as THREE from "three";
import { gsap } from "gsap";
import { canvasTexture } from "./textures.js";
import { onResize } from "../scene/stage.js";
import { reduceMotion } from "../settings.js";
import { popIn } from "../ui/popover.js";
import { asciiFrame, asciiRange } from "../ui/ascii.js";
import { fonts } from "../lib/fonts.js";

// A wooden swivel easel: a board on side pins with a chalkboard on one face and
// a painting canvas on the other. Switching modes spins the board over. Draw by
// dragging on it; the toolbar along the top picks colours, sizes and tools, and
// the chalk, eraser and paint pots on the tray can be clicked too.

// ---------- Sizes (world units, before the easel is scaled to fit) ----------

const SURF_W = 6;
const SURF_H = 3.75; // 16:10, same as the ink canvas
const FRAME = 0.18;
const BOARD_T = 0.12;
const BOARD_W = SURF_W + FRAME * 2;
const BOARD_H = SURF_H + FRAME * 2;
const TRAY_Y = 0.22;
const TRAY_Z = 0.62; // in front of the board, so nothing on it is hidden
// High enough that the board clears the tray (and a lifted pot) as it spins.
const PIVOT_Y = TRAY_Y + 0.34 + BOARD_H / 2;
const POST = 0.16;
const POST_X = BOARD_W / 2 + 0.1 + POST / 2;
const POST_H = PIVOT_Y + 0.22;
const TILT = 0.12; // radians the board leans back, to face the camera
const EASEL_W = POST_X * 2 + POST;
const EASEL_H = PIVOT_Y + BOARD_H / 2;
const EASEL_Z = 2.2; // stands forward, nearer the camera, so the board looks bigger
const FEET_FRONT = 1; // how far the feet reach toward the viewer

// Ink canvas resolution (16:10).
const INK_W = 1440;
const INK_H = 900;
const MAX_UNDO = 8;

// ---------- Tools ----------

const CHALK = [
  ["White", "#f3f0e8"],
  ["Yellow", "#f6d96b"],
  ["Pink", "#f4a6bd"],
  ["Blue", "#8ecdf2"],
  ["Green", "#a9dd9c"],
];
const PAINT = [
  ["Red", "#c0392b"],
  ["Orange", "#e07b24"],
  ["Yellow", "#f1c40f"],
  ["Green", "#3f7d4e"],
  ["Blue", "#2c6e9b"],
  ["Purple", "#7a4b8c"],
  ["Black", "#1d1b18"],
  ["White", "#fbf9f5"],
];
const PALETTES = { chalk: CHALK, paint: PAINT };
const SIZE_NAMES = ["Small", "Medium", "Large"];
// Stroke widths in ink pixels.
const WIDTHS = { chalk: [9, 18, 34], paint: [18, 38, 72] };
const ERASER_SCALE = { chalk: 3.5, paint: 1.6 };
// Paint settings (sliders in the toolbar), each 0–1. Remembered per visitor.
const PAINT_SETTINGS = [
  ["thickness", "Thickness", 0.5], // how raised the paint stands
  ["chunk", "Chunkiness", 0.5], // smooth and even → streaky, ragged bristle marks
  ["mix", "Mixing", 0.2], // how much a stroke blends with the wet paint under it
];
const SETTINGS_KEY = "portfolio-paint-settings";

// Brush shapes. A flat brush is held at a fixed angle, so its stroke is broad
// in one direction and thin moving along its edge.
const BRUSHES = [
  ["round", "Round brush"],
  ["flat", "Flat brush"],
];
const FLAT_ANGLE = (-40 * Math.PI) / 180; // the flat brush's edge, from horizontal

function loadPaintSettings() {
  const settings = Object.fromEntries(PAINT_SETTINGS.map(([key, , value]) => [key, value]));
  settings.brush = "round";
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    for (const key in settings) if (typeof saved[key] === typeof settings[key]) settings[key] = saved[key];
    if (!BRUSHES.some(([id]) => id === settings.brush)) settings.brush = "round";
  } catch {}
  return settings;
}

const hexToRGB = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgbCss = ([r, g, b]) => `rgb(${r | 0},${g | 0},${b | 0})`;

/** Mix colour `a` toward `b` by `t` the way pigments mix (a weighted geometric mean), in place. */
function pigment(a, b, t) {
  if (t <= 0) return a;
  for (let i = 0; i < 3; i++) a[i] = Math.exp((1 - t) * Math.log(Math.max(a[i], 3)) + t * Math.log(Math.max(b[i], 3)));
  return a;
}

/** Colour lightened (tone > 0) or darkened (tone < 0) by up to 100%. */
const toned = (rgb, tone) => rgbCss(rgb.map((v) => (tone > 0 ? v + (255 - v) * tone : v * (1 + tone))));

const grey = (v) => {
  const g = Math.round(THREE.MathUtils.clamp(v, 0, 255));
  return `rgb(${g},${g},${g})`;
};
// Natural logs of 0–255, for mixing colours like pigment (a weighted geometric
// mean): blue over yellow gives green, red over yellow orange, white over red pink.
const LN = Float32Array.from({ length: 256 }, (_, v) => Math.log(Math.max(v, 3)));

const rand = Math.random;

// ---------- Textures ----------

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function woodTexture() {
  return canvasTexture(512, (c, s) => {
    const grad = c.createLinearGradient(0, 0, s, s);
    grad.addColorStop(0, "hsl(33, 50%, 66%)");
    grad.addColorStop(1, "hsl(29, 46%, 56%)");
    c.fillStyle = grad;
    c.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) {
      const y0 = rand() * s;
      const amp = 2 + rand() * 6;
      const phase = rand() * Math.PI * 2;
      c.beginPath();
      for (let x = 0; x <= s; x += 8) {
        const y = y0 + Math.sin((x / s) * 3 * Math.PI + phase) * amp;
        x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
      }
      c.strokeStyle = `rgba(110, 62, 24, ${0.05 + rand() * 0.12})`;
      c.lineWidth = 1 + rand() * 3;
      c.stroke();
    }
  });
}

/** Fill with `color` plus a little per-pixel noise. */
function noisyFill(c, w, h, color, amount) {
  c.fillStyle = color;
  c.fillRect(0, 0, w, h);
  const img = c.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  c.putImageData(img, 0, 0);
}

// Slate: dark green with the ghosts of old lessons wiped across it.
function slateCanvas() {
  const cv = document.createElement("canvas");
  cv.width = INK_W / 2;
  cv.height = INK_H / 2;
  const c = cv.getContext("2d");
  noisyFill(c, cv.width, cv.height, "#27352f", 10);
  for (let i = 0; i < 18; i++) {
    const x = rand() * cv.width;
    const y = rand() * cv.height;
    const r = 40 + rand() * 140;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(235, 240, 230, 0.05)");
    g.addColorStop(1, "rgba(235, 240, 230, 0)");
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Long sideways wipe marks.
  for (let i = 0; i < 6; i++) {
    c.fillStyle = `rgba(235, 240, 230, ${0.012 + rand() * 0.02})`;
    c.fillRect(0, rand() * cv.height, cv.width, 20 + rand() * 50);
  }
  return cv;
}

// Primed canvas: warm off-white with a linen weave.
function linenCanvas() {
  const cv = document.createElement("canvas");
  cv.width = INK_W / 2;
  cv.height = INK_H / 2;
  const c = cv.getContext("2d");
  noisyFill(c, cv.width, cv.height, "#f4efe3", 8);
  for (let x = 0; x < cv.width; x += 3) {
    c.fillStyle = `rgba(120, 100, 70, ${0.02 + rand() * 0.04})`;
    c.fillRect(x, 0, 1, cv.height);
  }
  for (let y = 0; y < cv.height; y += 3) {
    c.fillStyle = `rgba(120, 100, 70, ${0.02 + rand() * 0.04})`;
    c.fillRect(0, y, cv.width, 1);
  }
  return cv;
}

// Chalk grain: a colour with holes in it. It's a pattern fixed to the board,
// so like real chalk the gaps come from the surface, and strokes laid over each
// other don't build up into blotches.
const grainCache = new Map(); // colour → grain image
const patternCache = new WeakMap(); // 2D context → (colour → pattern)
function chalkGrain(ctx, color) {
  if (!patternCache.has(ctx)) patternCache.set(ctx, new Map());
  const patterns = patternCache.get(ctx);
  if (!patterns.has(color)) patterns.set(color, ctx.createPattern(grainImage(color), "repeat"));
  return patterns.get(color);
}

function grainImage(color) {
  if (!grainCache.has(color)) {
    const small = document.createElement("canvas");
    small.width = small.height = 96;
    const sc = small.getContext("2d");
    const img = sc.createImageData(96, 96);
    const [r, g, b] = hexToRGB(color);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = rand() < 0.3 ? 0 : 200 + rand() * 55;
    }
    sc.putImageData(img, 0, 0);
    // Scale up so each grain is a few ink pixels: still visible once the board
    // is shrunk to fit the screen.
    const big = document.createElement("canvas");
    big.width = big.height = 288;
    big.getContext("2d").drawImage(small, 0, 0, 288, 288);
    grainCache.set(color, big);
  }
  return grainCache.get(color);
}

// ---------- The name, painted on the canvas to start ----------
// "Calvin" in blackletter, painted in red with the thickest flat brush as if by
// mouse: confident strokes along the letters, a little off, overshooting the ends.

const NAME_TEXT = "Calvin";
const NAME_FONT = '"UnifrakturMaguntia"'; // blackletter, loaded with the site's Google Fonts
const NAME_INK = "#c0392b";
const NAME_BRUSH = WIDTHS.paint.at(-1); // the thickest brush
const NAME_PAINT = { thickness: 1, chunk: 0.35 }; // raised, a little streaky
const SKELETON_SCALE = 3; // letters are thinned to centre lines at 1/3 ink resolution

/** Path through `points`, shifted by (dx, dy). */
function tracePath(c, points, dx = 0, dy = 0) {
  c.beginPath();
  points.forEach(([x, y], i) => (i ? c.lineTo(x + dx, y + dy) : c.moveTo(x + dx, y + dy)));
}

/** Font, position and size of the name on the ink canvas. */
function nameLayout(c, fontFamily) {
  let size = INK_H * 0.46;
  c.font = `${size}px ${fontFamily}`;
  size *= Math.min(1, (INK_W * 0.7) / c.measureText(NAME_TEXT).width);
  const font = `${size}px ${fontFamily}`;
  c.font = font;
  const m = c.measureText(NAME_TEXT);
  return {
    font,
    x: (INK_W - m.width) / 2,
    baseline: INK_H / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2,
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
  const count = Math.round(THREE.MathUtils.clamp(width / 1.8, 8, 26));
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
function letterLines(layout) {
  const w = Math.ceil(INK_W / SKELETON_SCALE);
  const h = Math.ceil(INK_H / SKELETON_SCALE);
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

/** The name, as colour and relief images the size of the ink canvas. */
function paintedName(fontFamily) {
  const color = makeCanvas(INK_W, INK_H);
  const relief = makeCanvas(INK_W, INK_H);
  const cc = color.getContext("2d");
  const rc = relief.getContext("2d");
  for (const c of [cc, rc]) {
    c.lineCap = "round";
    c.lineJoin = "round";
  }
  // The letters' centre lines, gone over by mouse. A tiny one on its own is
  // the i's dot, which gets a daub instead of a stroke.
  const layout = nameLayout(cc, fontFamily);
  const shift = [(rand() - 0.5) * 16, (rand() - 0.5) * 10];
  const v = plainV(cc, layout);
  const inV = (line) => line.filter(([px]) => px > v.x0 && px < v.x1).length > line.length * 0.6;
  const lines = [...letterLines(layout).filter((line) => !inV(line)), ...v.lines];
  for (const line of lines) {
    const xs = line.map(([px]) => px);
    const ys = line.map(([, py]) => py);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (line.alone && span < NAME_BRUSH * 0.5) {
      const cx = xs.reduce((a, b) => a + b, 0) / xs.length + shift[0];
      const cy = ys.reduce((a, b) => a + b, 0) / ys.length + shift[1];
      daub(cc, rc, cx, cy, NAME_BRUSH * 0.4, NAME_INK, NAME_PAINT);
    } else {
      flatStroke(cc, rc, mouseStroke(line, shift), NAME_BRUSH, NAME_INK, NAME_PAINT);
    }
  }
  return { color, relief };
}

// ---------- Toolbar ----------

// Toolbar, drawn in text (styles in drawing.css and ascii.css):
//   ( ) Chalkboard (*) Canvas   [#] # # #   [round] flat   . [o] O
//   [erase] [undo] [save] [clear all] [opts]
function toolbarHTML() {
  const pick = (name, value, label, text) =>
    `<label class="draw-pick" title="${label}"><input type="radio" name="${name}" value="${value}" aria-label="${label}"><span>${text}</span></label>`;
  return `
    <div class="segmented draw-mode">
      <label><input type="radio" name="draw-mode" value="chalk"><span>Chalkboard</span></label>
      <label><input type="radio" name="draw-mode" value="paint"><span>Canvas</span></label>
    </div>
    <div class="draw-group draw-swatches" role="radiogroup" aria-label="Colour"></div>
    <div class="draw-group draw-brushes" role="radiogroup" aria-label="Brush">
      ${BRUSHES.map(([id, label]) => pick("draw-brush", id, label, id)).join("")}
    </div>
    <div class="draw-group" role="radiogroup" aria-label="Size">
      ${SIZE_NAMES.map((label, i) => pick("draw-size", i, label, ".oO"[i])).join("")}
    </div>
    <div class="draw-group draw-actions">
      <button class="draw-btn ascii-btn" type="button" data-action="erase" aria-pressed="false" title="Eraser">erase</button>
      <button class="draw-btn ascii-btn" type="button" data-action="undo" title="Undo (Ctrl/⌘ Z)">undo</button>
      <button class="draw-btn ascii-btn" type="button" data-action="save" aria-label="Download as an image" title="Download">save</button>
      <button class="draw-btn ascii-btn" type="button" data-action="clear" title="Wipe the chalkboard and the canvas">clear all</button>
      <button class="draw-btn ascii-btn" type="button" data-action="settings" aria-expanded="false" aria-controls="draw-settings" aria-label="Paint settings" title="Paint settings">opts</button>
    </div>
    <div class="draw-settings card" id="draw-settings" role="group" aria-label="Paint settings" data-ascii-title="paint" hidden>
      ${PAINT_SETTINGS.map(
        ([key, label]) => `<label class="draw-slider">
          <span>${label}<output data-for="${key}"></output></span>
          <input type="range" name="paint-${key}" data-setting="${key}" min="0" max="100" step="1">
        </label>`
      ).join("")}
    </div>`;
}

// ---------- Toy ----------

export function createDrawingBoard({ scene, camera, renderer, bounds }) {
  const disposables = [];
  const track = (thing) => (disposables.push(thing), thing);

  const state = {
    mode: "paint", // the canvas faces the viewer at the start
    erasing: false,
    size: 1,
    color: { chalk: CHALK[0][1], paint: PAINT[0][1] },
    paint: loadPaintSettings(),
  };

  const root = new THREE.Group();
  root.position.z = EASEL_Z;
  scene.add(root);

  // ----- Easel -----
  const woodMat = track(new THREE.MeshStandardMaterial({ map: track(woodTexture()), roughness: 0.75 }));
  const box = (w, h, d, mat = woodMat) => {
    const mesh = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, d)), mat);
    mesh.castShadow = true;
    return mesh;
  };

  for (const side of [-1, 1]) {
    const post = box(POST, POST_H, POST);
    post.position.set(side * POST_X, POST_H / 2, 0);
    root.add(post);
    const foot = box(POST + 0.04, 0.1, 0.75 + FEET_FRONT);
    foot.position.set(side * POST_X, 0.05, (FEET_FRONT - 0.75) / 2);
    root.add(foot);
    // Bracket from the post out to the tray.
    const bracket = box(POST * 0.8, 0.06, TRAY_Z + 0.3);
    bracket.position.set(side * POST_X, TRAY_Y - 0.06, (TRAY_Z + 0.3) / 2);
    root.add(bracket);
    // Pin through the post into the board, with a round knob outside.
    const pin = new THREE.Mesh(track(new THREE.CylinderGeometry(0.05, 0.05, POST_X * 2, 16)), woodMat);
    pin.rotation.z = Math.PI / 2;
    pin.position.y = PIVOT_Y;
    root.add(pin);
    const knob = new THREE.Mesh(track(new THREE.SphereGeometry(0.11, 20, 12)), woodMat);
    knob.position.set(side * (POST_X + POST / 2 + 0.04), PIVOT_Y, 0);
    knob.castShadow = true;
    root.add(knob);
  }
  const tray = box(POST_X * 2, 0.06, 0.6);
  tray.position.set(0, TRAY_Y, TRAY_Z);
  tray.receiveShadow = true;
  root.add(tray);
  for (const z of [-0.3, 0.3]) {
    const lip = box(POST_X * 2, 0.08, 0.03);
    lip.position.set(0, TRAY_Y + 0.05, TRAY_Z + z);
    root.add(lip);
  }

  // ----- Board (spins on the pins) -----
  const board = new THREE.Group();
  board.position.y = PIVOT_Y;
  board.rotation.x = -TILT + Math.PI; // canvas side out (see setMode)
  root.add(board);

  const core = box(SURF_W, SURF_H, BOARD_T, track(new THREE.MeshStandardMaterial({ color: 0x3a2a1c })));
  board.add(core);
  const frameDepth = BOARD_T + 0.06;
  for (const [w, h, x, y] of [
    [BOARD_W, FRAME, 0, (SURF_H + FRAME) / 2],
    [BOARD_W, FRAME, 0, -(SURF_H + FRAME) / 2],
    [FRAME, SURF_H, (SURF_W + FRAME) / 2, 0],
    [FRAME, SURF_H, -(SURF_W + FRAME) / 2, 0],
  ]) {
    const strip = box(w, h, frameDepth);
    strip.position.set(x, y, 0);
    board.add(strip);
  }

  const surfaceGeo = track(new THREE.PlaneGeometry(SURF_W, SURF_H));

  function makeSide(mode, baseCanvas, roughness) {
    const face = new THREE.Group();
    // Chalkboard faces the viewer at the start; the canvas is on the back,
    // upside down, so it's the right way up once the board spins over.
    if (mode === "paint") face.rotation.x = Math.PI;
    face.position.z = mode === "paint" ? -BOARD_T / 2 - 0.002 : BOARD_T / 2 + 0.002;
    board.add(face);

    const baseTex = track(new THREE.CanvasTexture(baseCanvas));
    baseTex.colorSpace = THREE.SRGBColorSpace;
    baseTex.anisotropy = 8;
    const surface = new THREE.Mesh(surfaceGeo, track(new THREE.MeshStandardMaterial({ map: baseTex, roughness })));
    surface.receiveShadow = true;
    surface.userData.side = mode;
    face.add(surface);

    const paint = mode === "paint";
    // Paint is mixed pixel by pixel in script, so keep it in memory where
    // reading it back is quick.
    const ink = makeCanvas(INK_W, INK_H);
    const ctx = ink.getContext("2d", paint ? { willReadFrequently: true } : undefined);
    const inkTex = track(new THREE.CanvasTexture(ink));
    inkTex.colorSpace = THREE.SRGBColorSpace;
    inkTex.anisotropy = 8;

    // Paint is thick: a height map (at half resolution) lit as bumps, so the
    // ridges left by the bristles catch the light.
    let height = null;
    let heightCtx = null;
    let heightTex = null;
    if (paint) {
      height = makeCanvas(INK_W / 2, INK_H / 2);
      heightCtx = height.getContext("2d");
      heightCtx.scale(0.5, 0.5); // draw in ink coordinates
      heightTex = track(new THREE.CanvasTexture(height));
    }

    const inkMesh = new THREE.Mesh(
      surfaceGeo,
      track(
        new THREE.MeshStandardMaterial({
          map: inkTex,
          transparent: true,
          depthWrite: false,
          roughness: paint ? 0.45 : roughness, // wet paint has a slight sheen
          bumpMap: heightTex,
          bumpScale: 5,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        })
      )
    );
    inkMesh.position.z = 0.001;
    face.add(inkMesh);

    // Each paint stroke is drawn here first, then mixed into the ink.
    const layer = paint ? makeCanvas(INK_W, INK_H) : null;
    const layerCtx = layer?.getContext("2d", { willReadFrequently: true });

    for (const c of [ctx, heightCtx, layerCtx]) {
      if (!c) continue;
      c.lineCap = "round";
      c.lineJoin = "round";
    }
    return { mode, base: baseCanvas, ink, ctx, tex: inkTex, height, heightCtx, heightTex, layerCtx, surface };
  }

  const sides = {
    chalk: makeSide("chalk", slateCanvas(), 0.95),
    paint: makeSide("paint", linenCanvas(), 0.85),
  };

  // ----- Tray items (clickable shortcuts) -----
  const items = [];
  function addItem(mesh, data, x, z = 0, yaw = 0) {
    mesh.position.set(x, TRAY_Y + 0.03 + data.h / 2, TRAY_Z + z);
    mesh.rotation.y = yaw;
    mesh.userData = { ...data, restY: mesh.position.y };
    mesh.castShadow = true;
    root.add(mesh);
    items.push(mesh);
  }

  // Felt eraser: wooden back, grey felt underneath.
  {
    const eraser = new THREE.Group();
    const back = box(0.6, 0.1, 0.24);
    back.position.y = 0.04;
    const felt = box(0.6, 0.07, 0.24, track(new THREE.MeshStandardMaterial({ color: 0x55534f, roughness: 1 })));
    felt.position.y = -0.045;
    eraser.add(back, felt);
    // Groups can't be raycast directly, so the parts carry the data.
    addItem(eraser, { tool: "eraser", mode: "chalk", h: 0.16 }, -POST_X + 0.6, 0.02, 0.08);
    for (const part of [back, felt]) part.userData = eraser.userData;
  }

  const chalkGeo = track(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 12));
  CHALK.forEach(([, color], i) => {
    const stick = new THREE.Mesh(chalkGeo, track(new THREE.MeshStandardMaterial({ color, roughness: 1 })));
    stick.castShadow = true;
    const holder = new THREE.Group();
    stick.rotation.z = Math.PI / 2;
    holder.add(stick);
    addItem(holder, { tool: "color", mode: "chalk", color, h: 0.1 }, -POST_X + 1.3 + i * 0.42, (i % 2 ? -0.08 : 0.08), (rand() - 0.5) * 0.4);
    stick.userData = holder.userData;
  });

  const potGeo = track(new THREE.CylinderGeometry(0.15, 0.13, 0.15, 24));
  const paintGeo = track(new THREE.SphereGeometry(0.13, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2)); // dome
  const glass = track(new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.3 }));
  ["#c0392b", "#f1c40f", "#3f7d4e", "#2c6e9b"].forEach((color, i) => {
    const pot = new THREE.Group();
    const jar = new THREE.Mesh(potGeo, glass);
    jar.castShadow = true;
    const paint = new THREE.Mesh(paintGeo, track(new THREE.MeshStandardMaterial({ color, roughness: 0.25 })));
    paint.scale.y = 0.55;
    paint.position.y = 0.065; // bulges over the rim
    pot.add(jar, paint);
    addItem(pot, { tool: "color", mode: "paint", color, h: 0.15 }, 0.45 + i * 0.45, i % 2 ? 0.05 : -0.05);
    jar.userData = paint.userData = pot.userData;
  });

  // A brush lying beside the pots (just for show).
  {
    const brush = new THREE.Group();
    const handle = new THREE.Mesh(track(new THREE.CylinderGeometry(0.03, 0.035, 0.7, 10)), track(new THREE.MeshStandardMaterial({ color: 0xb03a2e, roughness: 0.4 })));
    const ferrule = new THREE.Mesh(track(new THREE.CylinderGeometry(0.04, 0.035, 0.12, 10)), track(new THREE.MeshStandardMaterial({ color: 0xc9ccd2, metalness: 0.6, roughness: 0.3 })));
    ferrule.position.y = 0.41;
    const tip = new THREE.Mesh(track(new THREE.ConeGeometry(0.045, 0.16, 10)), track(new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 })));
    tip.position.y = 0.55;
    brush.add(handle, ferrule, tip);
    brush.rotation.set(0, 0.3, Math.PI / 2);
    brush.position.set(POST_X - 0.75, TRAY_Y + 0.07, TRAY_Z + 0.12);
    for (const part of [handle, ferrule, tip]) part.castShadow = true;
    root.add(brush);
  }

  const pickables = [sides.chalk.surface, sides.paint.surface];
  for (const item of items) item.traverse((o) => o.isMesh && pickables.push(o));

  // ----- Toolbar -----
  const bar = document.createElement("div");
  bar.className = "draw-bar card";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Drawing tools");
  bar.innerHTML = toolbarHTML();
  document.body.append(bar);
  gsap.set(bar, { xPercent: -50, autoAlpha: 0 });
  popIn(bar, { y: -10 });

  const swatchesEl = bar.querySelector(".draw-swatches");
  const eraseBtn = bar.querySelector('[data-action="erase"]');
  const settingsBtn = bar.querySelector('[data-action="settings"]');
  const brushesEl = bar.querySelector(".draw-brushes");
  const settingsPanel = bar.querySelector(".draw-settings");
  const sliders = settingsPanel.querySelectorAll("input");
  const unframe = [asciiFrame(bar), asciiFrame(settingsPanel)];
  const sliderBars = [...sliders].map((input) => asciiRange(input));

  function syncSliders() {
    for (const input of sliders) {
      const value = state.paint[input.dataset.setting];
      input.value = Math.round(value * 100);
      settingsPanel.querySelector(`output[data-for="${input.dataset.setting}"]`).textContent = `${Math.round(value * 100)}%`;
    }
    for (const bar of sliderBars) bar.update();
  }

  function showSettings(show) {
    settingsPanel.hidden = !show;
    settingsBtn.setAttribute("aria-expanded", String(show));
    if (show) popIn(settingsPanel, { y: -6, scale: 0.96, transformOrigin: "100% 0%" });
  }

  settingsPanel.addEventListener("input", (e) => {
    const key = e.target.dataset.setting;
    if (!key) return;
    state.paint[key] = Number(e.target.value) / 100;
    syncSliders();
    savePaintSettings();
  });

  function savePaintSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.paint));
    } catch {}
  }

  // Each colour is a cell of that colour, bracketed when picked: [#]
  function renderSwatches() {
    swatchesEl.innerHTML = PALETTES[state.mode]
      .map(
        ([name, color]) => `<label class="draw-pick draw-swatch" title="${name}">
          <input type="radio" name="draw-color" value="${color}" aria-label="${name}"><span><i style="--c:${color}"></i></span>
        </label>`
      )
      .join("");
  }

  function syncUI() {
    for (const input of bar.querySelectorAll("input")) {
      if (input.name === "draw-mode") input.checked = input.value === state.mode;
      if (input.name === "draw-size") input.checked = Number(input.value) === state.size;
      if (input.name === "draw-brush") input.checked = input.value === state.paint.brush;
      if (input.name === "draw-color") input.checked = !state.erasing && input.value === state.color[state.mode];
    }
    eraseBtn.setAttribute("aria-pressed", String(state.erasing));
    // Brush shapes and paint settings only apply to the canvas.
    settingsBtn.hidden = state.mode !== "paint";
    brushesEl.hidden = state.mode !== "paint";
    if (state.mode !== "paint") showSettings(false);
    // Lift the matching item on the tray.
    for (const item of items) {
      const { tool, mode, color, restY } = item.userData;
      const selected =
        mode === state.mode && (tool === "eraser" ? state.erasing : !state.erasing && color === state.color[state.mode]);
      const y = restY + (selected ? 0.1 : 0);
      if (reduceMotion()) item.position.y = y;
      else gsap.to(item.position, { y, duration: 0.35, ease: "back.out(2)", overwrite: true });
    }
    dirty = true;
  }

  bar.addEventListener("change", (e) => {
    const { name, value } = e.target;
    if (e.target.dataset.setting) return; // paint sliders are handled above
    if (name === "draw-mode") setMode(value);
    if (name === "draw-size") state.size = Number(value);
    if (name === "draw-brush") {
      state.paint.brush = value;
      state.erasing = false;
      savePaintSettings();
    }
    if (name === "draw-color") {
      state.color[state.mode] = value;
      state.erasing = false;
    }
    syncUI();
  });

  bar.addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "erase") {
      state.erasing = !state.erasing;
      syncUI();
    }
    if (action === "settings") showSettings(settingsPanel.hidden);
    if (action === "undo") undo();
    if (action === "clear") clear();
    if (action === "save") save();
  });

  function onKey(e) {
    if (e.key === "Escape" && !settingsPanel.hidden) {
      showSettings(false);
      settingsBtn.focus();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
    }
  }
  document.addEventListener("keydown", onKey);

  // ----- Flipping between chalkboard and canvas -----
  let flipping = false;
  let spin = -TILT + Math.PI;

  function setMode(mode) {
    if (mode === state.mode) return;
    state.mode = mode;
    state.erasing = false;
    endStroke();
    renderSwatches();
    spin += Math.PI; // always over the top in the same direction
    gsap.killTweensOf(board.rotation);
    if (reduceMotion()) {
      board.rotation.x = spin;
    } else {
      flipping = true;
      gsap.to(board.rotation, {
        x: spin,
        duration: 1.1,
        ease: "back.out(1.3)",
        onComplete: () => (flipping = false),
      });
    }
  }

  // ----- Drawing -----
  let dirty = true;
  let stroke = null; // the stroke being drawn (see startStroke)
  const undoStack = []; // { side, snapshot }

  function markInk(side) {
    side.tex.needsUpdate = true;
    if (side.heightTex) side.heightTex.needsUpdate = true;
    dirty = true;
  }

  function copyOf(source) {
    const copy = makeCanvas(source.width, source.height);
    copy.getContext("2d", { willReadFrequently: true }).drawImage(source, 0, 0);
    return copy;
  }

  /** Save the side as it is now; the stroke about to be drawn mixes with this. */
  function pushUndo(side) {
    const entry = { side, ink: copyOf(side.ink), height: side.height && copyOf(side.height) };
    undoStack.push(entry);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    return entry;
  }

  function restore(ctx, source) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "copy";
    ctx.drawImage(source, 0, 0);
    ctx.restore();
  }

  function undo() {
    endStroke();
    // Undo the most recent change on the side that's showing.
    for (let i = undoStack.length - 1; i >= 0; i--) {
      const { side, ink, height } = undoStack[i];
      if (side.mode !== state.mode) continue;
      undoStack.splice(i, 1);
      restore(side.ctx, ink);
      if (height) restore(side.heightCtx, height);
      markInk(side);
      return;
    }
  }

  /** Wipe both sides (each can still be brought back with Undo). */
  function clear() {
    endStroke();
    nameCleared = true;
    const all = Object.values(sides);
    for (const side of all) pushUndo(side);
    // Wiped off left to right.
    const wipe = { x: 0 };
    const step = () => {
      for (const side of all) {
        side.ctx.clearRect(0, 0, wipe.x, INK_H);
        side.heightCtx?.clearRect(0, 0, wipe.x, INK_H);
        markInk(side);
      }
    };
    if (reduceMotion()) {
      wipe.x = INK_W;
      step();
    } else {
      gsap.to(wipe, { x: INK_W, duration: 0.5, ease: "power2.inOut", onUpdate: step });
    }
  }

  function save() {
    const side = sides[state.mode];
    const out = document.createElement("canvas");
    out.width = INK_W;
    out.height = INK_H;
    const c = out.getContext("2d");
    c.drawImage(side.base, 0, 0, INK_W, INK_H);
    c.drawImage(side.ink, 0, 0);
    out.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = state.mode === "chalk" ? "chalkboard.png" : "painting.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, "image/png");
  }

  const width = () => WIDTHS[state.mode][state.size] * (state.erasing ? ERASER_SCALE[state.mode] : 1);

  // A paint brush is a bundle of bristles that keep their places through the
  // stroke and leave streaks. Each carries its own paint: wet paint it passes
  // over is picked up and smeared along (see soak), so colours swirl together
  // along the stroke. Chunkier paint means more varied shades, higher ridges
  // and more ragged edges; thicker paint stands higher overall.
  function makeBristles(w, loaded, { thickness, chunk, brush }) {
    const flat = brush === "flat";
    const count = Math.round(THREE.MathUtils.clamp(w / (flat ? 1.8 : 2.4), 8, flat ? 36 : 28));
    const ex = Math.cos(FLAT_ANGLE);
    const ey = Math.sin(FLAT_ANGLE);
    return Array.from({ length: count }, () => {
      let dx, dy;
      if (flat) {
        // Along the edge, with a little scatter either side of it.
        const along = (rand() - 0.5) * w * (1 + 0.1 * chunk);
        const across = (rand() - 0.5) * w * (0.06 + 0.1 * chunk);
        dx = ex * along - ey * across;
        dy = ey * along + ex * across;
      } else {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * w * (0.42 + 0.16 * chunk);
        dx = Math.cos(a) * r;
        dy = Math.sin(a) * r;
      }
      return {
        dx,
        dy,
        width: w * (flat ? 0.05 + rand() * 0.06 : 0.07 + rand() * 0.09),
        paint: [...loaded],
        tone: (rand() - 0.5) * (0.03 + 0.22 * chunk),
        ridge: grey((150 + (rand() - 0.5) * 210 * chunk) * thickness), // how high it piles the paint
      };
    });
  }

  /**
   * Wet-on-wet: a bristle at (x, y) picks up some of the paint that was there
   * before the stroke, and carries it on, drifting back to the colour it was
   * loaded with. `under` is the canvas before the stroke, for `box`.
   */
  function soak(paint, under, box, x, y, pick, recover) {
    const ix = THREE.MathUtils.clamp(Math.round(x) - box.x, 0, box.w - 1);
    const iy = THREE.MathUtils.clamp(Math.round(y) - box.y, 0, box.h - 1);
    const i = (iy * box.w + ix) * 4;
    const d = under.data;
    const a = d[i + 3] / 255;
    if (a) pigment(paint, [d[i], d[i + 1], d[i + 2]], pick * a);
    pigment(paint, stroke.loaded, recover);
  }

  /**
   * The solid middle of a paint stroke: a round line, or for a flat brush the
   * ribbon its edge sweeps out (stroked thinly too, so a tap leaves a dab).
   */
  function drawBody(c, color, from, ctrl, to, w) {
    const scale = 0.95 - (stroke.shape === "flat" ? 0.25 : 0.35) * stroke.chunk;
    c.strokeStyle = c.fillStyle = color;
    if (stroke.shape !== "flat") {
      c.lineWidth = w * scale;
      curve(c, from, ctrl, to);
      return;
    }
    const hx = (Math.cos(FLAT_ANGLE) * w * scale) / 2;
    const hy = (Math.sin(FLAT_ANGLE) * w * scale) / 2;
    const points = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const d = t * t;
      points.push([a * from.x + b * ctrl.x + d * to.x, a * from.y + b * ctrl.y + d * to.y]);
    }
    c.beginPath();
    for (const [x, y] of points) c.lineTo(x + hx, y + hy);
    for (const [x, y] of points.reverse()) c.lineTo(x - hx, y - hy);
    c.closePath();
    c.fill();
    c.lineWidth = w * 0.1;
    c.stroke();
  }

  /** Ink pixels a segment of width `w` can touch, or null if none. */
  function segmentBox(from, ctrl, to, w) {
    const pad = w * 0.75 + 3;
    const x0 = Math.max(0, Math.floor(Math.min(from.x, ctrl.x, to.x) - pad));
    const y0 = Math.max(0, Math.floor(Math.min(from.y, ctrl.y, to.y) - pad));
    const x1 = Math.min(INK_W, Math.ceil(Math.max(from.x, ctrl.x, to.x) + pad));
    const y1 = Math.min(INK_H, Math.ceil(Math.max(from.y, ctrl.y, to.y) + pad));
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  function paintSegment(side, from, ctrl, to) {
    const c = side.ctx;
    const w = width();
    if (state.erasing) {
      for (const e of [c, side.heightCtx]) {
        if (!e) continue;
        e.globalCompositeOperation = "destination-out";
        e.strokeStyle = "#000";
        e.lineWidth = w;
        curve(e, from, ctrl, to);
        e.globalCompositeOperation = "source-over";
      }
      if (state.mode === "chalk") {
        // Felt erasers leave a faint smudge behind.
        c.globalCompositeOperation = "source-over";
        c.strokeStyle = "rgba(235, 240, 230, 0.035)";
        curve(c, from, ctrl, to);
      }
      return;
    }
    c.globalCompositeOperation = "source-over";
    if (state.mode === "chalk") {
      c.strokeStyle = chalkGrain(c, state.color.chalk);
      c.lineWidth = w * (0.9 + rand() * 0.2);
      curve(c, from, ctrl, to);
      // Dust specks scattered past the edges.
      c.fillStyle = c.strokeStyle;
      for (let i = 0; i < 4; i++) {
        const t = rand();
        const x = from.x + (to.x - from.x) * t + (rand() - 0.5) * w * 1.4;
        const y = from.y + (to.y - from.y) * t + (rand() - 0.5) * w * 1.4;
        c.fillRect(x, y, 2 + rand() * 2, 2 + rand() * 2);
      }
      return;
    }
    // Paint: a solid body (narrower when chunky) with bristle streaks over it.
    const box = segmentBox(from, ctrl, to, w);
    if (!box) return;
    const under = stroke.before.getImageData(box.x, box.y, box.w, box.h);

    // Pick up and recover per 8 ink pixels travelled, so speed doesn't matter.
    const steps = Math.max(Math.hypot(to.x - from.x, to.y - from.y) / 8, 0.25);
    const pick = 1 - (1 - stroke.pickup) ** steps;
    const recover = 1 - (1 - stroke.recover) ** steps;
    soak(stroke.body, under, box, to.x, to.y, pick, recover);
    for (const b of stroke.bristles) soak(b.paint, under, box, to.x + b.dx, to.y + b.dy, pick, recover);

    const L = side.layerCtx;
    const H = side.heightCtx;
    // Body colour, then relief: an even layer of paint, with each bristle's
    // ridge on top (below).
    drawBody(L, rgbCss(stroke.body), from, ctrl, to, w);
    drawBody(H, stroke.base, from, ctrl, to, w);
    for (const b of stroke.bristles) {
      const path = [offset(from, b), offset(ctrl, b), offset(to, b)];
      L.strokeStyle = toned(b.paint, b.tone);
      L.lineWidth = b.width;
      curve(L, ...path);
      H.strokeStyle = b.ridge;
      H.lineWidth = b.width;
      curve(H, ...path);
    }
    blend(side, box, under);
  }

  /**
   * Put the stroke so far into the ink over `box`. As well as what the
   * bristles smeared along, each pixel takes a little colour from the paint
   * right under it. Pixels are mixed against the canvas as it was before the
   * stroke (`out`, which is overwritten), so going over the same spot within
   * one stroke doesn't keep pushing the colour further.
   */
  function blend(side, box, out) {
    const src = side.layerCtx.getImageData(box.x, box.y, box.w, box.h).data;
    const d = out.data;
    for (let i = 0; i < src.length; i += 4) {
      const as = src[i + 3];
      if (!as) continue;
      const a1 = as / 255;
      const a0 = d[i + 3] / 255;
      const outA = a1 + a0 * (1 - a1);
      const k = a0 * stroke.inPlace;
      for (let ch = 0; ch < 3; ch++) {
        const mixed = a0 ? Math.exp((1 - k) * LN[src[i + ch]] + k * LN[d[i + ch]]) : src[i + ch];
        d[i + ch] = (mixed * a1 + d[i + ch] * a0 * (1 - a1)) / outA;
      }
      d[i + 3] = outA * 255;
    }
    side.ctx.putImageData(out, box.x, box.y);
  }

  const offset = (p, b) => ({ x: p.x + b.dx, y: p.y + b.dy });

  function curve(c, from, ctrl, to) {
    c.beginPath();
    c.moveTo(from.x, from.y);
    c.quadraticCurveTo(ctrl.x, ctrl.y, to.x, to.y);
    c.stroke();
  }

  function toInk(uv) {
    return { x: uv.x * INK_W, y: (1 - uv.y) * INK_H };
  }

  function startStroke(side, p) {
    const saved = pushUndo(side);
    const painting = state.mode === "paint" && !state.erasing;
    if (painting) side.layerCtx.clearRect(0, 0, INK_W, INK_H);
    const { thickness, chunk, mix } = state.paint;
    const loaded = hexToRGB(state.color.paint);
    stroke = {
      side,
      last: p,
      mid: p,
      loaded,
      body: [...loaded], // paint on the middle of the brush
      bristles: painting ? makeBristles(width(), loaded, state.paint) : null,
      before: painting ? saved.ink.getContext("2d", { willReadFrequently: true }) : null,
      // Settings are fixed for the length of a stroke. Mixing sets how much
      // wet paint the brush picks up, how long it carries it, and how much
      // the colour right underneath shows through.
      chunk,
      shape: state.paint.brush,
      pickup: 0.32 * mix,
      recover: 0.05 - 0.035 * mix,
      inPlace: 0.4 * mix,
      base: grey(150 * thickness),
    };
    // A tap leaves a dot.
    paintSegment(side, p, p, { x: p.x + 0.1, y: p.y });
    markInk(side);
  }

  function continueStroke(p) {
    if (!stroke.last) {
      // Back on the board after wandering off it: start a fresh line here.
      stroke.last = stroke.mid = p;
      return;
    }
    const { last, mid, side } = stroke;
    const nextMid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
    paintSegment(side, mid, last, nextMid);
    stroke.last = p;
    stroke.mid = nextMid;
    markInk(side);
  }

  /** Finish the line at its last point; the stroke carries on if the pointer comes back. */
  function liftStroke() {
    if (!stroke?.last) return;
    const { side, mid, last } = stroke;
    paintSegment(side, mid, last, last);
    markInk(side);
    stroke.last = stroke.mid = null;
  }

  function endStroke() {
    liftStroke();
    stroke = null;
  }

  // ----- "Calvin", already painted on the canvas when the board opens -----
  // Waits for the blackletter font, which is usually a moment.
  let disposed = false;
  let nameCleared = false; // Clear all before the font arrived

  document.fonts
    .load(`100px ${NAME_FONT}`)
    .catch(() => [])
    .then(() => {
      if (disposed || nameCleared) return;
      const family = document.fonts.check(`100px ${NAME_FONT}`) ? NAME_FONT : fonts.letter;
      const { color, relief } = paintedName(family);
      // Underneath anything painted while the font was loading.
      const side = sides.paint;
      for (const [c, image] of [[side.ctx, color], [side.heightCtx, relief]]) {
        c.save();
        c.globalCompositeOperation = "destination-over";
        c.drawImage(image, 0, 0, INK_W, INK_H);
        c.restore();
      }
      markInk(side);
    });

  // ----- Picking tools from the tray -----
  function pickItem({ tool, mode, color }) {
    setMode(mode);
    if (tool === "eraser") state.erasing = true;
    else {
      state.erasing = false;
      state.color[mode] = color;
    }
    syncUI();
  }

  // ----- Fit the easel between the toolbar and the floor -----
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const ndc = new THREE.Vector2();
  const point = new THREE.Vector3();

  /** Where the view through screen point `ndc` meets the upright plane at depth `z`. */
  function seen(x, y, z) {
    ndc.set(x, y);
    plane.constant = -z;
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray.intersectPlane(plane, point) ? point : null;
  }

  const header = document.querySelector(".overlay.top");
  const boardTop = new THREE.Vector3();

  // Runs on window resize and whenever the toolbar changes size (it wraps
  // differently with the chalk and paint colours on narrow screens).
  function fit() {
    // The stage may have just moved the camera; its matrices update on the
    // next render, which is too late for measuring with it here.
    camera.updateMatrixWorld();
    // Toolbar just under the header (the tagline can wrap onto two lines).
    const headerBottom = Math.max(...[...header.children].map((el) => el.getBoundingClientRect().bottom));
    const minTop = headerBottom + 10;
    bar.style.top = `${minTop}px`;
    const canvasTop = renderer.domElement.getBoundingClientRect().top;
    const top = bar.getBoundingClientRect().bottom - canvasTop + 16;
    // Tallest it can be with its top under the toolbar, and widest with its
    // front feet (the nearest, so narrowest, part) still on screen.
    const topY = seen(0, 1 - (2 * top) / renderer.domElement.clientHeight, EASEL_Z)?.y ?? Infinity;
    const halfWidth = (seen(1, 0, EASEL_Z + FEET_FRONT)?.x ?? bounds.halfWidth) - 0.3;
    const scale = Math.min(topY / EASEL_H, (halfWidth * 2) / EASEL_W, 1.6);
    root.scale.setScalar(Math.max(scale, 0.3));
    root.updateMatrixWorld();

    // On tall screens the board is limited by width and sits well below the
    // header, so bring the toolbar down to sit just above it.
    boardTop.set(0, PIVOT_Y + BOARD_H / 2, 0).applyMatrix4(root.matrixWorld).project(camera);
    const boardTopPx = ((1 - boardTop.y) / 2) * renderer.domElement.clientHeight + canvasTop;
    const snug = boardTopPx - bar.offsetHeight - 14;
    if (snug > minTop) bar.style.top = `${snug}px`;
    dirty = true;
  }

  renderSwatches();
  syncUI();
  syncSliders();
  const stopResize = onResize(fit);
  const barSize = new ResizeObserver(fit);
  barSize.observe(bar);

  const drawRay = new THREE.Raycaster();

  return {
    cursor: "crosshair",
    pickables,

    grab(hit) {
      const { userData } = hit.object;
      if (userData.tool) {
        pickItem(userData);
        return { move() {}, release() {} };
      }
      const side = sides[userData.side];
      if (flipping || side.mode !== state.mode || !hit.uv) return { move() {}, release() {} };
      startStroke(side, toInk(hit.uv));
      return {
        move(ray) {
          if (!stroke) return;
          drawRay.ray.copy(ray);
          const at = drawRay.intersectObject(side.surface, false)[0];
          if (at?.uv) continueStroke(toInk(at.uv));
          else liftStroke();
        },
        release: endStroke,
      };
    },

    update() {
      const changed = dirty || flipping || items.some((item) => gsap.isTweening(item.position));
      dirty = false;
      return changed;
    },

    dispose() {
      disposed = true;
      document.removeEventListener("keydown", onKey);
      stopResize();
      barSize.disconnect();
      for (const remove of unframe) remove();
      for (const slider of sliderBars) slider.dispose();
      gsap.killTweensOf([bar, board.rotation, ...items.map((item) => item.position)]);
      bar.remove();
      scene.remove(root);
      for (const thing of disposables) thing.dispose();
    },
  };
}
