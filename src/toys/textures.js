import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// Helpers for the toys' painted textures (block faces, CD labels, etched balls)
// and reflections.

/** A small seeded random-number generator (0–1), so the same seed draws the same wear every visit. */
export function seeded(seed) {
  let n = seed;
  return () => {
    n = (n * 16807) % 2147483647;
    return (n - 1) / 2147483646;
  };
}

/** Smooth 1D value noise, 0–1: the same for the same `t`, every visit. */
export function noise(t) {
  const hash = (n) => {
    const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const i = Math.floor(t);
  const f = t - i;
  return hash(i) + (hash(i + 1) - hash(i)) * f * f * (3 - 2 * f);
}

/** A soft studio room for metal and shiny plastic to reflect (dispose it with the toy). */
export function studioEnvMap(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return envMap;
}

/** A blank canvas, `w` × `h` px. */
export function makeCanvas(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

/**
 * Draw on a fresh canvas and wrap it as a texture: `draw(ctx, width, height)`.
 * Colour images use sRGB; pass `color: false` for data maps (roughness, bump),
 * which must stay linear.
 */
export function canvasTexture(width, draw, { height = width, color = true, anisotropy = 8 } = {}) {
  const canvas = makeCanvas(width, height);
  draw(canvas.getContext("2d"), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}

/** Write text at (x, y), shrinking the font from `size` px until it fits `maxWidth`. */
export function fitText(c, text, x, y, maxWidth, size, font) {
  let px = size;
  do c.font = `${px--}px ${font}`;
  while (c.measureText(text).width > maxWidth && px > 8);
  c.fillText(text, x, y);
}

/** Trace a rounded rectangle path (fill or stroke it afterwards). */
export function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** Fill with `color` plus a little per-pixel noise (from `random`, 0–1). */
export function noisyFill(c, w, h, color, amount, random = Math.random) {
  c.fillStyle = color;
  c.fillRect(0, 0, w, h);
  const img = c.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (random() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  c.putImageData(img, 0, 0);
}
