import * as THREE from "three";
import { NAME } from "./shared.js";
import { canvasTexture, noisyFill } from "./textures.js";
import { createSilver } from "./silver.js";
import { fonts } from "../lib/fonts.js";
import { getSetting, onSettingChange, theme } from "../settings.js";

// Newton's cradle with the name etched into the balls.
//
// The swinging is simulated here rather than in cannon-es: a general physics
// engine solves all the touching balls' contacts at once, which smears the
// impulse across the row. Treating each ball as a pendulum and resolving hits
// pair by pair passes the impulse down the line, so one ball in sends exactly
// one ball out, like the real thing.

const R = 0.5; // ball radius
const COUNT = NAME.length;
const TOP = 4.2; // height of the top rails
const REST_Y = 1.25; // ball centre height at rest
const LENGTH = TOP - REST_Y; // effective pendulum length (the V strings' drop)
const RAIL_Z = 0.95; // strings run to rails in front of and behind the balls
const FRAME_X = COUNT * R + 0.9;
const BASE_H = 0.28;

const GRAVITY = 22;
const RESTITUTION = 0.97; // bounciness of a hard steel-on-steel click

// Gentle hits barely bounce: the balls stay in contact and push each other
// along together, which is also why a real cradle ends up swaying as one.
// Bounciness eases from 0 at STICK_SPEED to RESTITUTION at BOUNCE_SPEED
// (impact speeds in world units/s; a full pull-back hits at about 6).
const STICK_SPEED = 0.05;
const BOUNCE_SPEED = 0.8;

// Overlap correction: ignore tiny overlaps and resolve the rest gradually,
// so resting balls don't get nudged (and jitter) every step.
const CONTACT_SLOP = 2e-4;
const CORRECTION = 0.4;
const AIR_DAMPING = 0.02; // per second; heavy steel barely notices the air
const MAX_ANGLE = 1.4; // radians you can pull a ball back to

// A held ball is pulled toward the pointer by a spring rather than stuck to it,
// so it trails your hand, sags under gravity and carries real momentum when let
// go. Lower HOLD_STIFFNESS / HOLD_MAX_PULL = heavier.
const HOLD_STIFFNESS = 60; // spring strength (1/s²)
const HOLD_DAMPING = 12; // stops it wobbling around the pointer
const HOLD_MAX_PULL = 40; // cap on how hard your hand can accelerate it (rad/s²)
const SUBSTEP = 1 / 600;

// Live reflections per graphics setting: resolution of each ball's reflection,
// and how many balls refresh theirs each frame (they take turns).
const STILL = 1e-3; // below this angle (rad) and speed (rad/s) a ball is at rest

const PROBE_QUALITY = {
  high: { size: 128, perFrame: 2 },
  low: { size: 64, perFrame: 1 },
};
const probeQuality = () => PROBE_QUALITY[getSetting("quality")];

// Rest positions: balls just touching.
const restX = Array.from({ length: COUNT }, (_, i) => (i - (COUNT - 1) / 2) * 2 * R);

// ---------- Etched ball textures ----------

// Equirectangular maps; the letter sits at u = 0.25, which three.js's sphere
// maps to the side facing +z (the camera).
function etchTexture(letter, background, ink, { blur = 0, color = false } = {}) {
  return canvasTexture(
    1024,
    (c, w, h) => {
      c.fillStyle = background;
      c.fillRect(0, 0, w, h);
      c.filter = blur ? `blur(${blur}px)` : "none";
      c.font = `${Math.round(h * 0.36)}px ${fonts.letter}`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = ink;
      c.fillText(letter, w * 0.25, h * 0.5 + h * 0.02);
    },
    { height: 512, color }
  );
}

function makeBallMaterial(letter, envMap) {
  // Colour: etched letter is duller than the polished steel around it.
  const map = etchTexture(letter, "#ffffff", "#80858b", { color: true });
  // Roughness: polished surface, frosted etching.
  const roughnessMap = etchTexture(letter, "rgb(28,28,28)", "rgb(150,150,150)");
  // Bump: the letter is cut slightly into the surface.
  const bumpMap = etchTexture(letter, "#ffffff", "#000000", { blur: 3 });

  return new THREE.MeshStandardMaterial({
    color: 0xe9ecef,
    metalness: 1,
    roughness: 1, // scaled by roughnessMap
    map,
    roughnessMap,
    bumpMap,
    bumpScale: 1.2,
    envMap,
  });
}

// ---------- Reflection studio ----------

// The page background is flat, and chrome reflecting a flat colour just looks
// grey. While the balls capture their reflections, the scene is wrapped in this
// studio instead: page-coloured walls, a darker floor for a horizon line,
// bright panels lined up with the real light, and dark panels for contrast.
// Colours above 1 are kept (half-float target) so highlights stay hot.
const STUDIO_COLORS = {
  light: { walls: 0xece6dd, floor: 0xb3a898, flags: 0x2a2622 },
  dark: { walls: 0x2a2622, floor: 0x100e0c, flags: 0x050505 },
};

function buildStudio(renderer, mode) {
  const colors = STUDIO_COLORS[mode];
  const env = new THREE.Scene();
  const things = [];
  const add = (mesh) => (env.add(mesh), things.push(mesh), mesh);

  add(new THREE.Mesh(
    new THREE.BoxGeometry(40, 24, 40),
    new THREE.MeshBasicMaterial({ color: colors.walls, side: THREE.BackSide })
  )).position.y = 10;

  const floor = add(new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshBasicMaterial({ color: colors.floor })
  ));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;

  const panel = (w, h, [x, y, z], color, intensity = 1) => {
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    mat.color.multiplyScalar(intensity);
    const mesh = add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat));
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 1.5, 0);
  };
  panel(10, 6, [6, 14, 9], 0xffffff, 6); // key, same side as the scene's sun
  panel(6, 8, [-12, 8, 4], 0xfff4e6, 2); // warm fill
  panel(14, 3, [0, 10, -14], 0xffffff, 3); // rim strip behind
  panel(6, 10, [14, 5, -2], colors.flags); // dark flags give the chrome contrast
  panel(5, 10, [-14, 5, -6], colors.flags);

  const target = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  const camera = new THREE.CubeCamera(0.1, 100, target);
  camera.position.set(0, 1.5, 0);
  camera.update(renderer, env);

  for (const mesh of things) {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  return target;
}

// ---------- Ebony base ----------

const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
/** Smooth 1D value noise, 0–1. */
function noise1(t) {
  const i = Math.floor(t);
  const f = t - i;
  return hash(i) + (hash(i + 1) - hash(i)) * f * f * (3 - 2 * f);
}

const EBONY_TILE = [4, 2]; // world units the wood texture covers (along the grain, across)

/**
 * Weathered ebony, as colour, roughness and bump maps that tile: near-black
 * with dark brown streaks along the grain, dry greyish patches where it's
 * weathered, and fine cracks (checks) running with the grain. A natural, oiled
 * finish rather than a polish, so it stays fairly matte.
 */
function ebonyTextures() {
  const W = 1024;
  const H = 512;
  const rand = Math.random;
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
  function paint(c, { base, noise, streak, weather, crack, crackLip }) {
    noisyFill(c, W, H, base, noise);
    for (const st of streaks) {
      c.strokeStyle = streak(st);
      c.lineWidth = st.width;
      for (const dy of [-H, 0, H]) {
        streakPath(c, st, dy);
        c.stroke();
      }
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
      weather: "128, 120, 110", // dry, greyed wood
      crack: "2, 2, 2",
      crackLip: "rgba(90, 80, 70, 0.25)",
    }), opts);
  const roughnessMap = canvasTexture(W, (c) =>
    paint(c, {
      base: "rgb(185, 185, 185)", // oiled, not polished
      noise: 14,
      streak: (st) => `rgba(${st.tone < 0.55 ? "160, 160, 160" : "215, 215, 215"}, ${st.a})`,
      weather: "245, 245, 245", // weathered patches are dry and dull
      crack: "255, 255, 255",
    }), { ...opts, color: false });
  const bumpMap = canvasTexture(W, (c) =>
    paint(c, {
      base: "rgb(150, 150, 150)",
      noise: 18,
      streak: (st) => `rgba(${st.tone < 0.55 ? "110, 110, 110" : "185, 185, 185"}, ${st.a})`,
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
function rawBlock(w, h, d) {
  const DENSITY = 24; // segments per unit, so chips have vertices to shape them
  const geo = new THREE.BoxGeometry(w, h, d, Math.round(w * DENSITY), Math.max(4, Math.round(h * DENSITY)), Math.round(d * DENSITY));
  const half = [w / 2, h / 2, d / 2];
  const BAND = 0.09; // how far a chip reaches in from an edge
  const pos = geo.attributes.position;
  const normal = geo.attributes.normal;
  const uv = geo.attributes.uv;
  const [tu, tv] = EBONY_TILE;

  // How deep the edge is chipped at `t` along it: always a little, sometimes a lot.
  const chip = (t, edge) => {
    const n = noise1(t * 5 + edge * 17.3);
    const gouge = Math.max(0, noise1(t * 13 + edge * 7.1) - 0.72) / 0.28;
    return 0.008 + 0.03 * n * n + 0.045 * gouge * gouge;
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

// ---------- Toy ----------

export function createCradle({ scene, renderer }) {
  const group = new THREE.Group();
  scene.add(group);

  let studio = buildStudio(renderer, theme());
  const envMap = studio.texture; // the frame reflects the studio only

  const disposables = [];
  const track = (thing) => (disposables.push(thing), thing);

  // ----- Frame: old, worn silver with crown finials, like the easel (silver.js) -----
  // When the band's font arrives, draw again (and let the balls re-reflect it).
  const silver = createSilver({ envMap, track, onRedraw: () => (settleCaptures = COUNT * 2) });

  // The base: a slab of weathered ebony with raw, chipped edges.
  const ebony = ebonyTextures();
  const baseMat = track(
    new THREE.MeshStandardMaterial({
      map: track(ebony.map),
      roughnessMap: track(ebony.roughnessMap),
      roughness: 1, // scaled by the map
      bumpMap: track(ebony.bumpMap),
      bumpScale: 0.8,
      envMap,
      envMapIntensity: 0.25, // an oiled sheen, nothing more
    })
  );
  const BASE_W = FRAME_X * 2 + 0.6;
  const BASE_D = RAIL_Z * 2 + 0.8;
  const base = new THREE.Mesh(track(rawBlock(BASE_W, BASE_H, BASE_D)), baseMat);
  base.position.y = BASE_H / 2;
  group.add(base);
  // Fluted studs on the base: its corners and the middle of the front and back.
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1]]) {
    const stud = silver.stud();
    stud.scale.setScalar(1.3);
    stud.position.set(x * (BASE_W / 2 - 0.2), BASE_H, z * (BASE_D / 2 - 0.2));
    group.add(stud);
  }

  const POST_R = 0.06;
  for (const z of [-RAIL_Z, RAIL_Z]) {
    for (const x of [-FRAME_X, FRAME_X]) {
      const post = silver.rod(POST_R, TOP - BASE_H);
      post.position.set(x, BASE_H + (TOP - BASE_H) / 2, z);
      group.add(post);
      // Beaded collars where the post meets the base, and under the top.
      for (const [y, r] of [[BASE_H + 0.02, 0.09], [BASE_H + 0.06, 0.075], [TOP - 0.22, 0.075], [TOP - 0.18, 0.085]]) {
        const ring = silver.bead(r, 0.016);
        ring.position.set(x, y, z);
        group.add(ring);
      }
      // A crown finial caps the post, over the rail's end.
      const crown = silver.finial(0.6);
      crown.position.set(x, TOP + 0.02, z);
      group.add(crown);
    }
    const rail = silver.rod(POST_R, FRAME_X * 2);
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, TOP, z);
    group.add(rail);
  }

  // ----- Balls -----
  // Each ball has its own cube camera ("probe") that films the scene from where
  // the ball hangs, so it reflects its neighbours, the frame and the shadows as
  // they move. three.js blurs each capture to match the surface roughness, so
  // the polish stays sharp and the frosted etching stays soft.
  const ballGeo = track(new THREE.SphereGeometry(R, 64, 48));
  const probes = [];
  const balls = [...NAME].map((letter, i) => {
    const target = new THREE.WebGLCubeRenderTarget(probeQuality().size, { type: THREE.HalfFloatType });
    probes.push(new THREE.CubeCamera(0.05, 60, target));
    const mesh = new THREE.Mesh(ballGeo, track(makeBallMaterial(letter, target.texture)));
    mesh.userData.index = i;
    group.add(mesh);
    return mesh;
  });

  // ----- Strings: two per ball, in a V to the front and back rails -----
  const stringPositions = new Float32Array(COUNT * 2 * 2 * 3);
  const stringGeo = track(new THREE.BufferGeometry());
  stringGeo.setAttribute("position", new THREE.BufferAttribute(stringPositions, 3));
  const strings = new THREE.LineSegments(
    stringGeo,
    track(new THREE.LineBasicMaterial({ color: 0x55524d, transparent: true, opacity: 0.7 }))
  );
  group.add(strings);

  group.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });
  silver.bake(group); // the tarnish flows across the frame as one piece

  // ----- Simulation state -----
  const theta = new Array(COUNT).fill(0); // swing angle, + is to the right
  const omega = new Array(COUNT).fill(0); // angular velocity
  let held = null;
  let settleCaptures = 0; // reflection refreshes still owed after the balls stop // { index, target } — target is the angle the pointer wants

  // Start with the first ball pulled back so it's already clicking.
  theta[0] = -0.75;

  const ballPos = (i) => [restX[i] + LENGTH * Math.sin(theta[i]), TOP - LENGTH * Math.cos(theta[i])];
  const ballVel = (i) => [LENGTH * omega[i] * Math.cos(theta[i]), LENGTH * omega[i] * Math.sin(theta[i])];

  function integrate(h) {
    for (let i = 0; i < COUNT; i++) {
      let accel = -(GRAVITY / LENGTH) * Math.sin(theta[i]);
      if (held?.index === i) {
        const pull = THREE.MathUtils.clamp(HOLD_STIFFNESS * (held.target - theta[i]), -HOLD_MAX_PULL, HOLD_MAX_PULL);
        accel += pull - HOLD_DAMPING * omega[i];
      }
      omega[i] += accel * h;
      omega[i] *= 1 - AIR_DAMPING * h;
      theta[i] += omega[i] * h;
    }
  }

  function collidePair(a, b) {
    const [ax, ay] = ballPos(a);
    const [bx, by] = ballPos(b);
    const dx = bx - ax;
    const dy = by - ay;
    const dist = Math.hypot(dx, dy) || 1e-9;
    if (dist > 2 * R + 1e-4) return false;

    // Push apart if overlapping. A held ball is still a heavy ball: it gets
    // knocked like the others and the hold spring pulls it back.
    const overlap = 2 * R - dist;
    if (overlap > CONTACT_SLOP) {
      const shift = ((overlap - CONTACT_SLOP) * CORRECTION) / LENGTH;
      theta[a] -= shift / 2;
      theta[b] += shift / 2;
    }

    // Only bounce if they're moving towards each other.
    const [avx, avy] = ballVel(a);
    const [bvx, bvy] = ballVel(b);
    const closing = ((avx - bvx) * dx + (avy - bvy) * dy) / dist;
    if (closing <= 1e-6) return false;

    // Equal masses: hard hits swap velocities, soft ones even them out.
    const e = RESTITUTION * THREE.MathUtils.smoothstep(closing, STICK_SPEED, BOUNCE_SPEED);
    const wa = omega[a];
    const wb = omega[b];
    omega[a] = ((1 - e) * wa + (1 + e) * wb) / 2;
    omega[b] = ((1 + e) * wa + (1 - e) * wb) / 2;
    return true;
  }

  function resolveCollisions() {
    // Sweep back and forth until nothing is hitting, so an impulse can travel
    // the whole row within one step.
    for (let pass = 0; pass < COUNT * 2; pass++) {
      let hitAny = false;
      const forward = pass % 2 === 0;
      for (let k = 0; k < COUNT - 1; k++) {
        const i = forward ? k : COUNT - 2 - k;
        if (collidePair(i, i + 1)) hitAny = true;
      }
      if (!hitAny) break;
    }
  }

  function syncVisuals() {
    for (let i = 0; i < COUNT; i++) {
      const [x, y] = ballPos(i);
      balls[i].position.set(x, y, 0);
      balls[i].rotation.z = theta[i]; // ball turns with its strings

      // Each string runs from its rail to the top of the ball.
      for (let s = 0; s < 2; s++) {
        const z = s === 0 ? -RAIL_Z : RAIL_Z;
        const dx = restX[i] - x;
        const dy = TOP - y;
        const len = Math.hypot(dx, dy, z);
        const o = (i * 2 + s) * 6;
        stringPositions.set([restX[i], TOP, z, x + (dx / len) * R, y + (dy / len) * R, (z / len) * R], o);
      }
    }
    stringGeo.attributes.position.needsUpdate = true;
  }

  // Refresh a few balls' reflections, taking turns so it stays cheap.
  let nextProbe = 0;
  function captureReflections(count) {
    const background = scene.background;
    const autoShadows = renderer.shadowMap.autoUpdate;
    scene.background = studio.texture;
    renderer.shadowMap.autoUpdate = false; // reuse this frame's shadow map

    for (let k = 0; k < count; k++) {
      const i = nextProbe;
      nextProbe = (nextProbe + 1) % COUNT;
      balls[i].visible = false; // a ball can't see itself
      probes[i].position.copy(balls[i].position);
      probes[i].update(renderer, scene);
      balls[i].visible = true;
    }

    scene.background = background;
    renderer.shadowMap.autoUpdate = autoShadows;
  }

  // Settings: rebuild the studio for the new theme, or the reflections at the new
  // resolution, then recapture so the change shows straight away.
  const unsubscribe = onSettingChange((key) => {
    if (key === "theme") {
      const old = studio;
      studio = buildStudio(renderer, theme());
      for (const material of [...silver.materials, baseMat]) material.envMap = studio.texture;
      old.dispose();
    } else if (key === "quality") {
      probes.forEach((probe, i) => {
        const old = probe.renderTarget;
        probe.renderTarget = new THREE.WebGLCubeRenderTarget(probeQuality().size, { type: THREE.HalfFloatType });
        balls[i].material.envMap = probe.renderTarget.texture;
        old.dispose();
      });
    } else return;
    captureReflections(COUNT * 2);
  });

  syncVisuals();
  // Two full rounds up front so the balls already show each other (and each
  // other's reflections) on the first frame.
  captureReflections(COUNT * 2);

  return {
    pickables: balls,

    grab(hit) {
      const index = hit.object.userData.index;
      // Drag in the plane of the swing; keep the offset between where the ball
      // was grabbed and its centre so it doesn't jump.
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -hit.point.z);
      const angleTo = (p) => Math.atan2(p.x - restX[index], TOP - p.y);
      const offset = angleTo(hit.point) - theta[index];
      const point = new THREE.Vector3();
      held = { index, target: theta[index] };

      return {
        move(ray) {
          if (!ray.intersectPlane(plane, point)) return;
          held.target = THREE.MathUtils.clamp(angleTo(point) - offset, -MAX_ANGLE, MAX_ANGLE);
        },
        // Letting go keeps whatever momentum the ball really has.
        release() {
          held = null;
        },
      };
    },

    // Skips everything (and returns false) once the balls are at rest and their
    // reflections have caught up.
    update(dt) {
      const moving = !!held || theta.some((t, i) => Math.abs(t) > STILL || Math.abs(omega[i]) > STILL);
      if (moving) settleCaptures = COUNT * 2; // refresh every reflection twice once it stops
      else if (settleCaptures <= 0) return false;

      if (moving) {
        const steps = Math.min(Math.ceil(dt / SUBSTEP), 100);
        const h = dt / steps;
        for (let s = 0; s < steps; s++) {
          integrate(h);
          resolveCollisions();
        }
        syncVisuals();
      }
      const n = probeQuality().perFrame;
      captureReflections(n);
      if (!moving) settleCaptures -= n;
      return true;
    },

    dispose() {
      unsubscribe();
      scene.remove(group);
      for (const thing of disposables) thing.dispose();
      studio.dispose();
      for (const probe of probes) probe.renderTarget.dispose();
      for (const ball of balls) {
        ball.material.map.dispose();
        ball.material.roughnessMap.dispose();
        ball.material.bumpMap.dispose();
      }
    },
  };
}
