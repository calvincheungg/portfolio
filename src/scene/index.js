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
//   doubleClick(hit), cursor ("pointer" for clicked rather than dragged toys,
//                  "crosshair" for drawing) optional
//   cursorFor(hit) the cursor for a particular hit ("none" hides it) optional
//   hover(hit)     every pointer move, with what's under it (or null) optional
//   wheel(hit, e)  scroll-wheel moves; return true to use them (and stop the page scrolling) optional
// Toys are downloaded the first time they're picked.
// The first is the one the page opens with. `about` describes it to screen
// readers, with its keyboard shortcuts (`keys`, handled by the toy).
const TOYS = [
  {
    id: "draw",
    label: "Drawing board",
    about: "a drawing board, with a chalkboard on one side and a canvas on the other, Calvin painted on it to start",
    keys: "C chalkboard, P canvas, E eraser, 1 to 3 brush size, R and F round or flat brush, Ctrl or Command Z undo",
    load: () => import("../toys/drawing.js").then((m) => m.createDrawingBoard),
  },
  {
    id: "blocks",
    label: "Blocks",
    about: "wooden toy blocks spelling CALVIN, to pick up and throw",
    keys: "Space tosses the blocks, R drops them in again",
    load: () => import("../toys/blocks.js").then((m) => m.createBlocks),
  },
  {
    id: "cradle",
    label: "Newton's cradle",
    about: "a Newton's cradle with CALVIN etched into its balls",
    keys: "Space or Left arrow swings the left ball, Right arrow the right one",
    load: () => import("../toys/cradle.js").then((m) => m.createCradle),
  },
  {
    id: "cd",
    label: "CD player",
    about: "a portable CD player, with a card file of playlists beside it",
    keys: "Space play or pause, Left and Right arrows skip, Up and Down arrows flip through the playlists, Enter loads one, S shuffle, L song list",
    load: () => import("../toys/cdplayer.js").then((m) => m.createCdPlayer),
  },
];

const ctx = { scene, world, camera, renderer, bounds };
// A toy can be linked to directly, e.g. /?toy=draw
const linked = new URLSearchParams(location.search).get("toy");
let toyId = TOYS.find((t) => t.id === linked)?.id ?? TOYS[0].id;
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
  canvas.classList.remove("grab", "point", "draw", "nocursor");
  const { about, keys } = TOYS.find((t) => t.id === id);
  canvas.setAttribute("aria-label", `Interactive toy: ${about}. Keys: ${keys}. Right-click, or use the Choose a toy button, to switch toys.`);
  requestRender();
}

const toySwitch = document.getElementById("toy-switch");
const menu = createToyMenu(
  document.getElementById("toy-menu"),
  TOYS,
  loadToy,
  [{ label: "Reset", onClick: () => loadToy(toyId) }],
  { trigger: toySwitch }
);
// The keyboard way in: opens the menu just under the button.
toySwitch.addEventListener("click", () => {
  if (toySwitch.getAttribute("aria-expanded") === "true") return menu.close();
  const r = toySwitch.getBoundingClientRect();
  menu.open(r.left, r.bottom + 6, toyId);
});

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
