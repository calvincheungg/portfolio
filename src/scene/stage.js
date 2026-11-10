import * as THREE from "three";
import { SCENE_WIDTH, FRONT_Z } from "../toys/shared.js";
import { getSetting, onSettingChange, theme } from "../settings.js";

// The 3D stage shared by every toy: renderer, scene, camera, lights and the
// invisible shadow-catching floor. Also applies the Theme and Graphics settings.

// Scene colours per theme: background matches the page; shadows are stronger
// on dark so they still read.
const SCENE_THEMES = {
  light: { background: 0xf4f1ec, shadow: 0.16 },
  dark: { background: 0x1b1916, shadow: 0.42 },
};

export const canvas = document.getElementById("stage");

export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

export const scene = new THREE.Scene();
scene.background = new THREE.Color();

export const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);

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
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial());
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ---------- Rendering on demand ----------

// The scene is only redrawn when something asks for it (a toy moved, the
// window resized, a setting changed), so a still scene costs nothing.
let needsRender = true;

export function requestRender() {
  needsRender = true;
}

export function renderIfNeeded() {
  if (!needsRender) return;
  needsRender = false;
  renderer.render(scene, camera);
}

// ---------- Layout ----------

/** How far the play area reaches either side of centre; updated on resize. */
export const bounds = { halfWidth: 5 };
const resizeListeners = new Set();

/** Run `fn(bounds)` now and after every resize. */
export function onResize(fn) {
  resizeListeners.add(fn);
  fn(bounds);
}

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

  // The play area ends at what's visible at its front edge.
  bounds.halfWidth = (dist - FRONT_Z) * tanH - 0.6;

  const s = sun.shadow.camera;
  s.left = -bounds.halfWidth - 3;
  s.right = bounds.halfWidth + 3;
  s.top = 10;
  s.bottom = -10;
  s.updateProjectionMatrix();

  resizeListeners.forEach((fn) => fn(bounds));
  requestRender();
}

// ---------- Settings ----------

function applyTheme() {
  const colors = SCENE_THEMES[theme()];
  scene.background.set(colors.background);
  ground.material.opacity = colors.shadow;
  requestRender();
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

window.addEventListener("resize", resize);
applyTheme();
applyQuality(); // also sizes the canvas
