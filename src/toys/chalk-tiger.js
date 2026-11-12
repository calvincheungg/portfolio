import tigerUrl from "./chalk-tiger.webp";
import { makeCanvas, noise, seeded } from "./textures.js";

// The picture already on the chalkboard when it opens: Calvin's tiger
// painting (chalk-tiger.webp), redrawn in chalk.
//
// Every part keeps its own tone: the paper is white chalk, the ink and wash
// (rocks, mist, branches) chalk in matching greys down to dark grey, the
// leaves red, and the tiger its own colours, stripes and all.
// It's all laid down as short strokes running along the painting's contours,
// broad ones for the wash and fine ones for detail, then given the board's
// chalk grain (`grain(ctx, colour)`), so it erases like anything drawn on it.
// The calligraphy in the top left is left out. The random wobble is seeded,
// so it's the same every visit.

// The part of the painting used (in its own pixels): cropped from the left,
// where the calligraphy is, to the board's shape.
const CROP = { x: 160, y: 0, w: 797, h: 498 };
// Calligraphy that's still inside the crop (in crop pixels): only red leaves
// are kept there.
const TEXT = { w: 58, h: 265 };

// The paper and the deepest ink, as fractions of the way through the
// painting's lightness values: anything as light as the paper is white chalk.
const PAPER_AT = 0.8;
const INK_AT = 0.03;
const GREYS = [34, 244]; // the chalk greys for the darkest ink and for the paper
const SHADOWS = 1.4; // > 1 darkens the rocks' middle tones, deepening their shadows (the paper stays white)

// The tail, ringed grey and white in the painting, which on its own reads too
// faintly against the paper: its centre line (in painting pixels, from the
// rump round to the curl at the tip) and how thick it is there. It's drawn
// in the fur's tan with dark rings instead.
const TAIL = [[447, 43], [410, 50], [370, 70], [333, 83], [310, 80], [293, 63], [290, 43], [300, 27], [317, 20], [323, 30]];
const TAIL_THICK = [6.5, 4.5]; // half-thickness at the rump and at the tip
const TUFT = { x: 316, y: 26, r: 10 }; // the dark tuft at the end
const TAIL_FUR = [242, 190, 120];
const TAIL_RING = [46, 42, 40];
// The open mouth (an ellipse in painting pixels): its red is the tongue, in pink.
const MOUTH = { x: 435, y: 294, rx: 14, ry: 11 };
const TONGUE = [247, 150, 176];

// The stream on the right, cascading down to the left between the rocks: the
// light parts inside this outline (in painting pixels) are water, drawn in
// cool streaky chalk along the current rather than paper white.
const WATER = [[440, 498], [440, 410], [560, 335], [700, 272], [800, 205], [860, 150], [940, 160], [1000, 230], [1000, 498]];
const FLOW = -0.53; // the current's direction (radians): down and to the left
const WATER_LIGHT = [204, 224, 238]; // the light water, a little blue
const WATER_DEEP = [92, 116, 136]; // its darker runs
const FOAM = [244, 248, 250];

const GRAIN_PASSES = 5; // as dense as chalk drawn on the board
// Everything a little muted, like the painting: [saturation kept, brightness kept].
const DULL = [0.82, 0.9];

// How much brighter the tiger and the leaves are than in the painting:
// [more saturated, lifted toward white].
const FUR_COLOUR = [1.8, 0.1];
// The tiger's stripes in dark chalk, its white fur bright white.
const STRIPE = [40, 36, 34];
const STRIPE_BELOW = 0.36; // lightness under which the fur is stripe
const WHITE_FUR = [250, 248, 242];
const LEAVES = [1.75, 0.04];

// What each point of the painting is. (The tiger's outline is worked out
// from its fur: see tigerMask.)
const KIND = { paperInk: 0, leaf: 1, fur: 2, tail: 3, tongue: 4, water: 5 };

// The work is done a slice at a time, handing the page back in between, so
// clicks and keys aren't held up while the picture's drawn.
const SLICE_MS = 12;

/**
 * Load the painting and draw it in chalk on a `width` × `height` canvas.
 * Stops early (returning null) if `cancelled()` turns true.
 */
export async function chalkTiger(width, height, grain, { cancelled = () => false } = {}) {
  let sliceStart = performance.now();
  /** Let the page have a turn if this slice has run long; false if the picture's no longer wanted. */
  async function breathe() {
    if (performance.now() - sliceStart < SLICE_MS) return !cancelled();
    await new Promise((resolve) => setTimeout(resolve));
    sliceStart = performance.now();
    return !cancelled();
  }

  const image = new Image();
  image.src = tigerUrl;
  await image.decode();

  // Read the painting at half the board's resolution.
  const AW = Math.round(width / 2);
  const AH = Math.round(height / 2);
  const scale = width / AW; // board px per analysis px
  const source = makeCanvas(AW, AH).getContext("2d", { willReadFrequently: true });
  source.drawImage(image, CROP.x, CROP.y, CROP.w, CROP.h, 0, 0, AW, AH);
  const px = source.getImageData(0, 0, AW, AH).data;
  const textW = (TEXT.w / CROP.w) * AW;
  const textH = (TEXT.h / CROP.h) * AH;

  // ----- What each point of the painting is -----
  const N = AW * AH;
  const light = new Float32Array(N); // 0–1
  const kind = new Uint8Array(N); // one of KIND
  // Painting pixels → reading pixels.
  const ax = (x) => ((x - CROP.x) / CROP.w) * AW;
  const ay = (y) => ((y - CROP.y) / CROP.h) * AH;
  const k = AW / CROP.w;
  for (let i = 0; i < N; i++) {
    if (i % AW === 0 && !(await breathe())) return null;
    const r = px[i * 4] / 255;
    const g = px[i * 4 + 1] / 255;
    const b = px[i * 4 + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max ? (max - min) / max : 0;
    let hue = 0;
    if (max !== min) {
      hue = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
      hue = (hue * 60 + 360) % 360;
    }
    light[i] = 0.3 * r + 0.59 * g + 0.11 * b;
    if ((hue < 18 || hue > 335) && sat > 0.4 && max > 0.35) kind[i] = KIND.leaf;
    else if (hue >= 18 && hue <= 52 && sat > 0.22 && max > 0.3) kind[i] = KIND.fur;
    const x = i % AW;
    const y = (i / AW) | 0;
    if (x < textW && y < textH && kind[i] !== KIND.leaf) {
      kind[i] = KIND.paperInk;
      light[i] = -1; // no calligraphy (filled with paper below)
    }
    // The tongue: the reds inside the mouth.
    const mx = (x - ax(MOUTH.x)) / (MOUTH.rx * k);
    const my = (y - ay(MOUTH.y)) / (MOUTH.ry * k);
    if (mx * mx + my * my < 1 && (hue < 30 || hue > 320) && sat > 0.15 && max > 0.4) kind[i] = KIND.tongue;
  }
  // The tail: everything within its thickness of the centre line, and the tuft.
  const spine = TAIL.map(([x, y]) => [ax(x), ay(y)]);
  for (let y = 0; y < AH; y++) {
    if (!(await breathe())) return null;
    for (let x = 0; x < AW; x++) {
      let near = Infinity;
      let at = 0;
      for (let s = 0; s < spine.length - 1; s++) {
        const [x0, y0] = spine[s];
        const [x1, y1] = spine[s + 1];
        const len2 = (x1 - x0) ** 2 + (y1 - y0) ** 2;
        const t = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / len2));
        const d = Math.hypot(x - (x0 + (x1 - x0) * t), y - (y0 + (y1 - y0) * t));
        if (d < near) [near, at] = [d, (s + t) / (spine.length - 1)];
      }
      const thick = (TAIL_THICK[0] + (TAIL_THICK[1] - TAIL_THICK[0]) * at) * k;
      const tuft = Math.hypot(x - ax(TUFT.x), y - ay(TUFT.y)) < TUFT.r * k;
      if (near < thick || tuft) kind[y * AW + x] = KIND.tail;
    }
  }
  const levels = Float32Array.from(light.filter((v) => v >= 0)).sort();
  const PAPER = levels[Math.floor(levels.length * PAPER_AT)];
  const DARK = levels[Math.floor(levels.length * INK_AT)];
  for (let i = 0; i < N; i++) if (light[i] < 0) light[i] = PAPER;
  if (!(await breathe())) return null;
  const tiger = tigerMask(kind, AW, AH);
  if (!(await breathe())) return null;
  // The water: the light parts of the stream.
  const stream = WATER.map(([x, y]) => [ax(x), ay(y)]);
  for (let i = 0; i < N; i++) {
    if (kind[i] || tiger[i] || light[i] < DARK + (PAPER - DARK) * 0.55) continue;
    if (inside(i % AW, (i / AW) | 0, stream)) kind[i] = KIND.water;
  }

  // Which way the painting's contours run at each point, from the lightness
  // gradient (smoothed), and how strong the edge is.
  if (!(await breathe())) return null;
  const smooth = blur(blur(light, AW, AH), AW, AH);
  const angle = new Float32Array(N);
  const edge = new Float32Array(N);
  for (let y = 1; y < AH - 1; y++) {
    for (let x = 1; x < AW - 1; x++) {
      const i = y * AW + x;
      const gx = smooth[i + 1] - smooth[i - 1];
      const gy = smooth[i + AW] - smooth[i - AW];
      edge[i] = Math.hypot(gx, gy);
      angle[i] = Math.atan2(gy, gx) + Math.PI / 2; // along the contour, not across it
    }
  }

  // ----- The chalk at a point: colour and how heavy -----
  /** Its colour, muted by DULL. */
  function chalkAt(i) {
    const [rgb, alpha] = brightChalkAt(i);
    const grey = (rgb[0] + rgb[1] + rgb[2]) / 3;
    return [rgb.map((v) => Math.round((grey + (v - grey) * DULL[0]) * DULL[1])), alpha];
  }

  function brightChalkAt(i) {
    // Water: cool chalk, its brightness running in streaks along the current.
    if (kind[i] === KIND.water) {
      const x = i % AW;
      const y = (i / AW) | 0;
      const across = -x * Math.sin(FLOW) + y * Math.cos(FLOW);
      const along = x * Math.cos(FLOW) + y * Math.sin(FLOW);
      const streak = noise(across * 0.45 + noise(along * 0.04) * 3);
      const t = Math.min(1, Math.max(0, (light[i] - DARK) / (PAPER - DARK)));
      const lift = Math.min(1, t * (0.42 + streak * 0.68));
      return [WATER_DEEP.map((v, ch) => Math.round(v + (WATER_LIGHT[ch] - v) * lift)), 0.95];
    }
    // The tail in tan with dark rings, and the tongue pink.
    if (kind[i] === KIND.tail) {
      if (light[i] < 0.5) return [TAIL_RING, 0.95];
      const shade = 0.85 + 0.15 * Math.min(1, (light[i] - 0.5) / 0.35);
      return [TAIL_FUR.map((v) => Math.round(v * shade)), 0.95];
    }
    if (kind[i] === KIND.tongue) return [TONGUE, 1];
    // The tiger: dark stripes, bright white fur, and its orange more vivid
    // (blending between them, so the edges stay soft).
    if (tiger[i]) {
      const L = light[i];
      const r = px[i * 4];
      const g = px[i * 4 + 1];
      const b = px[i * 4 + 2];
      const white = Math.max(r, g, b) - Math.min(r, g, b) < 40 && L > 0.62;
      const fur = white ? WHITE_FUR : chalkColour(px, i, FUR_COLOUR[1], FUR_COLOUR[0]);
      const t = smoothstep(STRIPE_BELOW - 0.06, STRIPE_BELOW + 0.06, L);
      return [STRIPE.map((v, ch) => Math.round(v + (fur[ch] - v) * t)), 0.97];
    }
    // The leaves in their own colours, a little brighter.
    if (kind[i] === KIND.leaf) return [chalkColour(px, i, LEAVES[1], LEAVES[0]), 0.95];
    // Paper and ink as greys: white chalk for the paper, dark grey for the
    // darkest ink, a touch warm like the paper.
    const t = Math.min(1, Math.max(0, (light[i] - DARK) / (PAPER - DARK)));
    const v = GREYS[0] + (GREYS[1] - GREYS[0]) * t ** SHADOWS;
    return [[Math.round(v + 2), Math.round(v), Math.round(v - 5)], 0.9];
  }

  // ----- Strokes -----
  const canvas = makeCanvas(width, height);
  // (Drawn in memory rather than on the graphics card: tens of thousands of
  // small strokes are much quicker that way, and it's copied onto the board,
  // which is kept in memory too.)
  const c = canvas.getContext("2d", { willReadFrequently: true });
  c.lineCap = "round";
  const rnd = seeded(1986);

  // First a solid layer of chalk in the painting's colours, so it's as dense
  // as chalk drawn on the board (only the grain's holes show the slate); the
  // strokes go over it for texture and direction.
  if (!(await breathe())) return null;
  const body = source.createImageData(AW, AH);
  for (let i = 0; i < N; i++) {
    if (i % AW === 0 && !(await breathe())) return null;
    const [[r, g, b]] = chalkAt(i);
    body.data.set([r, g, b, 255], i * 4);
  }
  source.putImageData(body, 0, 0);
  c.drawImage(source.canvas, 0, 0, width, height);

  /**
   * Strokes every `step` board px (with some scatter), `length` long and
   * `lineWidth` wide, where `where(i)` says so.
   */
  async function pass({ step, length, lineWidth, alpha, where, direction, colour }) {
    for (let by = 0; by < height; by += step) {
      if (!(await breathe())) return false;
      for (let bx = 0; bx < width; bx += step) {
        const x = bx + (rnd() - 0.5) * step;
        const y = by + (rnd() - 0.5) * step;
        const ax = Math.min(AW - 1, Math.max(0, Math.round(x / scale)));
        const ay = Math.min(AH - 1, Math.max(0, Math.round(y / scale)));
        const i = ay * AW + ax;
        if (!where(i)) continue;
        const chalk = chalkAt(i);
        if (!chalk) continue;
        const [[r, g, b], a] = colour ? [colour, chalk[1]] : chalk;
        // Along the contour where there is one; a loose diagonal hatch where it's flat.
        const along = direction ?? (edge[i] > 0.004 ? angle[i] : 0.6);
        const turn = along + (rnd() - 0.5) * (direction === undefined ? 0.5 : 0.12);
        const len = length * (0.7 + rnd() * 0.6);
        const dx = (Math.cos(turn) * len) / 2;
        const dy = (Math.sin(turn) * len) / 2;
        c.strokeStyle = `rgba(${r}, ${g}, ${b}, ${a * alpha})`;
        c.lineWidth = lineWidth * (0.8 + rnd() * 0.4);
        c.beginPath();
        c.moveTo(x - dx, y - dy);
        c.lineTo(x + dx, y + dy);
        c.stroke();
      }
    }
    return true;
  }

  const isWash = (i) => !tiger[i] && kind[i] === KIND.paperInk;
  const isWater = (i) => kind[i] === KIND.water;
  const isDetail = (i) => tiger[i] || (kind[i] !== KIND.paperInk && !isWater(i)); // tiger, tail, tongue and leaves
  const passes = [
    // The water first, so the rocks and leaves in it sit on top: long thin
    // strokes with the current, lighter streaks of foam, and spray where it
    // breaks on the rocks.
    { step: 4.5, length: 32, lineWidth: 3.2, alpha: 0.75, where: isWater, direction: FLOW },
    { step: 6, length: 18, lineWidth: 1.8, alpha: 0.6, where: isWater, direction: FLOW, colour: FOAM },
    { step: 3, length: 3, lineWidth: 2.2, alpha: 0.85, where: (i) => isWater(i) && edge[i] > 0.02, colour: FOAM },
    // Broad side-of-the-chalk strokes for the paper, wash and rocks…
    { step: 6, length: 24, lineWidth: 11, alpha: 0.8, where: isWash },
    // …finer ones where the ink has edges (rock outlines, branches)…
    { step: 3.5, length: 10, lineWidth: 3.5, alpha: 0.75, where: (i) => isWash(i) && edge[i] > 0.012 },
    // …then the leaves and the tiger, finest of all.
    { step: 4, length: 12, lineWidth: 5, alpha: 0.8, where: (i) => kind[i] === KIND.leaf },
    { step: 4, length: 11, lineWidth: 5, alpha: 0.85, where: (i) => tiger[i] || kind[i] === KIND.tail },
    { step: 2.2, length: 6, lineWidth: 2.4, alpha: 0.85, where: isDetail },
    { step: 1.6, length: 4, lineWidth: 2, alpha: 0.9, where: isDetail }, // the tiger and leaves, solidly
    // The rocks' shadows, filled in more heavily.
    { step: 3, length: 10, lineWidth: 4.5, alpha: 0.8, where: (i) => isWash(i) && light[i] < DARK + (PAPER - DARK) * 0.45 },
  ];
  for (const options of passes) if (!(await pass(options))) return null;

  // The chalk's grain: holes where the board shows through. Drawn chalk goes
  // over each spot a few times as the stroke moves on, which fills its holes
  // in partly, so the grain is laid down that many times too.
  const mask = makeCanvas(width, height).getContext("2d", { willReadFrequently: true });
  mask.fillStyle = grain(mask, "#ffffff");
  for (let k = 0; k < GRAIN_PASSES; k++) mask.fillRect(0, 0, width, height);
  c.globalCompositeOperation = "destination-in";
  c.drawImage(mask.canvas, 0, 0);
  return canvas;
}

// ---------- Helpers ----------

/** Is (x, y) inside the polygon `points`? */
function inside(x, y, points) {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const smoothstep = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The painting's colour at pixel `i` as chalk: more saturated by `vivid`,
 * lifted toward white by `lift`, and brightened.
 */
function chalkColour(px, i, lift, vivid = 1) {
  const raw = [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]];
  const grey = (raw[0] + raw[1] + raw[2]) / 3;
  const rgb = raw.map((v) => grey + (v - grey) * vivid).map((v) => Math.max(0, v) + (255 - Math.max(0, v)) * lift);
  const boost = Math.min(1.35, 245 / Math.max(...rgb, 1));
  return rgb.map((v) => Math.round(Math.min(255, v * boost)));
}

/** A 3 × 3 box blur. */
function blur(src, w, h) {
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const xx = x + ox;
          const yy = y + oy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          sum += src[yy * w + xx];
          n++;
        }
      }
      out[y * w + x] = sum / n;
    }
  }
  return out;
}

/**
 * Grow (`grow` true) or shrink a 0/1 mask by `r` px: a square neighbourhood
 * (edges repeated), done as a pass along the rows then one down the columns,
 * which gives the same result with far fewer checks.
 */
function morph(mask, w, h, r, grow) {
  const along = (src, out, count, length, at) => {
    for (let line = 0; line < count; line++) {
      for (let p = 0; p < length; p++) {
        let hit = !grow;
        for (let o = -r; o <= r; o++) {
          if (!!src[at(line, Math.min(length - 1, Math.max(0, p + o)))] === grow) {
            hit = grow;
            break;
          }
        }
        out[at(line, p)] = hit ? 1 : 0;
      }
    }
    return out;
  };
  const rows = along(mask, new Uint8Array(mask.length), h, w, (y, x) => y * w + x);
  return along(rows, new Uint8Array(mask.length), w, h, (x, y) => y * w + x);
}

/**
 * Where the tiger is: its fur, closed over the stripes, with anything it
 * encloses (face, chest) filled in, keeping only the big pieces (not stray
 * orange in the rocks).
 */
function tigerMask(kind, w, h) {
  let mask = new Uint8Array(kind.length);
  for (let i = 0; i < kind.length; i++) mask[i] = kind[i] === KIND.fur ? 1 : 0;
  mask = morph(morph(mask, w, h, 4, true), w, h, 4, false);

  // Fill holes: whatever the outside can't reach is inside.
  const outside = new Uint8Array(mask.length);
  const queue = [];
  const push = (i) => {
    if (!mask[i] && !outside[i]) {
      outside[i] = 1;
      queue.push(i);
    }
  };
  for (let x = 0; x < w; x++) push(x), push((h - 1) * w + x);
  for (let y = 0; y < h; y++) push(y * w), push(y * w + w - 1);
  while (queue.length) {
    const i = queue.pop();
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
  for (let i = 0; i < mask.length; i++) mask[i] = outside[i] ? 0 : 1;

  // Keep pieces at least a twentieth the size of the biggest.
  const label = new Int32Array(mask.length).fill(-1);
  const sizes = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [start];
    label[start] = id;
    while (stack.length) {
      const i = stack.pop();
      size++;
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j >= 0 && j < mask.length && mask[j] && label[j] < 0) {
          label[j] = id;
          stack.push(j);
        }
      }
    }
    sizes.push(size);
  }
  const biggest = Math.max(0, ...sizes);
  for (let i = 0; i < mask.length; i++) mask[i] = mask[i] && sizes[label[i]] >= biggest / 20 ? 1 : 0;
  return mask;
}
