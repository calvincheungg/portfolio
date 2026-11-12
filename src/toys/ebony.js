import * as THREE from "three";
import { canvasTexture, noise, noisyFill, seeded } from "./textures.js";

// The Newton's cradle's base: weathered ebony with raw, unfinished edges.
// ebonyTextures() paints the wood; rawBlock() shapes a chipped, rough-sawn block
// whose UVs lay that wood along it.

const EBONY_TILE = [4, 2]; // world units the wood texture covers (along the grain, across)

/**
 * Weathered ebony, as colour, roughness and bump maps that tile: near-black
 * with dark brown streaks along the grain, dry greyish patches where it's
 * weathered, and fine cracks (checks) running with the grain. A natural, oiled
 * finish rather than a polish, so it stays fairly matte.
 *
 * With `figure`, the grain shows distinctly too: fine lighter-brown lines
 * along it, and a few cathedrals (the nested arches of a sawn board), lightly
 * open in the surface so they catch the light.
 */
export function ebonyTextures({ figure = false } = {}) {
  const W = 1024;
  const H = 512;
  const rand = seeded(301); // the same wood every visit
  // Grain streaks: wavy lines across the whole width. Whole numbers of waves,
  // so they meet themselves at the tile's edges.
  const streaks = Array.from({ length: 90 }, () => ({
    y: rand() * H,
    amp: 2 + rand() * 9,
    waves: 1 + Math.floor(rand() * 3),
    phase: rand() * Math.PI * 2,
    width: 1 + rand() ** 2 * 26,
    tone: rand(),
    a: 0.12 + rand() * 0.3,
  }));
  const patches = Array.from({ length: 16 }, () => ({ x: rand() * W, y: rand() * H, rx: 80 + rand() * 260, ry: 20 + rand() * 70, a: 0.06 + rand() * 0.1 }));
  const checks = Array.from({ length: 70 }, () => ({ x: rand() * W, y: rand() * H, len: 15 + rand() ** 2 * 140, w: 0.6 + rand() * 1.1, a: 0.5 + rand() * 0.4 }));
  // The figure (after the rest, so plain ebony comes out as before).
  // The grain lines all follow one gentle flow, so they run together
  // without crossing, each with a little wobble of its own.
  const flow = { waves: 2, phase: rand() * Math.PI * 2, amp: 14 };
  const lines = figure
    ? Array.from({ length: 120 }, (_, i) => ({
        y: ((i + rand() * 0.6) / 120) * H,
        waves: 3 + Math.floor(rand() * 3),
        phase: rand() * Math.PI * 2,
        amp: 0.6 + rand() * 1.4,
        width: 0.7 + rand() * 1.5,
        a: 0.18 + rand() * 0.32,
      }))
    : [];
  const cathedrals = figure
    ? Array.from({ length: 4 }, (_, i) => ({ x: ((i + 0.3 + rand() * 0.4) / 4) * W, y: rand() * H, rings: 6 + Math.floor(rand() * 4), gap: 5 + rand() * 3, a: 0.3 + rand() * 0.15 }))
    : [];

  // Draw each mark again a tile over wherever it runs off an edge.
  const wrapped = (x, y, reach, draw) => {
    for (const dx of [-W, 0, W]) {
      for (const dy of [-H, 0, H]) {
        if (x + dx + reach < 0 || x + dx - reach > W || y + dy + reach < 0 || y + dy - reach > H) continue;
        draw(x + dx, y + dy);
      }
    }
  };
  const streakPath = (c, st, dy) => {
    c.beginPath();
    for (let x = 0; x <= W; x += 8) {
      const y = st.y + dy + Math.sin((x / W) * Math.PI * 2 * st.waves + st.phase) * st.amp;
      x ? c.lineTo(x, y) : c.moveTo(x, y);
    }
  };
  const linePath = (c, ln, dy) => {
    c.beginPath();
    for (let x = 0; x <= W; x += 8) {
      const u = (x / W) * Math.PI * 2;
      const y = ln.y + dy + Math.sin(u * flow.waves + flow.phase) * flow.amp + Math.sin(u * ln.waves + ln.phase) * ln.amp;
      x ? c.lineTo(x, y) : c.moveTo(x, y);
    }
  };
  /** One cathedral: nested arches pointing along the grain, trailing off into straight grain. */
  const cathedralPath = (c, cd, x, y, j) => {
    const half = j * cd.gap;
    const length = 30 + j * 42;
    const tail = 120;
    c.beginPath();
    c.moveTo(x - length - tail, y - half);
    for (let t = -1; t <= 1.001; t += 0.1) c.lineTo(x - length * t * t, y + half * t);
    c.lineTo(x - length - tail, y + half);
  };
  const checkPath = (c, x, y, len) => {
    c.beginPath();
    c.moveTo(x, y);
    for (let t = 6; t <= len; t += 6) c.lineTo(x + t, y + Math.sin(t * 0.13 + x) * 0.8);
  };
  const patch = (c, p, x, y, rgb, a) => {
    c.save();
    c.translate(x, y);
    c.scale(1, p.ry / p.rx);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, p.rx);
    g.addColorStop(0, `rgba(${rgb}, ${a})`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    c.fillStyle = g;
    c.fillRect(-p.rx, -p.rx, p.rx * 2, p.rx * 2);
    c.restore();
  };

  // One pass of every mark, in the colours each map wants.
  function paint(c, { base, noise, streak, grain, weather, crack, crackLip }) {
    noisyFill(c, W, H, base, noise, rand);
    for (const st of streaks) {
      c.strokeStyle = streak(st);
      c.lineWidth = st.width;
      for (const dy of [-H, 0, H]) {
        streakPath(c, st, dy);
        c.stroke();
      }
    }
    for (const ln of lines) {
      c.strokeStyle = `rgba(${grain}, ${ln.a})`;
      c.lineWidth = ln.width;
      for (const dy of [-H, 0, H]) {
        linePath(c, ln, dy);
        c.stroke();
      }
    }
    for (const cd of cathedrals) {
      wrapped(cd.x, cd.y, 30 + cd.rings * 42 + 120, (x, y) => {
        for (let j = 1; j <= cd.rings; j++) {
          cathedralPath(c, cd, x, y, j);
          c.strokeStyle = `rgba(${grain}, ${cd.a})`;
          c.lineWidth = 1.2 + (j % 3) * 0.5;
          c.stroke();
        }
      });
    }
    for (const p of patches) wrapped(p.x, p.y, p.rx, (x, y) => patch(c, p, x, y, weather, p.a));
    for (const k of checks) {
      wrapped(k.x, k.y, k.len, (x, y) => {
        if (crackLip) {
          checkPath(c, x, y + 1, k.len);
          c.strokeStyle = crackLip;
          c.lineWidth = k.w;
          c.stroke();
        }
        checkPath(c, x, y, k.len);
        c.strokeStyle = `rgba(${crack}, ${k.a})`;
        c.lineWidth = k.w;
        c.stroke();
      });
    }
  }

  const opts = { height: H };
  const map = canvasTexture(W, (c) =>
    paint(c, {
      base: "#1a1410",
      noise: 10,
      // Mostly black streaks, some warm dark brown.
      streak: (st) => (st.tone < 0.55 ? `rgba(6, 4, 3, ${st.a})` : `rgba(64, 44, 30, ${st.a * 0.8})`),
      grain: "150, 108, 74", // the figure, lighter brown
      weather: "128, 120, 110", // dry, greyed wood
      crack: "2, 2, 2",
      crackLip: "rgba(90, 80, 70, 0.25)",
    }), opts);
  const roughnessMap = canvasTexture(W, (c) =>
    paint(c, {
      base: "rgb(185, 185, 185)", // oiled, not polished
      noise: 14,
      streak: (st) => `rgba(${st.tone < 0.55 ? "160, 160, 160" : "215, 215, 215"}, ${st.a})`,
      grain: "205, 205, 205",
      weather: "245, 245, 245", // weathered patches are dry and dull
      crack: "255, 255, 255",
    }), { ...opts, color: false });
  const bumpMap = canvasTexture(W, (c) =>
    paint(c, {
      base: "rgb(150, 150, 150)",
      noise: 18,
      streak: (st) => `rgba(${st.tone < 0.55 ? "110, 110, 110" : "185, 185, 185"}, ${st.a})`,
      grain: "105, 105, 105", // open, a little below the surface
      weather: "130, 130, 130",
      crack: "0, 0, 0", // cut into the surface
    }), { ...opts, color: false });
  for (const t of [map, roughnessMap, bumpMap]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return { map, roughnessMap, bumpMap };
}

/**
 * A block of raw, unfinished wood: its edges are chipped and uneven rather
 * than sanded round, and its faces faintly rough-sawn. Every vertex moves by
 * a function of where it is, so the faces still meet exactly along the edges.
 * UVs follow world size, with the grain running along x.
 */
export function rawBlock(w, h, d, { chips = 1 } = {}) {
  const DENSITY = 24; // segments per unit, so chips have vertices to shape them
  const geo = new THREE.BoxGeometry(w, h, d, Math.round(w * DENSITY), Math.max(4, Math.round(h * DENSITY)), Math.round(d * DENSITY));
  const half = [w / 2, h / 2, d / 2];
  const BAND = 0.09 * chips; // how far a chip reaches in from an edge (`chips` scales them, for thinner pieces)
  const pos = geo.attributes.position;
  const normal = geo.attributes.normal;
  const uv = geo.attributes.uv;
  const [tu, tv] = EBONY_TILE;

  // How deep the edge is chipped at `t` along it: always a little, sometimes a lot.
  const chip = (t, edge) => {
    const n = noise(t * 5 + edge * 17.3);
    const gouge = Math.max(0, noise(t * 13 + edge * 7.1) - 0.72) / 0.28;
    return (0.008 + 0.03 * n * n + 0.045 * gouge * gouge) * chips;
  };

  for (let i = 0; i < pos.count; i++) {
    const q = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const out = [...q];
    const inset = q.map((v, a) => half[a] - Math.abs(v)); // 0 on a face
    // Each of the 12 edges runs along one axis, between two faces (a, b).
    for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
      const dist = Math.hypot(inset[a], inset[b]);
      if (dist > BAND) continue;
      const along = 3 - a - b;
      const edge = a * 10 + b * 3 + (q[a] > 0 ? 1 : 0) * 2 + (q[b] > 0 ? 1 : 0);
      const f = (1 - dist / BAND) ** 2;
      const depth = chip(q[along], edge) * f;
      out[a] -= Math.sign(q[a]) * depth;
      out[b] -= Math.sign(q[b]) * depth;
    }
    // Rough-sawn faces: a faint unevenness, pressed in.
    const rough = 0.004 * (Math.sin(q[0] * 9.3 + q[2] * 3.1) + 0.5 * Math.sin(q[0] * 23.7 - q[1] * 17 + q[2] * 11));
    for (let a = 0; a < 3; a++) if (inset[a] < 1e-5) out[a] -= Math.sign(q[a]) * Math.abs(rough);
    pos.setXYZ(i, ...out);

    // Grain along x on the top, bottom, front and back; across on the ends.
    const n = [normal.getX(i), normal.getY(i), normal.getZ(i)].map(Math.abs);
    if (n[1] > 0.5) uv.setXY(i, q[0] / tu, q[2] / tv);
    else if (n[2] > 0.5) uv.setXY(i, q[0] / tu, q[1] / tv);
    else uv.setXY(i, q[2] / tu, q[1] / tv);
  }
  geo.computeVertexNormals();
  return geo;
}
