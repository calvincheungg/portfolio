// Colour helpers for the drawing board: hex / HSL conversion for the colour
// picker, and mixing and toning for paint.

/** "#rrggbb" → [r, g, b], 0–255. */
export const hexToRGB = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export const rgbCss = ([r, g, b]) => `rgb(${r | 0},${g | 0},${b | 0})`;

/** "#rrggbb" → { h: 0–360, s: 0–100, l: 0–100 }, rounded to the picker's steps. */
export function hexToHsl(hex) {
  const [r, g, b] = hexToRGB(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToHex({ h, s, l }) {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return "#" + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}

/** A typed hex colour ("f80", "#ff8800") as "#ff8800", or null. */
export function parseHex(text) {
  const hex = text.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{6}$/.test(hex)) return `#${hex}`;
  if (/^[0-9a-f]{3}$/.test(hex)) return `#${[...hex].map((c) => c + c).join("")}`;
  return null;
}

/** Mix colour `a` toward `b` by `t` the way pigments mix (a weighted geometric mean), in place. */
export function pigment(a, b, t) {
  if (t <= 0) return a;
  for (let i = 0; i < 3; i++) a[i] = Math.exp((1 - t) * Math.log(Math.max(a[i], 3)) + t * Math.log(Math.max(b[i], 3)));
  return a;
}

/** Colour lightened (tone > 0) or darkened (tone < 0) by up to 100%. */
export const toned = (rgb, tone) => rgbCss(rgb.map((v) => (tone > 0 ? v + (255 - v) * tone : v * (1 + tone))));

/** A grey of brightness `v` (0–255, clamped), for relief maps. */
export const grey = (v) => {
  const g = Math.round(Math.min(255, Math.max(0, v)));
  return `rgb(${g},${g},${g})`;
};
// Natural logs of 0–255, for mixing colours like pigment (a weighted geometric
// mean): blue over yellow gives green, red over yellow orange, white over red pink.
export const LN = Float32Array.from({ length: 256 }, (_, v) => Math.log(Math.max(v, 3)));
