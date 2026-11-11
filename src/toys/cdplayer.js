import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { gsap } from "gsap";
import { NAME } from "./shared.js";
import { canvasTexture, fitText } from "./textures.js";
import { createSilver } from "./silver.js";
import { PLAYLISTS } from "../../playlists.js";
import { music } from "../music/music.js";
import { openTrackList } from "../music/tracklist.js";
import { reduceMotion } from "../settings.js";
import { fonts } from "../lib/fonts.js";
import { formatLength } from "../lib/format.js";

// Portable CD player (a late-90s silver Discman) propped up facing the viewer,
// with a rotary card file (a "rolodex") of CD cases beside it, one per
// playlist. Scroll or drag the card file to flip through them, and click the
// case at the front to load its disc. The buttons along the front work:
// previous, next, shuffle, play/pause and the song list. Clicking the lid
// opens it, and with it open, clicking the spinning disc pauses or plays. The
// little screen shows the track and time. Audio comes from music.js.

const R = 1.45; // half the player's width
const BODY_H = 0.36;
const LID_H = 0.11;
const DISC_R = 0.92;
const HOLE_R = 0.1;
const TILT = 1.15; // radians the player leans back toward the camera
const PLAYER_X = 0; // centred; the card file sits to its right
const LID_OPEN = 1.9; // radians the lid swings open
const SPIN_SPEED = 9; // disc rad/s while playing

// The player's outline from above is a "squircle" (a superellipse): rounder
// than a square, squarer than a circle.
const SQUIRCLE = 3;
/** Half-depth of the outline at `x`, for an outline of half-width `r`. */
const outlineZ = (x, r = R) => r * Math.max(0, 1 - Math.abs(x / r) ** SQUIRCLE) ** (1 / SQUIRCLE);

// The lid covers the back and middle; the controls sit on the crescent of body
// left in front of it. A tab in the middle of the lid's front edge reaches down
// to the screen.
const LID_R = R * 0.94;
const TAB_W = 0.5; // the tab's half-width
const TAB_Z = 1.0; // how far forward it reaches
/** Where the lid's front edge is at `x` (z, toward the viewer). */
function lidFrontZ(x) {
  const edge = 0.86 - 0.3 * (x / R) ** 2 * R;
  const t = THREE.MathUtils.smoothstep(Math.abs(x), TAB_W - 0.08, TAB_W + 0.08);
  return TAB_Z + (edge - TAB_Z) * t;
}

const LCD = { z: 1.2, w: 0.84, d: 0.24 }; // the screen, on the front deck

const CASE_SIZE = 1.1;
const CASE_DEPTH = 0.1;

// Card file: the CD cases are cards on a wheel that turns on a horizontal
// axle. The card at the top leans toward you; the next ones stand behind it
// with their name tabs showing over the top, and the one you flipped past
// hangs down in front, showing its back cover. The rest go round underneath.
const TAB = { w: 0.52, h: 0.2, stagger: [-0.3, 0.02, 0.3] }; // tabs step left to right, card by card
const FILE_X = R + 1.25; // centre of the card file, right of the player
const FILLERS = 0; // blank index cards between CD cases (none: every card is a playlist)
const HUB_R = 0.3; // cards clip on at this radius
const AXLE_Y = HUB_R + CASE_SIZE + 0.14;
const LEAN_FRONT = 110; // degrees the card just flipped past falls forward (past flat, so its back faces you)
const LEAN_UP = 20; // the front card leans toward you, so the next one's title shows over it
const LEAN_BACK = -18; // the next card, standing just behind
const DRAG_PER_CASE = 0.45; // world units of drag to flip one CD case past

// ---------- Canvas textures ----------

/** A small seeded random-number generator, so the wear is the same every visit. */
function seeded(seed) {
  let n = seed;
  return () => {
    n = (n * 16807) % 2147483647;
    return (n - 1) / 2147483646;
  };
}

/**
 * Years of wear on matt silver, drawn the way it happens rather than as clean
 * lines: scratches that wander a little, fade in, deepen and fade out (and
 * sometimes skip), smudges built from overlapping prints and wipes, and dirt
 * specks gathered in clusters. `seed` fixes where everything lands, so it's
 * the same every visit.
 */
function drawWear(c, s, seed) {
  const rnd = seeded(seed);
  c.lineCap = "round";

  // Smooth noise along a scratch (a few out-of-step waves), roughly 0–1.
  const wobble = () => {
    const waves = [0, 1, 2].map(() => ({ f: 2 + rnd() * 9, p: rnd() * Math.PI * 2 }));
    return (t) => 0.5 + waves.reduce((sum, w, i) => sum + Math.sin(t * w.f + w.p) / (3 * (i + 1)), 0);
  };

  /**
   * One scratch: a wandering path whose strength rises from nothing, varies
   * along the way and dies out again. `layers` are [colour, width, offset]:
   * a dark cut, plus a bright lip beside it for deeper ones.
   */
  function scratch({ x, y, angle, len, peak, width, layers }) {
    const steps = Math.max(4, Math.round(len / 3));
    const turn = (rnd() - 0.5) * 0.012; // a slight steady curve
    const drift = wobble(); // and some wander
    const strength = wobble();
    const points = [];
    let a = angle;
    let px = x;
    let py = y;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      points.push([px, py, t]);
      a += turn + (drift(t * 6) - 0.5) * 0.06;
      px += Math.cos(a) * (len / steps);
      py += Math.sin(a) * (len / steps);
    }
    for (const [color, w, offset] of layers) {
      for (let i = 1; i < points.length; i++) {
        const [x0, y0] = points[i - 1];
        const [x1, y1, t] = points[i];
        // Fades in and out at the ends, uneven in between, with the odd gap.
        const along = Math.sin(Math.PI * t) ** 0.8 * (0.35 + 0.65 * strength(t * 5));
        if (along < 0.08) continue;
        c.beginPath();
        c.moveTo(x0 + offset, y0 + offset);
        c.lineTo(x1 + offset, y1 + offset);
        c.strokeStyle = `rgba(${color}, ${peak * along})`;
        c.lineWidth = w * width * (0.45 + 0.55 * along);
        c.stroke();
      }
    }
  }

  // Smudges: fingerprints and wipes, each a cluster of soft overlapping
  // patches, greyish with a touch of warmth (skin oil and dust).
  for (let i = 0; i < 16; i++) {
    const x = rnd() * s;
    const y = rnd() * s;
    const wipe = rnd() < 0.4; // a long smear rather than a print
    const blobs = 3 + Math.floor(rnd() * 5);
    const angle = rnd() * Math.PI;
    for (let k = 0; k < blobs; k++) {
      const along = wipe ? (k / blobs - 0.5) * (80 + rnd() * 120) : (rnd() - 0.5) * 40;
      const bx = x + Math.cos(angle) * along + (rnd() - 0.5) * 20;
      const by = y + Math.sin(angle) * along + (rnd() - 0.5) * 20;
      const r = (wipe ? 30 : 22) + rnd() * (wipe ? 50 : 40);
      const alpha = 0.025 + rnd() * 0.045; // they overlap, so each is light
      c.save();
      c.translate(bx, by);
      c.rotate(angle + (rnd() - 0.5) * 0.6);
      c.scale(wipe ? 1.8 + rnd() : 1 + rnd() * 0.5, 1);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, `rgba(72, 68, 62, ${alpha})`);
      g.addColorStop(0.55, `rgba(72, 68, 62, ${alpha * 0.7})`);
      g.addColorStop(1, "rgba(72, 68, 62, 0)");
      c.fillStyle = g;
      c.fillRect(-r, -r, r * 2, r * 2);
      c.restore();
    }
  }

  // Dirt: specks in loose clusters, with a soft halo, and a few lone ones.
  for (let i = 0; i < 16; i++) {
    const cx = rnd() * s;
    const cy = rnd() * s;
    const count = rnd() < 0.3 ? 1 : 3 + Math.floor(rnd() * 7);
    for (let k = 0; k < count; k++) {
      const x = cx + (rnd() - 0.5) * 50;
      const y = cy + (rnd() - 0.5) * 50;
      const r = 0.6 + rnd() ** 2 * 2.4;
      const g = c.createRadialGradient(x, y, 0, x, y, r * 2.2);
      const alpha = 0.16 + rnd() * 0.26;
      g.addColorStop(0, `rgba(48, 42, 36, ${alpha})`);
      g.addColorStop(0.45, `rgba(48, 42, 36, ${alpha * 0.7})`);
      g.addColorStop(1, "rgba(48, 42, 36, 0)");
      c.fillStyle = g;
      c.fillRect(x - r * 2.2, y - r * 2.2, r * 4.4, r * 4.4);
    }
  }

  // Surface scratches: faint hairlines in loose bunches (things slide across
  // it the same way), dark or catching the light.
  for (let i = 0; i < 55; i++) {
    const cx = rnd() * s;
    const cy = rnd() * s;
    const angle = rnd() * Math.PI * 2;
    const count = 1 + Math.floor(rnd() * 5);
    for (let k = 0; k < count; k++) {
      const light = rnd() < 0.5;
      scratch({
        x: cx + (rnd() - 0.5) * 70,
        y: cy + (rnd() - 0.5) * 70,
        angle: angle + (rnd() - 0.5) * 0.4,
        len: 15 + rnd() ** 2 * 150,
        peak: light ? 0.22 + rnd() * 0.26 : 0.14 + rnd() * 0.2,
        width: 0.5 + rnd() * 0.5,
        layers: [[light ? "255, 255, 255" : "58, 60, 66", 1, 0]],
      });
    }
  }
  // Deeper scratches: a darker cut with a bright lip beside it where the metal
  // was pushed up, both fading in and out together.
  for (let i = 0; i < 16; i++) {
    scratch({
      x: rnd() * s,
      y: rnd() * s,
      angle: rnd() * Math.PI * 2,
      len: 35 + rnd() ** 1.5 * 180,
      peak: 0.5 + rnd() * 0.3,
      width: 1.1 + rnd() * 1.1,
      layers: [
        ["255, 255, 255", 0.7, 0.9],
        ["44, 46, 52", 1, 0],
      ],
    });
  }
  // Nicks.
  for (let i = 0; i < 40; i++) {
    c.fillStyle = `rgba(52, 54, 60, ${0.15 + rnd() * 0.25})`;
    c.fillRect(rnd() * s, rnd() * s, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}

// Bare worn silver, for the body.
function wornSilverTexture() {
  return canvasTexture(1024, (c, s) => {
    c.fillStyle = "#c6c9ce";
    c.fillRect(0, 0, s, s);
    drawWear(c, s, 4127);
  });
}

// Lid top: matt silver, worn, with the name and model printed on it,
// speaker-style dots and the lettering on the tab. The texture covers the
// player's full width; the bottom of the canvas is the front edge.
function lidTexture() {
  return canvasTexture(1024, (c, s) => {
    const px = (v) => (v / (2 * R)) * s; // world units → canvas px
    const at = (x, z) => [s / 2 + px(x), s / 2 + px(z)];
    const sheen = c.createLinearGradient(0, 0, s, s);
    sheen.addColorStop(0, "#d2d5d9");
    sheen.addColorStop(0.5, "#c3c6cb");
    sheen.addColorStop(1, "#aeb2b8");
    c.fillStyle = sheen;
    c.fillRect(0, 0, s, s);

    // The name and model, in the middle of the lid.
    c.fillStyle = "#2b2d33";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = `700 ${px(0.25)}px ${fonts.ui}`;
    c.fillText(NAME, ...at(0, -0.3));
    c.fillStyle = "#3d4047";
    c.font = `${px(0.1)}px ${fonts.ui}`;
    c.fillText("CC-2026", ...at(0, -0.07));
    c.font = `${px(0.075)}px ${fonts.ui}`;
    c.fillText("PORTABLE CD PLAYER", ...at(0, 0.08));
    c.font = `700 italic ${px(0.085)}px Helvetica, Arial, sans-serif`;
    c.fillText("S-MIX", ...at(0, 0.22));

    // On the tab.
    c.font = `${px(0.07)}px ${fonts.ui}`;
    c.fillText("ANTI-SKIP MEMORY II", ...at(0, 0.84));
    c.font = `700 ${px(0.05)}px Helvetica, Arial, sans-serif`;
    c.fillText("DIGITAL AUDIO", ...at(0, 0.7));

    // A little grid of dots near the right edge.
    c.fillStyle = "rgba(70, 72, 80, 0.55)";
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 4; j++) {
        c.beginPath();
        c.arc(...at(1.06 + i * 0.045 - j * 0.012, 0.16 + j * 0.05), px(0.011), 0, Math.PI * 2);
        c.fill();
      }
    }

    drawWear(c, s, 90210); // over the print too: it's scuffed like the rest
  });
}

// Icon printed on a button's top. (A cylinder's top face maps its texture a
// quarter-turn round, so it's drawn pre-rotated.)
function buttonTexture(icon, { lit = false } = {}) {
  return canvasTexture(256, (c, s) => {
    c.fillStyle = "#8b8f97";
    c.fillRect(0, 0, s, s);
    c.fillStyle = c.strokeStyle = lit ? "#e8792a" : "#33363d"; // shuffle glows orange while on
    const m = s / 2;
    c.translate(m, m);
    c.rotate(-Math.PI / 2);
    c.translate(-m, -m);
    const triangle = (x, dir, h = 30) => {
      c.beginPath();
      c.moveTo(x, m - h);
      c.lineTo(x + dir * h * 1.3, m);
      c.lineTo(x, m + h);
      c.fill();
    };
    if (icon === "toggle") {
      // ▶❚❚
      triangle(m - 56, 1);
      c.fillRect(m + 8, m - 30, 14, 60);
      c.fillRect(m + 36, m - 30, 14, 60);
    } else if (icon === "next") {
      // ▶▶|
      triangle(m - 58, 1);
      triangle(m - 16, 1);
      c.fillRect(m + 30, m - 30, 12, 60);
    } else if (icon === "previous") {
      // |◀◀
      c.fillRect(m - 42, m - 30, 12, 60);
      triangle(m + 16, -1);
      triangle(m + 58, -1);
    } else if (icon === "list") {
      for (const dy of [-34, 0, 34]) c.fillRect(m - 50, m + dy - 9, 100, 18);
    } else if (icon === "shuffle") {
      // Two crossing arrows: ⤨
      c.lineWidth = 13;
      c.lineCap = "round";
      for (const dir of [1, -1]) {
        c.beginPath();
        c.moveTo(m - 58, m - dir * 30);
        c.bezierCurveTo(m - 10, m - dir * 30, m + 4, m + dir * 30, m + 40, m + dir * 30);
        c.stroke();
        c.beginPath();
        c.moveTo(m + 62, m + dir * 30);
        c.lineTo(m + 34, m + dir * 30 - 20);
        c.lineTo(m + 34, m + dir * 30 + 20);
        c.fill();
      }
    }
  });
}

// The screen: grey-green LCD with dark segments. `lines` is [big, small,
// flag], the flag a little indicator in the top-right corner (e.g. SHUF).
const LCD_PX = [512, 146];
function drawLcd(c, [big, small, flag = ""]) {
  const [w, h] = LCD_PX;
  c.fillStyle = "#8d9484";
  c.fillRect(0, 0, w, h);
  const shade = c.createLinearGradient(0, 0, 0, h);
  shade.addColorStop(0, "rgba(0, 0, 0, 0.18)");
  shade.addColorStop(0.25, "rgba(0, 0, 0, 0)");
  c.fillStyle = shade;
  c.fillRect(0, 0, w, h);
  c.fillStyle = "rgba(28, 34, 26, 0.88)";
  c.textBaseline = "middle";
  c.textAlign = "left";
  c.font = `700 ${h * 0.5}px ${fonts.ui}`;
  c.fillText(big, 22, h * 0.4);
  c.font = `${h * 0.22}px ${fonts.ui}`;
  fitText(c, small, 24, h * 0.8, w - 48, h * 0.22, fonts.ui);
  if (flag) {
    c.textAlign = "right";
    c.font = `700 ${h * 0.2}px ${fonts.ui}`;
    c.fillText(flag, w - 22, h * 0.2);
  }
}

// Back cover of a CD case: the title and its songs, like a real CD's back
// insert. Seen on the card that's just been flipped past, which hangs upside
// down in front of the card file, so it's drawn turned round to read upright
// from there.
function backCoverTexture(playlist) {
  const tracks = music.tracksFor(playlist);
  return canvasTexture(1024, (c, s) => {
    c.translate(s, s);
    c.rotate(Math.PI); // the box's back face shows it turned round
    c.fillStyle = "#e9e4d8";
    c.fillRect(0, 0, s, s);
    c.fillStyle = playlist.color;
    c.fillRect(0, s - 210, s, 210);
    c.fillStyle = "#ffffff";
    c.textAlign = "left";
    c.textBaseline = "middle";
    fitText(c, playlist.title, 70, s - 105, s - 140, 120, fonts.letter);
    c.fillStyle = "#2b2d33";
    c.textBaseline = "top";
    tracks.slice(0, 12).forEach((t, i) => {
      fitText(c, `${String(i + 1).padStart(2, "0")}  ${t.title}`, 70, 70 + i * 54, s - 140, 34, fonts.ui);
    });
    if (tracks.length > 12) fitText(c, `+ ${tracks.length - 12} more`, 70, 70 + 12 * 54, s - 140, 34, fonts.ui);
  });
}

// A case's index tab: its colour, with the title in white.
function tabTexture(playlist) {
  return canvasTexture(256, (c, w, h) => {
    c.fillStyle = playlist.color;
    c.fillRect(0, 0, w, h);
    c.fillStyle = "#ffffff";
    c.textAlign = "center";
    c.textBaseline = "middle";
    fitText(c, playlist.title, w / 2, h / 2 + 2, w - 24, h * 0.62, fonts.letter);
  }, { height: 98 });
}

// A plain index card: cream, ruled in pale blue under a red heading line.
function indexCardTexture() {
  return canvasTexture(256, (c, s) => {
    c.fillStyle = "#f1ead9";
    c.fillRect(0, 0, s, s);
    c.fillStyle = "rgba(200, 70, 60, 0.55)";
    c.fillRect(0, s * 0.2, s, 2);
    c.fillStyle = "rgba(90, 130, 190, 0.35)";
    for (let y = s * 0.32; y < s * 0.96; y += s * 0.1) c.fillRect(0, y, s, 1.5);
  });
}

// Printed side of a CD.
function labelTexture(playlist) {
  return canvasTexture(1024, (c, s) => {
    const mid = s / 2;
    c.fillStyle = playlist.color;
    c.beginPath();
    c.arc(mid, mid, mid, 0, Math.PI * 2);
    c.fill();
    // Clear plastic hub around the hole.
    c.fillStyle = "rgba(225, 228, 232, 0.9)";
    c.beginPath();
    c.arc(mid, mid, mid * 0.24, 0, Math.PI * 2);
    c.fill();

    c.fillStyle = "#ffffff";
    c.textAlign = "center";
    c.textBaseline = "middle";
    fitText(c, playlist.title, mid, mid * 0.52, s * 0.62, 110, fonts.letter);
    c.globalAlpha = 0.85;
    fitText(c, playlist.subtitle ?? "", mid, mid * 0.72, s * 0.55, 36, fonts.ui);
    fitText(c, `${NAME} · MIX`, mid, mid * 1.55, s * 0.4, 34, fonts.ui);
  });
}

// Front cover of a CD case.
function coverTexture(playlist) {
  const tracks = music.tracksFor(playlist);
  const length = tracks.reduce((total, t) => total + t.duration, 0);
  return canvasTexture(1024, (c, s) => {
    c.fillStyle = playlist.color;
    c.fillRect(0, 0, s, s);
    // A big faint disc as artwork.
    c.strokeStyle = "rgba(255,255,255,0.18)";
    c.lineWidth = 3;
    for (let r = 120; r < 520; r += 26) {
      c.beginPath();
      c.arc(s * 0.72, s * 0.62, r, 0, Math.PI * 2);
      c.stroke();
    }
    c.fillStyle = "#ffffff";
    c.textAlign = "left";
    c.textBaseline = "top";
    fitText(c, playlist.title, 70, 90, s - 140, 150, fonts.letter);
    c.globalAlpha = 0.85;
    fitText(c, playlist.subtitle ?? "", 74, 270, s - 150, 44, fonts.ui);
    c.textBaseline = "bottom";
    // Total running time in the bottom corner (left blank if the track list
    // couldn't be fetched).
    if (length) fitText(c, formatLength(length), 74, s - 70, s * 0.6, 58, fonts.ui);
  });
}

// ---------- Toy ----------

export function createCdPlayer({ scene, renderer }) {
  const root = new THREE.Group();
  scene.add(root);

  const disposables = [];
  const track = (thing) => (disposables.push(thing), thing);

  // Something for the silver and the disc's underside to reflect.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = track(pmrem.fromScene(new RoomEnvironment(), 0.04).texture);
  pmrem.dispose();

  // Toned down: the studio reflection plus the scene lights wash bright silver out to white.
  const silver = track(
    new THREE.MeshStandardMaterial({ color: 0x8e9299, metalness: 0.5, roughness: 0.4, envMap, envMapIntensity: 0.3 })
  );
  const darkPlastic = track(new THREE.MeshStandardMaterial({ color: 0x24252b, roughness: 0.5 }));
  const greyPlastic = track(new THREE.MeshStandardMaterial({ color: 0x4a4d54, roughness: 0.55 }));

  // ----- Player -----
  const player = new THREE.Group();
  player.position.x = PLAYER_X;
  player.rotation.x = TILT; // top face leans toward the camera
  root.add(player);

  /** The squircle outline (half-width r) as a shape; shape y runs toward the back. */
  function outline(r, front = () => Infinity) {
    const N = 120;
    const points = [];
    // Round the back, left to right, then the front edge back again.
    for (let i = 0; i <= N; i++) {
      const x = -r * Math.cos((i / N) * Math.PI);
      points.push(new THREE.Vector2(x, outlineZ(x, r)));
    }
    for (let i = 0; i <= N; i++) {
      const x = r * Math.cos((i / N) * Math.PI);
      points.push(new THREE.Vector2(x, -Math.min(outlineZ(x, r), front(x))));
    }
    return new THREE.Shape(points);
  }
  /** A slab with that outline, `h` thick, standing on y = 0, its top edge rounded over by `bevel`. */
  function slab(shape, h, bevel) {
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: h - bevel,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel * 1.6,
      bevelOffset: -bevel * 1.6,
      bevelSegments: 6,
      curveSegments: 1,
    });
    // (The matching bevel underneath sinks into whatever it stands on.)
    geo.rotateX(-Math.PI / 2);
    // Lay the texture across the full width, whatever the shape.
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const normal = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      // The underside stays plain (one blank corner of the texture), so the
      // lid's print doesn't show through, mirrored, when it's open.
      if (normal.getY(i) < -0.5) uv.setXY(i, 0.02, 0.98);
      else uv.setXY(i, pos.getX(i) / (2 * R) + 0.5, -pos.getZ(i) / (2 * R) + 0.5);
    }
    return track(geo);
  }

  // Body: a dark lower shell with the silver top shell on it.
  const SHELL = 0.1;
  const lower = new THREE.Mesh(slab(outline(R * 0.985), SHELL, 0), greyPlastic);
  lower.position.y = -BODY_H / 2;
  const bodyMat = track(
    new THREE.MeshStandardMaterial({ map: track(wornSilverTexture()), color: 0xb9bcc2, metalness: 0.5, roughness: 0.4, envMap, envMapIntensity: 0.3 })
  );
  const body = new THREE.Mesh(slab(outline(R), BODY_H - SHELL, 0.05), bodyMat);
  body.position.y = -BODY_H / 2 + SHELL;
  player.add(lower, body);
  const TOP = BODY_H / 2; // the deck

  const well = new THREE.Mesh(track(new THREE.CircleGeometry(DISC_R + 0.02, 96)), darkPlastic);
  well.rotation.x = -Math.PI / 2;
  well.position.y = TOP + 0.002;
  player.add(well);

  const spindle = new THREE.Mesh(track(new THREE.CylinderGeometry(0.085, 0.085, 0.06, 24)), silver);
  spindle.position.y = TOP + 0.03;
  player.add(spindle);

  const tray = new THREE.Object3D(); // where a loaded disc sits
  tray.position.y = TOP + 0.035;
  player.add(tray);

  // Lid, hinged along the back edge: domed at the rim, printed on top.
  const lid = new THREE.Group();
  lid.position.set(0, TOP, -R);
  player.add(lid);

  const lidMat = track(new THREE.MeshStandardMaterial({ map: track(lidTexture()), color: 0xa6a9ae, metalness: 0.35, roughness: 0.45, envMap, envMapIntensity: 0.25 }));
  const lidTop = new THREE.Mesh(slab(outline(LID_R, lidFrontZ), LID_H, 0.07), lidMat);
  lidTop.position.set(0, 0, R);
  lidTop.userData.action = "lid"; // clicking the lid opens and shuts it
  lid.add(lidTop);

  // ----- Controls on the front deck -----
  // Each button sits in a dark socket. Ovals: previous / next on the left,
  // stop / play-pause on the right. A small round one opens the song list.
  const ovalGeo = track(new THREE.CylinderGeometry(0.115, 0.125, 0.07, 40));
  const roundGeo = track(new THREE.CylinderGeometry(0.06, 0.065, 0.06, 28));
  const buttonSide = track(new THREE.MeshStandardMaterial({ color: 0x8b8f97, roughness: 0.5 }));
  const buttons = [
    ["previous", -0.93, 0.97, ovalGeo, 0.5],
    ["next", -0.63, 1.11, ovalGeo, 0.3],
    ["shuffle", 0.63, 1.11, ovalGeo, -0.3],
    ["toggle", 0.93, 0.97, ovalGeo, -0.5],
    ["list", 1.15, 0.72, roundGeo, 0],
  ].map(([action, x, z, geo, turn]) => {
    const oval = geo === ovalGeo;
    const top = track(new THREE.MeshStandardMaterial({ map: track(buttonTexture(action)), roughness: 0.45 }));
    const button = new THREE.Mesh(geo, [buttonSide, top, buttonSide]);
    button.position.set(x, TOP + 0.02, z);
    button.rotation.y = turn; // following the front edge round
    if (oval) button.scale.z = 1.5;
    button.userData.action = action;
    button.userData.restY = button.position.y;
    button.userData.top = top; // brightened on hover
    if (action === "shuffle") {
      button.userData.icons = { off: top.map, on: track(buttonTexture("shuffle", { lit: true })) };
    }
    const socket = new THREE.Mesh(geo, darkPlastic);
    socket.position.set(x, TOP - 0.028, z);
    socket.rotation.y = turn;
    socket.scale.set(1.16, 1, oval ? 1.5 * 1.12 : 1.16);
    player.add(socket, button);
    return button;
  });


  // The screen, in a dark bezel under the lid's tab.
  const bezel = new THREE.Mesh(track(new RoundedBoxGeometry(LCD.w + 0.1, 0.05, LCD.d + 0.09, 2, 0.02)), darkPlastic);
  bezel.position.set(0, TOP, LCD.z);
  const lcdCanvas = document.createElement("canvas");
  [lcdCanvas.width, lcdCanvas.height] = LCD_PX;
  const lcdTex = track(new THREE.CanvasTexture(lcdCanvas));
  lcdTex.colorSpace = THREE.SRGBColorSpace;
  lcdTex.anisotropy = 8;
  const screen = new THREE.Mesh(track(new THREE.PlaneGeometry(LCD.w, LCD.d)), track(new THREE.MeshStandardMaterial({ map: lcdTex, roughness: 0.25 })));
  screen.rotation.x = -Math.PI / 2;
  screen.position.set(0, TOP + 0.027, LCD.z);
  player.add(bezel, screen);

  // What the screen says: track number and time, and the song underneath.
  let lcdText = "";
  function updateLcd() {
    const { playlist, track: song, index, isPaused, position, positionAt, duration } = music.state;
    let lines = ["NO DISC", ""];
    if (playlist) {
      const ms = Math.min(position + (isPaused ? 0 : performance.now() - positionAt), duration || Infinity);
      const secs = Math.floor(ms / 1000);
      const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
      lines = [`${String(index + 1).padStart(2, "0")}  ${time}${isPaused ? " ||" : ""}`, (song?.title ?? playlist.title).toUpperCase()];
    } else if (loaded) lines = ["--  0:00", loaded.title.toUpperCase()];
    lines[2] = music.state.shuffle ? "SHUF" : "";
    const text = lines.join("\n");
    if (text === lcdText) return false;
    lcdText = text;
    drawLcd(lcdCanvas.getContext("2d"), lines);
    lcdTex.needsUpdate = true;
    return true;
  }

  // ----- Disc -----
  const discGeo = track(new THREE.RingGeometry(HOLE_R, DISC_R, 96));
  const labelMat = track(new THREE.MeshStandardMaterial({ roughness: 0.45 }));
  const shinyMat = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xe8e8ec,
      metalness: 0.9,
      roughness: 0.12,
      iridescence: 1,
      iridescenceIOR: 1.6,
      iridescenceThicknessRange: [180, 700],
      envMap,
    })
  );
  const disc = new THREE.Group();
  const discTop = new THREE.Mesh(discGeo, labelMat);
  discTop.rotation.x = -Math.PI / 2;
  const discBottom = new THREE.Mesh(discGeo, shinyMat);
  discBottom.rotation.x = Math.PI / 2;
  disc.add(discTop, discBottom);
  discTop.userData.action = discBottom.userData.action = "disc"; // with the lid open, pauses / plays
  disc.visible = false;
  tray.add(disc);

  const labels = new Map(); // playlist → texture, made on first use
  function setDiscLabel(playlist) {
    if (!labels.has(playlist)) labels.set(playlist, track(labelTexture(playlist)));
    labelMat.map = labels.get(playlist);
    labelMat.needsUpdate = true;
  }

  // ----- Card file (rolodex) -----
  const N = PLAYLISTS.length;
  const STEP = FILLERS + 1; // slots per CD case
  const SLOTS = N * STEP;
  const spread = (360 - (LEAN_FRONT - LEAN_BACK)) / (SLOTS - 2); // degrees between the rest
  const deg = THREE.MathUtils.degToRad;

  const file = new THREE.Group();
  file.position.x = FILE_X;
  file.rotation.y = -0.18; // turned a little toward the player
  root.add(file);

  // The stand, in the same worn silver and hardware as the drawing board's
  // easel (silver.js): a base with fluted studs, two arms up to the axle with
  // beaded collars, a hub the cards clip on and a crown finial capping each end
  // of the axle.
  let hardwareRedrawn = false; // the finials' engraving redraws once its font arrives
  const hardware = createSilver({ envMap, track, onRedraw: () => (hardwareRedrawn = true) });
  const ARM_X = CASE_SIZE / 2 + 0.1;
  const BASE = { w: ARM_X * 2 + 0.34, h: 0.14, d: 1.5 };
  const standParts = [];
  const standPart = (object) => {
    // Every mesh in it is part of the card file (dragging it turns the wheel).
    object.traverse((o) => {
      if (o.isMesh) {
        o.userData.action = "file";
        o.castShadow = true;
      }
    });
    standParts.push(object);
    file.add(object);
    return object;
  };
  standPart(hardware.box(BASE.w, BASE.h, BASE.d)).position.y = BASE.h / 2;
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const stud = standPart(hardware.stud());
    stud.scale.setScalar(1.2);
    stud.position.set(x * (BASE.w / 2 - 0.13), BASE.h, z * (BASE.d / 2 - 0.13));
  }
  for (const side of [-1, 1]) {
    const armH = AXLE_Y - BASE.h + 0.08;
    const arm = standPart(hardware.box(0.08, armH, 0.3));
    arm.position.set(side * ARM_X, BASE.h + armH / 2, 0);
    // Stepped collar where the arm meets the base, beaded rings at the axle.
    const foot = standPart(hardware.box(0.16, 0.05, 0.38));
    foot.position.set(side * ARM_X, BASE.h + 0.025, 0);
    for (const r of [0.1, 0.13]) {
      const ring = standPart(hardware.bead(r, 0.014));
      ring.rotation.set(0, 0, Math.PI / 2); // round the axle
      ring.position.set(side * (ARM_X + (r === 0.1 ? 0.055 : 0.075)), AXLE_Y, 0);
    }
    // Crown finial on the end of the axle, pointing outward.
    const crown = standPart(hardware.finial(0.75));
    crown.rotation.z = (-side * Math.PI) / 2;
    crown.position.set(side * (ARM_X + 0.08), AXLE_Y, 0);
  }
  const hub = standPart(hardware.rod(HUB_R, ARM_X * 2 - 0.08, 40));
  hub.rotation.z = Math.PI / 2;
  hub.position.y = AXLE_Y;
  hardware.bake(file); // tarnish flows across the stand as one piece of metal

  // The cards. Each sits on a pivot round the axle.
  const caseGeo = track(new RoundedBoxGeometry(CASE_SIZE, CASE_SIZE, CASE_DEPTH, 2, 0.02));
  const tabGeo = track(new RoundedBoxGeometry(TAB.w, TAB.h, CASE_DEPTH * 0.5, 2, 0.04));
  const cardGeo = track(new THREE.BoxGeometry(CASE_SIZE - 0.08, CASE_SIZE - 0.16, 0.014));
  const cardFace = track(new THREE.MeshStandardMaterial({ map: track(indexCardTexture()), roughness: 0.85 }));
  const cardBack = track(new THREE.MeshStandardMaterial({ color: 0xeee7d6, roughness: 0.85 }));
  const pivots = [];
  const cases = [];
  for (let slot = 0; slot < SLOTS; slot++) {
    const pivot = new THREE.Group();
    pivot.position.y = AXLE_Y;
    file.add(pivot);
    let card;
    if (slot % STEP === 0) {
      const playlist = PLAYLISTS[slot / STEP];
      const cover = track(new THREE.MeshStandardMaterial({ map: track(coverTexture(playlist)), roughness: 0.25 }));
      // Face order: +x, -x, +y, -y, +z (front), -z.
      const back = track(new THREE.MeshStandardMaterial({ map: track(backCoverTexture(playlist)), roughness: 0.3 }));
      card = new THREE.Mesh(caseGeo, [darkPlastic, darkPlastic, darkPlastic, darkPlastic, cover, back]);
      card.position.y = HUB_R + CASE_SIZE / 2;
      card.userData = { action: "case", playlist, index: slot / STEP };
      cases.push(card);
      // Its index tab, sticking up from the top edge.
      const tabMat = track(new THREE.MeshStandardMaterial({ map: track(tabTexture(playlist)), roughness: 0.35 }));
      // (three.js colours take #rrggbb, so any alpha on the playlist's colour is dropped.)
      const tabSide = track(new THREE.MeshStandardMaterial({ color: playlist.color.slice(0, 7), roughness: 0.35 }));
      const tab = new THREE.Mesh(tabGeo, [tabSide, tabSide, tabSide, tabSide, tabMat, tabSide]);
      tab.position.set(TAB.stagger[(slot / STEP) % TAB.stagger.length], HUB_R + CASE_SIZE + TAB.h / 2 - 0.03, 0);
      tab.userData = card.userData; // clicking it counts as clicking the case
      pivot.add(tab);
    } else {
      card = new THREE.Mesh(cardGeo, [cardBack, cardBack, cardBack, cardBack, cardFace, cardBack]);
      card.position.y = HUB_R + (CASE_SIZE - 0.16) / 2;
      card.rotation.z = (Math.sin(slot * 12.9898) * 0.5) * 0.03; // not quite straight
      card.userData.action = "file";
    }
    pivot.add(card);
    pivots.push(pivot);
  }

  // Which way each card leans, for the wheel turned to `pos` (in slots; whole
  // multiples of STEP put a CD case at the front).
  const view = { pos: 0 };
  function leanFor(d) {
    if (d >= 1) return LEAN_BACK - (d - 1) * spread;
    if (d >= 0) return LEAN_UP + (LEAN_BACK - LEAN_UP) * d;
    if (d >= -1) return LEAN_UP + (LEAN_FRONT - LEAN_UP) * -d;
    return LEAN_FRONT + (-d - 1) * spread;
  }
  let shownPos = NaN;
  function layoutFile() {
    if (view.pos === shownPos) return false;
    shownPos = view.pos;
    pivots.forEach((pivot, slot) => {
      // How far this card is from the front, wrapped round to -SLOTS/2..SLOTS/2.
      let d = (slot - view.pos) % SLOTS;
      if (d < -SLOTS / 2) d += SLOTS;
      if (d >= SLOTS / 2) d -= SLOTS;
      pivot.rotation.x = deg(leanFor(d));
    });
    return true;
  }

  /** The playlist at the front (by index). */
  const frontIndex = () => (((Math.round(target / STEP) % N) + N) % N);
  let target = 0; // where the wheel is heading, in slots

  /** Turn the wheel to `slots`, flipping cards over on the way. */
  function turnTo(slots, { instant = false, duration = 0.5 } = {}) {
    target = slots;
    gsap.killTweensOf(view);
    if (instant || reduceMotion()) view.pos = target;
    else gsap.to(view, { pos: target, duration, ease: "back.out(1.1)" });
  }

  /** Bring a playlist's case to the front, the shortest way round. */
  function showPlaylist(playlist, options) {
    const index = PLAYLISTS.indexOf(playlist);
    if (index < 0) return;
    let steps = (index - frontIndex()) % N;
    if (steps > N / 2) steps -= N;
    if (steps < -N / 2) steps += N;
    turnTo(Math.round(target / STEP) * STEP + steps * STEP, options);
  }

  // Mouse wheel / trackpad: one case per notch's worth of scrolling.
  let wheelAcc = 0;
  function onWheel(deltaY) {
    wheelAcc += deltaY;
    if (Math.abs(wheelAcc) < 40) return;
    const dir = Math.sign(wheelAcc);
    wheelAcc = 0;
    turnTo(Math.round(target / STEP) * STEP + dir * STEP, { duration: 0.45 });
  }

  // Drag up or down on the file to spin it; let go and it settles on a case.
  // A press that hardly moves is a click: on the front case it loads that
  // disc, on another case it turns that one to the front.
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const dragPoint = new THREE.Vector3();
  function dragFile(hit) {
    gsap.killTweensOf(view);
    dragPlane.constant = -hit.point.z;
    const startY = hit.point.y;
    const startPos = view.pos;
    let moved = 0;
    return {
      move(ray) {
        if (!ray.intersectPlane(dragPlane, dragPoint)) return;
        const dy = dragPoint.y - startY;
        moved = Math.max(moved, Math.abs(dy));
        // Pulling down flips the front card toward you, on to the next one.
        view.pos = startPos - (dy / DRAG_PER_CASE) * STEP;
      },
      release() {
        if (moved < 0.05) {
          view.pos = startPos;
          const { action, playlist } = hit.object.userData;
          if (action === "case") {
            if (playlist === PLAYLISTS[frontIndex()]) loadDisc(cases[hit.object.userData.index]);
            else showPlaylist(playlist);
          }
          return;
        }
        turnTo(Math.round(view.pos / STEP) * STEP, { duration: 0.4 });
      },
    };
  }

  layoutFile();

  root.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });

  // Stand the player on its lower edge.
  player.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(player);
  player.position.y -= bounds.min.y;

  // ----- Loading a disc -----
  let loaded = null; // playlist whose disc is in the player
  let lidOpen = false; // opened by clicking the lid
  let busy = false;
  let timeline = null;

  function placeInstantly(playlist) {
    loaded = playlist;
    setDiscLabel(playlist);
    tray.attach(disc);
    disc.position.set(0, 0, 0);
    disc.quaternion.identity();
    disc.scale.setScalar(1);
    disc.visible = true;
    lid.rotation.x = 0;
    lidOpen = false;
    showPlaylist(playlist, { instant: true });
  }

  function loadDisc(caseMesh) {
    const playlist = caseMesh.userData.playlist;
    if (busy) return;
    if (playlist === loaded) {
      music.play(playlist); // resume if it was stopped
      return;
    }
    if (reduceMotion()) {
      placeInstantly(playlist);
      music.play(playlist);
      return;
    }

    busy = true;
    lidOpen = false;
    const from = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    const to = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    const flight = { t: 0 };

    const tl = (timeline = gsap.timeline({ onComplete: () => (busy = false) }));
    tl.to(lid.rotation, { x: -LID_OPEN, duration: 0.4, ease: "power2.out" });
    if (loaded) tl.to(disc.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.2, ease: "power2.in" });
    tl.call(() => {
      loaded = playlist;
      setDiscLabel(playlist);
      // Disc starts at the case, facing out like the cover.
      // (The case is on the card file, so work in world space.)
      caseMesh.updateWorldMatrix(true, false);
      caseMesh.getWorldPosition(from.pos);
      const facing = caseMesh.getWorldQuaternion(new THREE.Quaternion());
      from.pos.add(new THREE.Vector3(0, 0, CASE_DEPTH).applyQuaternion(facing));
      from.quat.copy(facing).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)));
      tray.getWorldPosition(to.pos);
      tray.getWorldQuaternion(to.quat);
      root.attach(disc);
      disc.position.copy(from.pos);
      disc.quaternion.copy(from.quat);
      disc.scale.setScalar(1);
      disc.visible = true;
      flight.t = 0;
    });
    // Arc over to the player, turning to lie in the tray.
    tl.to(flight, {
      t: 1,
      duration: 0.75,
      ease: "power2.inOut",
      onUpdate: () => {
        disc.position.lerpVectors(from.pos, to.pos, flight.t);
        disc.position.y += Math.sin(Math.PI * flight.t) * 1.1;
        disc.quaternion.slerpQuaternions(from.quat, to.quat, flight.t);
      },
    });
    tl.call(() => {
      tray.attach(disc);
      disc.position.set(0, 0, 0);
      disc.quaternion.identity();
    });
    tl.to(lid.rotation, { x: 0, duration: 0.45, ease: "bounce.out" });

    // Start the music now rather than when the disc lands: it takes a moment to
    // buffer, and browsers only allow sound straight after a click. (After
    // busy is set, so our own listener doesn't snap the disc into place.)
    music.play(playlist);
  }

  // Buttons rise a touch and brighten under the pointer, sink when pressed,
  // and spring back up when let go. Shuffle stays a little sunk while it's on,
  // like a latching switch.
  const HOVER_LIFT = 0.012;
  const PRESS_DEPTH = 0.028;
  const LATCH_DEPTH = 0.012;
  let hovered = null;
  let pressed = null;
  const restingY = (button) =>
    button.userData.restY +
    (button === hovered ? HOVER_LIFT : 0) -
    (button.userData.action === "shuffle" && music.state.shuffle ? LATCH_DEPTH : 0);
  let buttonsChanged = false; // so a change shows even without a tween (Reduce motion)
  function settleButton(button, ease = "power2.out", duration = 0.18) {
    buttonsChanged = true;
    const y = restingY(button);
    if (reduceMotion()) button.position.y = y;
    else gsap.to(button.position, { y, duration, ease, overwrite: true });
    button.userData.top?.emissive.setScalar(button === hovered ? 0.08 : 0);
  }
  function hoverButton(button) {
    if (button === hovered) return;
    const was = hovered;
    hovered = button;
    for (const b of [was, button]) if (b && b !== pressed) settleButton(b);
  }
  /** Press `button` down; the returned handle springs it back up on release. */
  function press(button) {
    pressed = button;
    if (reduceMotion()) button.position.y = button.userData.restY - PRESS_DEPTH;
    else gsap.to(button.position, { y: button.userData.restY - PRESS_DEPTH, duration: 0.07, ease: "power2.in", overwrite: true });
    return {
      move() {},
      release() {
        pressed = null;
        settleButton(button, "back.out(3)", 0.3);
      },
    };
  }
  // Shuffle's icon lights up (and its button latches) whenever shuffle is on,
  // whether it was switched here or on the Now playing panel.
  const shuffleBtn = buttons.find((b) => b.userData.action === "shuffle");
  let shownShuffle = null;
  function syncShuffle() {
    if (shownShuffle === music.state.shuffle) return;
    shownShuffle = music.state.shuffle;
    const top = shuffleBtn.userData.top;
    top.map = shownShuffle ? shuffleBtn.userData.icons.on : shuffleBtn.userData.icons.off;
    top.needsUpdate = true;
    if (shuffleBtn !== pressed) settleButton(shuffleBtn);
  }
  syncShuffle();

  // Clicking the lid lifts it to show the disc (spinning, if it's playing); again shuts it.
  function toggleLid() {
    if (busy) return;
    lidOpen = !lidOpen;
    const x = lidOpen ? -LID_OPEN : 0;
    if (reduceMotion()) lid.rotation.x = x;
    else gsap.to(lid.rotation, { x, duration: lidOpen ? 0.45 : 0.5, ease: lidOpen ? "back.out(1.6)" : "bounce.out", overwrite: true });
  }

  // If music is already playing (e.g. switching back to this toy), show its disc.
  if (music.state.playlist) placeInstantly(music.state.playlist);

  // A disc chosen elsewhere (the song list, the widget) shows up in the player.
  const unsubscribe = music.subscribe((state) => {
    syncShuffle();
    if (state.playlist && state.playlist !== loaded && !busy) placeInstantly(state.playlist);
  });

  let spin = 0; // current disc speed, eased toward the target
  // Everything that tweens (lid, disc, buttons).
  const animated = [lid.rotation, disc.scale, ...buttons.map((b) => b.position)];

  return {
    cursor: "pointer",
    pickables: [...file.children.flatMap((o) => (o.isMesh ? [o] : o.children)), lidTop, discTop, ...buttons, body, lower],

    // The front case is clicked; the rest of the card file is dragged; the
    // player's body isn't a button.
    cursorFor(hit) {
      const { action, playlist } = hit.object.userData;
      if (!action || action === "player") return "default";
      if (action === "disc" && !(lidOpen && !busy)) return "default";
      if (action === "file" || (action === "case" && playlist !== PLAYLISTS[frontIndex()])) return "grab";
      return "pointer";
    },

    // Scrolling over the card file flips through it.
    wheel(hit, e) {
      const action = hit?.object.userData.action;
      if (action !== "case" && action !== "file") return false;
      onWheel(e.deltaY * (e.deltaMode === 1 ? 16 : 1));
      return true;
    },

    grab(hit) {
      const { action } = hit.object.userData;
      if (action === "case" || action === "file") return dragFile(hit);
      const idle = { move() {}, release() {} };
      if (action === "lid") {
        toggleLid();
        return idle;
      }
      if (action === "disc") {
        // The spinning disc, seen with the lid open: pause or carry on.
        if (lidOpen && !busy && loaded) {
          if (music.state.playlist) music.toggle();
          else music.play(loaded);
        }
        return idle;
      }
      if (hit.object.userData.restY === undefined) return idle; // the body
      const handle = press(hit.object);
      if (action === "list") openTrackList(loaded ?? PLAYLISTS[frontIndex()]);
      else if (action === "shuffle") music.toggleShuffle();
      else if (action === "next" || action === "previous") {
        if (music.state.playlist) music[action]();
      } else if (action === "toggle") {
        if (music.state.playlist) music.toggle();
        else if (loaded) music.play(loaded);
        else loadDisc(cases[frontIndex()]);
      }
      return handle;
    },

    // Lift the button under the pointer.
    hover(hit) {
      const object = hit?.object;
      hoverButton(object?.userData.restY !== undefined ? object : null);
    },

    // Something to redraw while the disc spins or anything is animating.
    update(dt) {
      const playing = !!music.state.playlist && !music.state.isPaused && disc.parent === tray;
      spin += ((playing ? SPIN_SPEED : 0) - spin) * Math.min(1, dt * 3);
      disc.rotation.y += spin * dt;
      const screenChanged = updateLcd();
      const fileMoved = layoutFile() || hardwareRedrawn || buttonsChanged;
      hardwareRedrawn = buttonsChanged = false;
      // While playing, keep drawing so the screen's clock ticks (the disc may
      // be out of sight under the lid, but it is spinning).
      return screenChanged || fileMoved || spin > 0.001 || busy || animated.some((target) => gsap.isTweening(target));
    },

    dispose() {
      unsubscribe();
      timeline?.kill();
      gsap.killTweensOf([lid.rotation, disc.scale, view, ...buttons.map((b) => b.position)]);
      scene.remove(root);
      for (const thing of disposables) thing.dispose();
    },
  };
}
