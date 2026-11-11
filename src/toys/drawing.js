import * as THREE from "three";
import { gsap } from "gsap";
import { canvasTexture, makeCanvas, noisyFill, studioEnvMap } from "./textures.js";
import { LN, grey, hexToRGB, pigment, rgbCss, toned } from "./colour.js";
import { NAME_FONT, paintedName } from "./drawing-name.js";
import { createColourPicker } from "./colour-picker.js";
import { createSilver } from "./silver.js";
import { onResize } from "../scene/stage.js";
import { reduceMotion } from "../settings.js";
import { popIn } from "../ui/popover.js";
import { asciiFrame, asciiRange } from "../ui/ascii.js";
import { shakeOnHover } from "../ui/shake.js";
import { fonts } from "../lib/fonts.js";
import * as storage from "../lib/storage.js";
import { createTracker } from "./shared.js";
import { onToyKeys } from "../scene/keys.js";

// A worn silver swivel easel: a board on side pins with a chalkboard on one face and
// a painting canvas on the other. Switching modes spins the board over. Draw by
// dragging on it; the toolbar along the top picks colours, sizes and tools, and
// the chalk, eraser and brushes on the tray can be clicked too.

// ---------- Sizes (world units, before the easel is scaled to fit) ----------

const SURF_W = 6;
const SURF_H = 3.75; // 16:10, same as the ink canvas
const FRAME = 0.18;
const BOARD_T = 0.12;
const BOARD_W = SURF_W + FRAME * 2;
const BOARD_H = SURF_H + FRAME * 2;
const TRAY_Y = 0.22;
const TRAY_Z = 0.62; // in front of the board, so nothing on it is hidden
// High enough that the board clears the tray (and a lifted item) as it spins.
const PIVOT_Y = TRAY_Y + 0.34 + BOARD_H / 2;
const POST = 0.16;
const POST_X = BOARD_W / 2 + 0.1 + POST / 2;
const POST_H = PIVOT_Y + 0.22;
const TILT = 0.12; // radians the board leans back, to face the camera
const FINIAL = 0.4; // how far the hinge finials stick out past the posts
const EASEL_W = POST_X * 2 + POST + FINIAL * 2;
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
// The flat brush's own settings (sliders under "flat brush" in the paint
// settings): key, label, default, min, max, unit. The angle is measured like a
// protractor (counterclockwise from horizontal); length is % of the brush size.
const FLAT_SETTINGS = [
  ["flatAngle", "Angle", 40, 0, 180, "°"],
  ["flatLength", "Length", 100, 50, 250, "%"],
];
/** The flat brush's edge angle in ink space (y down), in radians. */
const flatAngle = (paint) => (-paint.flatAngle * Math.PI) / 180;
/** The flat brush's edge length, as a multiple of the brush size. */
const flatLength = (paint) => paint.flatLength / 100;

function loadPaintSettings() {
  const settings = Object.fromEntries(PAINT_SETTINGS.map(([key, , value]) => [key, value]));
  for (const [key, , value] of FLAT_SETTINGS) settings[key] = value;
  settings.brush = "round";
  const saved = storage.load(SETTINGS_KEY, {});
  for (const key in settings) if (typeof saved[key] === typeof settings[key]) settings[key] = saved[key];
  if (!BRUSHES.some(([id]) => id === settings.brush)) settings.brush = "round";
  for (const [key, , value, min, max] of FLAT_SETTINGS) {
    if (!(settings[key] >= min && settings[key] <= max)) settings[key] = value;
  }
  return settings;
}

const rand = Math.random;

// ---------- Textures ----------

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


// ---------- Toolbar ----------

// Toolbar, drawn in text (styles in drawing.css and ascii.css):
//   ( ) Chalkboard (*) Canvas   [#] # # # +   [Round] Flat   . [o] O
//   [erase] [undo] [save] [clear all] [opts]
function toolbarHTML() {
  // (`key`: its keyboard shortcut, shown in the tooltip.)
  const pick = (name, value, label, text, key) =>
    `<label class="draw-pick" title="${label} (${key})"><input type="radio" name="${name}" value="${value}" aria-label="${label}" aria-keyshortcuts="${key}"><span>${text}</span></label>`;
  return `
    <div class="segmented draw-mode">
      <label title="Chalkboard (C)"><input type="radio" name="draw-mode" value="chalk" aria-keyshortcuts="C"><span>Chalkboard</span></label>
      <label title="Canvas (P)"><input type="radio" name="draw-mode" value="paint" aria-keyshortcuts="P"><span>Canvas</span></label>
    </div>
    <div class="draw-group draw-swatches" role="radiogroup" aria-label="Colour"></div>
    <div class="draw-group draw-brushes" role="radiogroup" aria-label="Brush">
      ${BRUSHES.map(([id, label]) => pick("draw-brush", id, label, id[0].toUpperCase() + id.slice(1), id[0].toUpperCase())).join("")}
    </div>
    <div class="draw-group" role="radiogroup" aria-label="Size">
      ${SIZE_NAMES.map((label, i) => pick("draw-size", i, label, ".oO"[i], i + 1)).join("")}
    </div>
    <div class="draw-group draw-actions">
      <button class="draw-btn ascii-btn" type="button" data-action="erase" aria-pressed="false" aria-keyshortcuts="E" title="Eraser (E)">Erase</button>
      <button class="draw-btn ascii-btn" type="button" data-action="undo" aria-keyshortcuts="Control+Z Meta+Z" title="Undo (Ctrl/⌘ Z)">Undo</button>
      <button class="draw-btn ascii-btn" type="button" data-action="save" aria-label="Download as an image" title="Download">Save</button>
      <button class="draw-btn ascii-btn" type="button" data-action="clear" title="Wipe the chalkboard and the canvas">Clear</button>
      <button class="draw-btn ascii-btn" type="button" data-action="settings" aria-expanded="false" aria-controls="draw-settings" aria-label="Paint settings" title="Paint settings">Options</button>
    </div>
    <div class="draw-settings card" id="draw-settings" role="group" aria-label="Paint settings" data-ascii-title="paint" hidden>
      ${PAINT_SETTINGS.map(
        ([key, label]) => `<label class="draw-slider">
          <span>${label}<output data-for="${key}"></output></span>
          <input type="range" name="paint-${key}" data-setting="${key}" min="0" max="100" step="1">
        </label>`
      ).join("")}
      <div class="draw-flat-settings">
        <p class="ascii-rule">flat brush</p>
        ${FLAT_SETTINGS.map(
          ([key, label, , min, max]) => `<label class="draw-slider">
          <span>${label}<output data-for="${key}"></output></span>
          <input type="range" name="paint-${key}" data-setting="${key}" data-raw min="${min}" max="${max}" step="1">
        </label>`
        ).join("")}
      </div>
    </div>`;
}

// ---------- Toy ----------

export function createDrawingBoard({ scene, camera, renderer, bounds }) {
  const track = createTracker(); // GPU resources, freed in dispose()

  const state = {
    mode: "paint", // the canvas faces the viewer at the start
    erasing: false,
    size: 1,
    color: { chalk: CHALK[0][1], paint: PAINT[0][1] },
    custom: { chalk: null, paint: null }, // last colour made in the picker
    paint: loadPaintSettings(),
  };

  const root = new THREE.Group();
  root.position.z = EASEL_Z;
  scene.add(root);

  // ----- Easel: old, worn silver -----
  const envMap = track(studioEnvMap(renderer)); // something to reflect
  const silver = createSilver({ envMap, track, onRedraw: () => (dirty = true) });
  const { chromeMat, finial } = silver;
  const woodMat = track(new THREE.MeshStandardMaterial({ map: track(woodTexture()), roughness: 0.75 })); // the eraser's back
  const box = (w, h, d, mat = chromeMat) => {
    if (mat === chromeMat) return silver.box(w, h, d);
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
    const pin = new THREE.Mesh(track(new THREE.CylinderGeometry(0.05, 0.05, POST_X * 2, 16)), chromeMat);
    pin.rotation.z = Math.PI / 2;
    pin.position.y = PIVOT_Y;
    root.add(pin);
    // A finial caps the pin outside each post, with a smaller one on the post's top.
    const knob = finial(0.92);
    knob.rotation.z = (-side * Math.PI) / 2; // pointing outward
    knob.position.set(side * (POST_X + POST / 2), PIVOT_Y, 0);
    root.add(knob);
    const cap = finial(0.6);
    cap.position.set(side * POST_X, POST_H, 0);
    root.add(cap);
    // Stepped collars round the post, under the hinge and at its base.
    for (const y of [PIVOT_Y - 0.3, 0.14]) {
      const wide = box(POST + 0.07, 0.06, POST + 0.07);
      wide.position.set(side * POST_X, y, 0);
      const narrow = box(POST + 0.035, 0.035, POST + 0.035);
      narrow.position.set(side * POST_X, y + 0.047, 0);
      root.add(wide, narrow);
    }
    // Small finials tip the feet, front and back.
    for (const end of [1, -1]) {
      const toe = finial(0.4);
      toe.rotation.x = (end * Math.PI) / 2;
      toe.position.set(side * POST_X, 0.05, end > 0 ? FEET_FRONT : -0.75);
      root.add(toe);
    }
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

  // Fluted studs on the frame's corners, both faces.
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) {
        const stud = silver.stud();
        stud.rotation.x = (z * Math.PI) / 2;
        stud.position.set((x * (SURF_W + FRAME)) / 2, (y * (SURF_H + FRAME)) / 2, (z * frameDepth) / 2);
        board.add(stud);
      }
    }
  }

  silver.bake(root);

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
    const back = box(0.6, 0.1, 0.24, woodMat);
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

  // The two brushes (round and flat) lying on the tray. Their bristles show
  // the paint colour they're loaded with.
  const tipMat = track(new THREE.MeshStandardMaterial({ color: PAINT[0][1], roughness: 0.35 }));
  const handleGeo = track(new THREE.CylinderGeometry(0.032, 0.038, 0.72, 12));
  const ferruleMat = track(new THREE.MeshStandardMaterial({ color: 0xc9ccd2, metalness: 0.6, roughness: 0.3 }));
  const brushMeshes = {
    round: {
      handle: 0xb03a2e,
      ferrule: track(new THREE.CylinderGeometry(0.042, 0.034, 0.13, 12)),
      tip: track(new THREE.ConeGeometry(0.047, 0.17, 12)),
    },
    flat: {
      handle: 0x2f4f3e,
      ferrule: track(new THREE.CylinderGeometry(0.044, 0.036, 0.13, 12)).scale(1.6, 1, 0.55), // pinched flat
      tip: track(new THREE.BoxGeometry(0.13, 0.15, 0.035)),
    },
  };
  BRUSHES.forEach(([id], i) => {
    const look = brushMeshes[id];
    const handle = new THREE.Mesh(handleGeo, track(new THREE.MeshStandardMaterial({ color: look.handle, roughness: 0.4 })));
    const ferrule = new THREE.Mesh(look.ferrule, ferruleMat);
    ferrule.position.y = 0.42;
    const tip = new THREE.Mesh(look.tip, tipMat);
    tip.position.y = 0.56;
    // Laid down with the tip to the right (and a flat brush's bristles flat).
    const lying = new THREE.Group();
    lying.rotation.set(0, Math.PI / 2, -Math.PI / 2, "ZYX");
    lying.add(handle, ferrule, tip);
    const brush = new THREE.Group();
    brush.add(lying);
    addItem(brush, { tool: "brush", mode: "paint", brush: id, h: 0.08 }, 0.75 + i * 1.25, i ? 0.1 : -0.08, i ? -0.1 : 0.12);
    for (const part of [handle, ferrule, tip]) {
      part.castShadow = true;
      part.userData = brush.userData;
    }
  });

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
  // The [buttons] wobble gently on hover rather than lighting up (drawing.css).
  const wobbles = [...bar.querySelectorAll(".draw-btn")].map((btn) => shakeOnHover(btn, btn, { strength: 0.5, speed: 0.55 }));
  const sliderBars = [...sliders].map((input) => asciiRange(input));

  function syncSliders() {
    for (const input of sliders) {
      const key = input.dataset.setting;
      // Paint settings are 0–1 shown as %; the flat brush's are stored as shown.
      const raw = "raw" in input.dataset;
      const shown = Math.round(raw ? state.paint[key] : state.paint[key] * 100);
      const unit = raw ? FLAT_SETTINGS.find(([k]) => k === key)[5] : "%";
      input.value = shown;
      settingsPanel.querySelector(`output[data-for="${key}"]`).textContent = `${shown}${unit}`;
    }
    for (const bar of sliderBars) bar.update();
  }

  function showSettings(show) {
    settingsPanel.hidden = !show;
    settingsBtn.setAttribute("aria-expanded", String(show));
    if (!show) return;
    picker.show(false);
    popIn(settingsPanel, { y: -6, scale: 0.96, transformOrigin: "100% 0%" });
  }

  settingsPanel.addEventListener("input", (e) => {
    const key = e.target.dataset.setting;
    if (!key) return;
    state.paint[key] = Number(e.target.value) / ("raw" in e.target.dataset ? 1 : 100);
    syncSliders();
    savePaintSettings();
    drawPreview(); // the brush preview shows the new angle and length
  });

  const savePaintSettings = () => storage.save(SETTINGS_KEY, state.paint);

  // ----- Colour picker (colour-picker.js), under the + after the swatches -----
  const customBtn = () => swatchesEl.querySelector(".draw-custom");
  const isCustom = () => !PALETTES[state.mode].some(([, color]) => color === state.color[state.mode]);
  const picker = createColourPicker({
    bar,
    anchor: customBtn,
    side: () => state.mode,
    colour: () => state.color[state.mode],
    erasing: () => state.erasing,
    onPick: useCustom,
    onOpen: () => showSettings(false),
  });

  /** Paint with a colour made in the picker. */
  function useCustom(hex) {
    state.custom[state.mode] = state.color[state.mode] = hex;
    state.erasing = false;
    renderCustom();
    syncUI();
  }

  // Each colour is a cell of that colour, bracketed when picked: [#]. Then a
  // + that opens the picker (showing the last colour made in it, if any).
  function renderSwatches() {
    swatchesEl.innerHTML =
      PALETTES[state.mode]
        .map(
          ([name, color]) => `<label class="draw-pick draw-swatch" title="${name}">
          <input type="radio" name="draw-color" value="${color}" aria-label="${name}"><span><i style="--c:${color}"></i></span>
        </label>`
        )
        .join("") +
      `<button class="draw-pick draw-custom" type="button" data-action="picker" aria-controls="draw-picker" aria-expanded="${picker.open}" aria-pressed="false" aria-label="Pick any colour" title="Pick any colour"><span></span></button>`;
    renderCustom();
  }

  function renderCustom() {
    const custom = state.custom[state.mode];
    customBtn().firstChild.innerHTML = custom ? `<i style="--c:${custom}"></i>+` : "+";
  }

  function syncUI() {
    for (const input of bar.querySelectorAll("input")) {
      if (input.name === "draw-mode") input.checked = input.value === state.mode;
      if (input.name === "draw-size") input.checked = Number(input.value) === state.size;
      if (input.name === "draw-brush") input.checked = input.value === state.paint.brush;
      if (input.name === "draw-color") input.checked = !state.erasing && input.value === state.color[state.mode];
    }
    eraseBtn.setAttribute("aria-pressed", String(state.erasing));
    customBtn().setAttribute("aria-pressed", String(!state.erasing && isCustom()));
    picker.sync();
    // Brush shapes and paint settings only apply to the canvas.
    settingsBtn.hidden = state.mode !== "paint";
    brushesEl.hidden = state.mode !== "paint";
    settingsPanel.querySelector(".draw-flat-settings").hidden = state.paint.brush !== "flat";
    if (state.mode !== "paint") showSettings(false);
    drawPreview();
    // Lift the matching items on the tray, and load the brushes with the paint.
    tipMat.color.set(state.color.paint);
    for (const item of items) {
      const { tool, mode, color, brush, restY } = item.userData;
      const selected =
        mode === state.mode &&
        (tool === "eraser"
          ? state.erasing
          : !state.erasing && (tool === "brush" ? brush === state.paint.brush : color === state.color[state.mode]));
      const y = restY + (selected ? 0.1 : 0);
      if (reduceMotion()) item.position.y = y;
      else gsap.to(item.position, { y, duration: 0.35, ease: "back.out(2)", overwrite: true });
    }
    dirty = true;
  }

  bar.addEventListener("change", (e) => {
    const { name, value } = e.target;
    if (e.target.dataset.setting || e.target.closest(".draw-picker")) return; // handled above
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
    if (action === "picker") {
      const custom = state.custom[state.mode];
      if (custom && !picker.open) useCustom(custom);
      picker.show(!picker.open);
    }
    if (action === "undo") undo();
    if (action === "clear") clear();
    if (action === "save") save();
  });

  function onKey(e) {
    if (e.key === "Escape" && picker.open) {
      picker.show(false);
      customBtn().focus();
      return;
    }
    if (e.key === "Escape" && !settingsPanel.hidden) {
      showSettings(false);
      settingsBtn.focus();
      return;
    }
    if (e.target.closest?.(".draw-hex")) return; // typing a colour
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
    }
  }
  document.addEventListener("keydown", onKey);

  // Shortcuts for the toolbar: C / P chalkboard or canvas, E eraser, 1–3 size,
  // R / F round or flat brush (on the canvas).
  const stopKeys = onToyKeys((key, e) => {
    const brush = { r: "round", f: "flat" }[key];
    if (!("cpe123".includes(key) && key.length === 1) && !(brush && state.mode === "paint")) return false;
    if (e.repeat) return true;
    if (key === "c" || key === "p") setMode(key === "c" ? "chalk" : "paint");
    else if (key === "e") state.erasing = !state.erasing;
    else if (brush) {
      state.paint.brush = brush;
      state.erasing = false;
      savePaintSettings();
    } else state.size = Number(key) - 1;
    syncUI();
    return true;
  });

  // ----- Flipping between chalkboard and canvas -----
  let flipping = false;
  let spin = -TILT + Math.PI;

  function setMode(mode) {
    if (mode === state.mode) return;
    state.mode = mode;
    state.erasing = false;
    endStroke();
    picker.show(false);
    renderSwatches();
    brushPreview.visible = false; // until the pointer moves over the new side
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
  function makeBristles(w, loaded, settings) {
    const { thickness, chunk, brush } = settings;
    const flat = brush === "flat";
    const length = flat ? flatLength(settings) : 1; // a longer edge needs more bristles
    const count = Math.round(THREE.MathUtils.clamp((w * length) / (flat ? 1.8 : 2.4), 8, flat ? 36 * Math.max(1, length) : 28));
    const ex = Math.cos(flatAngle(settings));
    const ey = Math.sin(flatAngle(settings));
    return Array.from({ length: count }, () => {
      let dx, dy;
      if (flat) {
        // Along the edge, with a little scatter either side of it.
        const along = (rand() - 0.5) * w * length * (1 + 0.1 * chunk);
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
    const hx = (Math.cos(stroke.flatAngle) * w * stroke.flatLength * scale) / 2;
    const hy = (Math.sin(stroke.flatAngle) * w * stroke.flatLength * scale) / 2;
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
    if (!state.erasing && isCustom()) picker.remember(state.color[state.mode]);
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
      flatAngle: flatAngle(state.paint),
      flatLength: flatLength(state.paint),
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
      const { color, relief } = paintedName(family, { w: INK_W, h: INK_H }, WIDTHS.paint.at(-1));
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
  function pickItem({ tool, mode, color, brush }) {
    setMode(mode);
    state.erasing = tool === "eraser";
    if (tool === "color") state.color[mode] = color;
    if (tool === "brush") {
      state.paint.brush = brush;
      savePaintSettings();
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

  // ----- Brush preview: the brush's footprint, in its colour, under the pointer -----
  // Drawn into a small texture on a plane that lies on the board, so it takes
  // the board's tilt and scale. It replaces the system cursor over the board.
  const PREVIEW_PX = 256;
  const PREVIEW_MARGIN = 1.25; // room around the brush for its outline
  const previewCanvas = makeCanvas(PREVIEW_PX, PREVIEW_PX);
  const previewCtx = previewCanvas.getContext("2d");
  const previewTex = track(new THREE.CanvasTexture(previewCanvas));
  previewTex.colorSpace = THREE.SRGBColorSpace;
  const brushPreview = new THREE.Mesh(
    track(new THREE.PlaneGeometry(1, 1)),
    track(new THREE.MeshBasicMaterial({ map: previewTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }))
  );
  brushPreview.visible = false;
  brushPreview.renderOrder = 2;

  /** Redraw the preview for the current tool, size and colour. */
  function drawPreview() {
    const w = width(); // ink px
    const flat = !state.erasing && state.mode === "paint" && state.paint.brush === "flat";
    const length = flat ? flatLength(state.paint) : 1;
    const span = w * PREVIEW_MARGIN * Math.max(1, length); // ink px the preview covers
    const c = previewCtx;
    c.clearRect(0, 0, PREVIEW_PX, PREVIEW_PX);
    c.save();
    c.translate(PREVIEW_PX / 2, PREVIEW_PX / 2);
    c.scale(PREVIEW_PX / span, PREVIEW_PX / span);
    c.beginPath();
    if (flat) {
      // The flat brush's edge, at the angle it's held.
      c.rotate(flatAngle(state.paint));
      const thick = Math.max(w * 0.12, 5);
      c.rect(-w * length * 0.45, -thick / 2, w * length * 0.9, thick);
    } else {
      c.arc(0, 0, w / 2, 0, Math.PI * 2);
    }
    if (!state.erasing) {
      c.fillStyle = state.color[state.mode];
      c.globalAlpha = 0.9;
      c.fill();
      c.globalAlpha = 1;
    }
    // An outline that shows on both the light canvas and the dark slate.
    c.lineWidth = Math.max(2.5, w * 0.04);
    c.strokeStyle = state.mode === "paint" ? "rgba(29, 27, 24, 0.7)" : "rgba(243, 240, 232, 0.85)";
    if (state.erasing) c.setLineDash([w * 0.08, w * 0.06]); // dashed: it takes away
    c.stroke();
    c.restore();
    previewTex.needsUpdate = true;
    brushPreview.scale.setScalar((span * SURF_W) / INK_W);
    dirty = true;
  }

  renderSwatches();
  syncUI();
  syncSliders();
  const stopResize = onResize(fit);
  const barSize = new ResizeObserver(fit);
  barSize.observe(bar);

  const drawRay = new THREE.Raycaster();

  /** The side being drawn on, if `hit` is on it (and it isn't mid-flip). */
  function activeSide(hit) {
    const side = hit?.uv && sides[hit.object.userData.side];
    return side && side.mode === state.mode && !flipping ? side : null;
  }

  return {
    cursor: "crosshair",
    pickables,

    // Tray items are clicked; over the board the brush preview is the cursor.
    cursorFor(hit) {
      if (hit.object.userData.tool) return "pointer";
      return activeSide(hit) ? "none" : "crosshair";
    },

    hover(hit) {
      const side = activeSide(hit);
      if (!side) {
        if (brushPreview.visible) {
          brushPreview.visible = false;
          dirty = true;
        }
        return;
      }
      if (brushPreview.parent !== side.surface) side.surface.add(brushPreview);
      brushPreview.position.set((hit.uv.x - 0.5) * SURF_W, (hit.uv.y - 0.5) * SURF_H, 0.004);
      brushPreview.visible = true;
      dirty = true;
    },

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
      stopKeys();
      stopResize();
      barSize.disconnect();
      for (const remove of unframe) remove();
      for (const wobble of wobbles) wobble.dispose();
      for (const slider of sliderBars) slider.dispose();
      picker.dispose();
      gsap.killTweensOf([bar, board.rotation, ...items.map((item) => item.position)]);
      bar.remove();
      scene.remove(root);
      track.disposeAll();
    },
  };
}
