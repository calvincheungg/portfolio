import * as THREE from "three";
import * as CANNON from "cannon-es";
import { LETTER_FONT, SCENE_WIDTH, BACK_Z, FRONT_Z } from "./toys/shared.js";
import { createBlocks } from "./toys/blocks.js";
import { createCradle } from "./toys/cradle.js";
import { createCdPlayer } from "./toys/cdplayer.js";
import { createToyMenu } from "./toy-menu.js";
import { getSetting, onSettingChange, theme } from "./settings.js";

// Each toy builds itself into the shared scene/world and returns:
//   pickables (meshes that can be grabbed), grab(hit) -> { move(ray), release() },
//   update(dt), dispose(), and optionally doubleClick(hit) and cursor ("pointer"
//   for toys that are clicked rather than dragged).
const TOYS = [
  { id: "blocks", label: "Blocks", create: createBlocks },
  { id: "cradle", label: "Newton's cradle", create: createCradle },
  { id: "cd", label: "CD player", create: createCdPlayer },
];

// Scene colours per theme: background matches the page; shadows are stronger
// on dark so they still read.
const SCENE_THEMES = {
  light: { background: 0xf4f1ec, shadow: 0.16 },
  dark: { background: 0x1b1916, shadow: 0.42 },
};
const LONG_PRESS_MS = 500;

const canvas = document.getElementById("stage");

// ---------- Renderer / scene ----------

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color();

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);

scene.add(new THREE.HemisphereLight(0xffffff, 0xd8cbb8, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(4, 10, 6);
sun.castShadow = true;
sun.shadow.radius = 6;
sun.shadow.bias = -0.0005;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 40;
scene.add(sun);

// Invisible floor that only shows the toys' shadows.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.ShadowMaterial({ opacity: 0.16 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ---------- Physics world ----------

const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -35, 0) });
world.allowSleep = true;
world.defaultContactMaterial.friction = 0.45;
world.defaultContactMaterial.restitution = 0.25;
// Firmer contacts and more solver passes so resting bodies don't sink into each
// other (which reads as sticking).
world.defaultContactMaterial.contactEquationStiffness = 1e8;
world.defaultContactMaterial.contactEquationRelaxation = 3;
world.solver.iterations = 20;

function addPlane(position, axis, angle) {
  const body = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
  body.position.set(...position);
  body.quaternion.setFromAxisAngle(new CANNON.Vec3(...axis), angle);
  world.addBody(body);
  return body;
}

// cannon planes face +Z by default; rotate each to face into the play area.
addPlane([0, 0, 0], [1, 0, 0], -Math.PI / 2); // floor
const leftWall = addPlane([0, 0, 0], [0, 1, 0], Math.PI / 2);
const rightWall = addPlane([0, 0, 0], [0, 1, 0], -Math.PI / 2);
addPlane([0, 0, BACK_Z], [0, 1, 0], 0);
addPlane([0, 0, FRONT_Z], [0, 1, 0], Math.PI);

const bounds = { halfWidth: 5 }; // updated on resize; toys read it

// ---------- Layout ----------

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;

  // Back the camera off until the whole name (plus margin) fits horizontally.
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const tanH = tanV * camera.aspect;
  const dist = Math.max(11, (SCENE_WIDTH / 2 + 1.6) / tanH);
  camera.position.set(0, dist * 0.34, dist);
  camera.lookAt(0, dist * 0.15, 0);
  camera.updateProjectionMatrix();

  // Side walls sit at the edge of what's visible at the front of the play area.
  bounds.halfWidth = (dist - FRONT_Z) * tanH - 0.6;
  leftWall.position.x = -bounds.halfWidth;
  rightWall.position.x = bounds.halfWidth;

  const s = sun.shadow.camera;
  s.left = -bounds.halfWidth - 3;
  s.right = bounds.halfWidth + 3;
  s.top = 10;
  s.bottom = -10;
  s.updateProjectionMatrix();
}

// ---------- Settings ----------

function applyTheme() {
  const colors = SCENE_THEMES[theme()];
  scene.background.set(colors.background);
  ground.material.opacity = colors.shadow;
}

// Low quality: no extra resolution on high-DPI screens, smaller shadow map.
function applyQuality() {
  const high = getSetting("quality") === "high";
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 2 : 1));
  const size = high ? 2048 : 1024;
  if (sun.shadow.mapSize.x !== size) {
    sun.shadow.mapSize.set(size, size);
    sun.shadow.map?.dispose();
    sun.shadow.map = null; // rebuilt at the new size on the next render
  }
  resize();
}

onSettingChange((key) => {
  if (key === "theme") applyTheme();
  if (key === "quality") applyQuality();
});

// ---------- Toys ----------

const ctx = { scene, world, camera, renderer, bounds };
let toyId = TOYS[0].id;
let toy = null;

function loadToy(id) {
  releaseDrag();
  toy?.dispose();
  toyId = id;
  toy = TOYS.find((t) => t.id === id).create(ctx);
  canvas.classList.remove("grab", "point");
}

const menu = createToyMenu(document.getElementById("toy-menu"), TOYS, loadToy, [
  { label: "Reset", onClick: () => loadToy(toyId) },
]);

// ---------- Pointer ----------

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let drag = null; // { handle, pointerId }
let longPress = null; // { timer, x, y }

function setPointer(e) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

function pick(e) {
  setPointer(e);
  return raycaster.intersectObjects(toy.pickables, false)[0];
}

function cancelLongPress() {
  if (longPress) clearTimeout(longPress.timer);
  longPress = null;
}

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return; // right-click opens the menu instead
  const hit = pick(e);

  if (!hit) {
    // Touch screens have no right-click: a long press on empty space opens the menu.
    if (e.pointerType === "touch") {
      longPress = {
        x: e.clientX,
        y: e.clientY,
        timer: setTimeout(() => menu.open(e.clientX, e.clientY, toyId), LONG_PRESS_MS),
      };
    }
    return;
  }

  drag = { handle: toy.grab(hit), pointerId: e.pointerId };
  canvas.setPointerCapture(e.pointerId);
  if (toy.cursor !== "pointer") canvas.classList.add("grabbing");
});

canvas.addEventListener("pointermove", (e) => {
  if (longPress && Math.hypot(e.clientX - longPress.x, e.clientY - longPress.y) > 10) cancelLongPress();
  if (!drag) {
    // Toys can ask for a pointer cursor (buttons) instead of the grab hand.
    canvas.classList.toggle(toy.cursor === "pointer" ? "point" : "grab", !!pick(e));
    return;
  }
  setPointer(e);
  drag.handle.move(raycaster.ray);
});

function releaseDrag() {
  cancelLongPress();
  if (!drag) return;
  drag.handle.release();
  if (canvas.hasPointerCapture(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId);
  drag = null;
  canvas.classList.remove("grabbing");
}

canvas.addEventListener("pointerup", releaseDrag);
canvas.addEventListener("pointercancel", releaseDrag);

canvas.addEventListener("dblclick", (e) => {
  const hit = toy.doubleClick && pick(e);
  if (hit) toy.doubleClick(hit);
});

canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  releaseDrag();
  menu.open(e.clientX, e.clientY, toyId);
});

// ---------- Loop ----------

let last = performance.now();

function tick(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  world.step(1 / 60, dt, 10);
  toy.update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

// ---------- Boot ----------

window.addEventListener("resize", resize);
applyTheme();
applyQuality(); // also sizes the canvas

// Wait for the letter font so letters aren't painted in the fallback face.
Promise.race([
  document.fonts.load(`100px ${LETTER_FONT}`),
  new Promise((r) => setTimeout(r, 1500)),
]).finally(() => {
  loadToy(toyId);
  requestAnimationFrame(tick);
});
