import { makeCanvas, roundRect } from "./textures.js";

// The chalkboard's felt eraser. It wipes a rectangle shaped like the one on
// the drawing board's tray (0.6 × 0.24), as long as the eraser is wide. Each
// pass takes off nearly all the chalk under it, picks up its colour as dust,
// and smears a little of what it took off out behind it, soft and slightly
// off line, so there's a smudge rather than an outline; going over a spot
// again takes the rest. Over the board it's the cursor too (drawCursor).
//
// createFeltEraser() → { start(), wipe(ctx, from, ctrl, to, w), drawCursor(ctx, w) }

export const ERASER_ASPECT = 0.4; // its height for its length
const ERASE_LEFT = 0.04; // chalk one pass of the felt leaves
const SMEAR = 0.22; // how much of what it wipes off is smeared out behind it

const rand = Math.random; // (live strokes are naturally random)

/** A point `t` (0–1) along the curve from `from` through `ctrl` to `to`. */
const along = (from, ctrl, to, t) => ({
  x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * ctrl.x + t * t * to.x,
  y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * ctrl.y + t * t * to.y,
});

export function createFeltEraser() {
  // Chalk dust held in the felt: what it's wiped up, mixed, and how much
  // (0–1). It stays in the felt between strokes, like a real eraser's.
  const eraserDust = { rgb: [235, 240, 230], amount: 0 };
  let wiped = 0; // how far it's gone this stroke

  /** Wipe the felt, a `w`-long rectangle, along a segment of a stroke on `c`. */
  function wipe(c, from, ctrl, to, w) {
    const h = w * ERASER_ASPECT;
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    [dx, dy] = dist > 0.5 ? [dx / dist, dy / dist] : [1, 0];
    // How far the felt reaches along the way it's moving: each spot is under
    // it for that long, so each step takes a share that adds up to one pass
    // whichever way it's going.
    const reach = Math.abs(dx) * w + Math.abs(dy) * h;
    const step = Math.max(2, h * 0.3);
    const share = Math.min(step / reach, 1);
    const take = 1 - ERASE_LEFT ** share;
    const length = Math.hypot(ctrl.x - from.x, ctrl.y - from.y) + Math.hypot(to.x - ctrl.x, to.y - ctrl.y);
    const count = Math.max(1, Math.ceil(length / step));
    for (let k = 1; k <= count; k++) {
      const { x, y } = along(from, ctrl, to, k / count);
      wiped += length / count;
      smudge(c, x, y, w, h, dx, dy, Math.min(reach, wiped), take, SMEAR * share);
      dropDust(c, x, y, w, h, dx, dy);
    }
  }

  // What's under the felt at one step, lifted off to be smeared back.
  const lifted = makeCanvas(1, 1).getContext("2d", { willReadFrequently: true });
  // ...and blurred here, on its own small canvas: a blur filter on the board
  // itself would make the browser work over the whole board every step.
  const softened = makeCanvas(1, 1).getContext("2d", { willReadFrequently: true });
  const canBlur = "filter" in softened; // (not in older Safari: overlapping copies instead)

  /**
   * One step of the felt at (x, y): wipe `take` of the chalk off its
   * rectangle (with a slightly ragged edge), and smear `smear` of it back out
   * behind, blurred and a little to one side. `behind` is how far back the
   * smear can go (no further than the felt has been).
   */
  function smudge(c, x, y, w, h, dx, dy, behind, take, smear) {
    const pad = Math.ceil(Math.max(1.5, h * 0.07) * 2) + 2; // room for the blur to spread
    const sx = Math.floor(x - w / 2 - pad);
    const sy = Math.floor(y - h / 2 - pad);
    const sw = Math.ceil(w + pad * 2);
    const sh = Math.ceil(h + pad * 2);
    for (const ctx of [lifted, softened]) {
      if (ctx.canvas.width >= sw && ctx.canvas.height >= sh) continue;
      ctx.canvas.width = Math.max(ctx.canvas.width, sw);
      ctx.canvas.height = Math.max(ctx.canvas.height, sh);
    }
    lifted.clearRect(0, 0, sw, sh);
    lifted.drawImage(c.canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    pickUpChalk(lifted.getImageData(0, 0, sw, sh).data, sw, pad, pad, w, h);

    c.save();
    // Off it comes: the felt, wobbling a pixel or two, and a softer fringe.
    const jx = (rand() - 0.5) * 3;
    const jy = (rand() - 0.5) * 3;
    c.globalCompositeOperation = "destination-out";
    c.fillStyle = `rgba(0, 0, 0, ${take})`;
    c.fillRect(x - w / 2 + jx, y - h / 2 + jy, w, h);
    c.fillStyle = `rgba(0, 0, 0, ${take * 0.35})`;
    c.fillRect(x - w / 2 - 2 + jx, y - h / 2 - 2 + jy, w + 4, h + 4);

    // Smeared back out behind the felt, where it's already been.
    const back = behind * (0.45 + rand() * 0.35);
    const aside = (rand() - 0.5) * h * 0.35;
    const ox = sx - dx * back - dy * aside;
    const oy = sy - dy * back + dx * aside;
    c.globalCompositeOperation = "source-over";
    const blur = Math.max(1.5, h * 0.07);
    if (canBlur) {
      softened.clearRect(0, 0, sw, sh);
      softened.filter = `blur(${blur}px)`;
      softened.drawImage(lifted.canvas, 0, 0, sw, sh, 0, 0, sw, sh);
      softened.filter = "none";
      c.globalAlpha = smear;
      c.drawImage(softened.canvas, 0, 0, sw, sh, ox, oy, sw, sh);
    } else {
      c.globalAlpha = smear / 3;
      for (let i = 0; i < 3; i++) c.drawImage(lifted.canvas, 0, 0, sw, sh, ox + (rand() - 0.5) * blur * 2, oy + (rand() - 0.5) * blur * 2, sw, sh);
    }
    c.restore();
  }

  /**
   * The felt soaks up the colour of the chalk under it: `ink` is a patch
   * `width` px wide with the felt's `w` × `h` rectangle at (x0, y0) in it
   * (sampled every few pixels).
   */
  function pickUpChalk(ink, width, x0, y0, w, h) {
    let weight = 0;
    let samples = 0;
    const sum = [0, 0, 0];
    for (let py = y0; py < y0 + h; py += 3) {
      for (let px = x0; px < x0 + w; px += 3) {
        const i = (Math.floor(py) * width + Math.floor(px)) * 4;
        const a = ink[i + 3];
        samples++;
        if (!a) continue;
        weight += a;
        for (let ch = 0; ch < 3; ch++) sum[ch] += ink[i + ch] * a;
      }
    }
    if (!weight) return;
    const taken = (weight / (samples * 255)) * 0.5; // more chalk under it, more dust
    const share = taken / (eraserDust.amount + taken);
    for (let ch = 0; ch < 3; ch++) eraserDust.rgb[ch] += (sum[ch] / weight - eraserDust.rgb[ch]) * share;
    eraserDust.amount = Math.min(1, eraserDust.amount + taken);
  }

  /** Leave a little of the felt's dust: faint streaks trailing behind it, and specks. */
  function dropDust(c, x, y, w, h, dx, dy) {
    const amount = eraserDust.amount;
    if (amount < 0.02) return;
    const rgb = eraserDust.rgb.map((v) => Math.round(v)).join(", ");
    if (rand() < amount) {
      const streaks = 1 + Math.floor(rand() * 2);
      for (let i = 0; i < streaks; i++) {
        // From somewhere under the felt, back the way it came.
        const sx = x + (rand() - 0.5) * w * 0.9;
        const sy = y + (rand() - 0.5) * h * 0.9;
        const reach = w * (0.15 + rand() * 0.55);
        const bend = (rand() - 0.5) * reach * 0.15;
        c.strokeStyle = `rgba(${rgb}, ${(0.03 + rand() * 0.07) * amount})`;
        c.lineWidth = 0.8 + rand() * 2.2;
        c.beginPath();
        c.moveTo(sx, sy);
        c.quadraticCurveTo(sx - dx * reach * 0.5 - dy * bend, sy - dy * reach * 0.5 + dx * bend, sx - dx * reach, sy - dy * reach);
        c.stroke();
      }
    }
    // Specks, mostly along the felt's edges where the dust gathers.
    const specks = Math.floor(rand() * 5 * amount);
    for (let i = 0; i < specks; i++) {
      const edge = rand() < 0.6;
      const sx = x + (rand() - 0.5) * w * 1.05;
      const sy = edge ? y + (rand() < 0.5 ? -1 : 1) * h * (0.45 + rand() * 0.12) : y + (rand() - 0.5) * h;
      const size = 0.8 + rand() * 1.6;
      c.fillStyle = `rgba(${rgb}, ${(0.08 + rand() * 0.22) * amount})`;
      c.fillRect(sx, sy, size, size);
    }
    eraserDust.amount *= 0.9; // what it's left behind is gone from the felt
  }

  /**
   * The felt eraser as the cursor, seen from the front: its wooden back, grain
   * along it, with the grey felt showing round the edge. `w` is its length.
   */
  function drawCursor(c, w) {
    const h = w * ERASER_ASPECT;
    const felt = Math.max(1.5, h * 0.09);
    c.fillStyle = "#55534f";
    roundRect(c, -w / 2, -h / 2, w, h, h * 0.14);
    c.fill();
    const wood = c.createLinearGradient(0, -h / 2, 0, h / 2);
    wood.addColorStop(0, "hsl(33, 50%, 68%)");
    wood.addColorStop(1, "hsl(29, 46%, 54%)");
    c.fillStyle = wood;
    roundRect(c, -w / 2 + felt, -h / 2 + felt, w - felt * 2, h - felt * 2, h * 0.1);
    c.fill();
    c.save();
    c.clip();
    c.strokeStyle = "rgba(110, 62, 24, 0.28)";
    c.lineWidth = Math.max(1, h * 0.035);
    for (let i = 0; i < 4; i++) {
      const y = -h / 2 + felt + ((i + 0.5) / 4) * (h - felt * 2);
      c.beginPath();
      c.moveTo(-w / 2, y);
      c.bezierCurveTo(-w / 6, y - h * 0.06 * (i % 2 ? 1 : -1), w / 6, y + h * 0.08, w / 2, y - h * 0.03);
      c.stroke();
    }
    c.restore();
    // An outline, so it shows on the dark slate.
    c.strokeStyle = "rgba(243, 240, 232, 0.85)";
    c.lineWidth = Math.max(2.5, w * 0.02);
    roundRect(c, -w / 2, -h / 2, w, h, h * 0.14);
    c.stroke();
  }

  return {
    /** A new stroke. */
    start() {
      wiped = 0;
    },
    wipe,
    drawCursor,
  };
}
