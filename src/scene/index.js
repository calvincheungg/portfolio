import { canvas, scene, camera, renderer, bounds, requestRender, renderIfNeeded } from "./stage.js";
import { world } from "./physics.js";
import { setupPointer } from "./pointer.js";
import { createToyMenu } from "../ui/toy-menu.js";
import { fonts } from "../lib/fonts.js";

// The toys, the menu to switch between them, and the frame loop.
//
// Each toy module exports a create function that builds the toy into the
// shared scene/world and returns:
//   pickables      meshes that can be grabbed or clicked
//   grab(hit)      → { move(ray), release() } while held
//   update(dt)     → true if anything visible changed (so the frame is drawn)
//   dispose()
//   doubleClick(hit), cursor ("pointer" for clicked rather than dragged toys)
//                  optional
// Toys are downloaded the first time they're picked.
const TOYS = [
  { id: "blocks", label: "Blocks", load: () => import("../toys/blocks.js").then((m) => m.createBlocks) },
  { id: "cradle", label: "Newton's cradle", load: () => import("../toys/cradle.js").then((m) => m.createCradle) },
  { id: "cd", label: "CD player", load: () => import("../toys/cdplayer.js").then((m) => m.createCdPlayer) },
];

const ctx = { scene, world, camera, renderer, bounds };
let toyId = TOYS[0].id;
let toy = null;
let loading = 0; // so only the latest pick wins if several load at once

async function loadToy(id) {
  const ticket = ++loading;
  const create = await TOYS.find((t) => t.id === id).load();
  if (ticket !== loading) return;
  pointer.releaseDrag();
  toy?.dispose();
  toyId = id;
  toy = create(ctx);
  canvas.classList.remove("grab", "point");
  requestRender();
}

const menu = createToyMenu(document.getElementById("toy-menu"), TOYS, loadToy, [
  { label: "Reset", onClick: () => loadToy(toyId) },
]);

const pointer = setupPointer({
  getToy: () => toy,
  openMenu: (x, y) => menu.open(x, y, toyId),
});

// ---------- Loop ----------

let last = performance.now();

function tick(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  world.step(1 / 60, dt, 10);
  if (toy?.update(dt)) requestRender();
  renderIfNeeded();
  requestAnimationFrame(tick);
}

// Wait for the letter font so letters aren't painted in the fallback face.
Promise.race([
  document.fonts.load(`100px ${fonts.letter}`),
  new Promise((r) => setTimeout(r, 1500)),
]).finally(() => {
  loadToy(toyId);
  requestAnimationFrame(tick);
});
