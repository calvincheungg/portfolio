import * as THREE from "three";

// Helpers for the toys' painted textures (block faces, CD labels, etched balls).

/**
 * Draw on a fresh canvas and wrap it as a texture: `draw(ctx, width, height)`.
 * Colour images use sRGB; pass `color: false` for data maps (roughness, bump),
 * which must stay linear.
 */
export function canvasTexture(width, draw, { height = width, color = true, anisotropy = 8 } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
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
