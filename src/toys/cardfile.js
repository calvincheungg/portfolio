import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { gsap } from "gsap";
import { createSilver } from "./silver.js";
import { backCoverTexture, coverTexture, tabTexture } from "./cdplayer-textures.js";
import { PLAYLISTS } from "../../playlists.js";
import { reduceMotion } from "../settings.js";

// The CD player's rotary card file (a "rolodex"): one CD case per playlist,
// clipped round a wheel on a horizontal axle. The case at the top leans toward
// you; the next ones stand behind it with their name tabs showing over the
// top, and the one you flipped past hangs down in front, showing its back
// cover. The rest go round underneath.
//
// Scroll or drag it to flip through; click the front case to load its disc
// (`onLoad`), or another case to bring it to the front.

export const CASE_SIZE = 1.1;
export const CASE_DEPTH = 0.1;
const TAB = { w: 0.52, h: 0.2, stagger: [-0.3, 0.02, 0.3] }; // tabs step left to right, case by case
const HUB_R = 0.3; // cases clip on at this radius
const AXLE_Y = HUB_R + CASE_SIZE + 0.14;
const LEAN_FRONT = 110; // degrees the case just flipped past falls forward (past flat, so its back faces you)
const LEAN_UP = 20; // the front case leans toward you, so the next one's title shows over it
const LEAN_BACK = -18; // the next case, standing just behind
const DRAG_PER_CASE = 0.45; // world units of drag to flip one case past
const WHEEL_PER_CASE = 40; // px of scrolling to flip one case past
const WHEEL_END = 400; // ms without scrolling that ends a scroll
const WHEEL_REPEAT = 250; // ms after a flip before the same scroll can flip another

const deg = THREE.MathUtils.degToRad;
const N = PLAYLISTS.length;
const SPREAD = (360 - (LEAN_FRONT - LEAN_BACK)) / Math.max(1, N - 2); // degrees between the rest
const wrap = (i) => ((i % N) + N) % N;

/** Is this hit on the card file? */
export const onCardFile = (hit) => ["case", "file"].includes(hit?.object.userData.action);

export function createCardFile({ envMap, track, onLoad }) {
  const group = new THREE.Group();
  const darkPlastic = track(new THREE.MeshStandardMaterial({ color: 0x24252b, roughness: 0.5 }));

  // ----- Stand -----
  // In the same worn silver and hardware as the drawing board's easel
  // (silver.js): a base with fluted studs, two arms up to the axle with beaded
  // collars, a hub the cases clip on and a crown finial capping each end of
  // the axle.
  let hardwareRedrawn = false; // the finials' engraving redraws once its font arrives
  const hardware = createSilver({ envMap, track, onRedraw: () => (hardwareRedrawn = true) });
  const ARM_X = CASE_SIZE / 2 + 0.1;
  const BASE = { w: ARM_X * 2 + 0.34, h: 0.14, d: 1.5 };
  const standPart = (object) => {
    group.add(object);
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
    for (const [r, x] of [[0.1, 0.055], [0.13, 0.075]]) {
      const ring = standPart(hardware.bead(r, 0.014));
      ring.rotation.set(0, 0, Math.PI / 2); // round the axle
      ring.position.set(side * (ARM_X + x), AXLE_Y, 0);
    }
    // Crown finial on the end of the axle, pointing outward.
    const crown = standPart(hardware.finial(0.75));
    crown.rotation.z = (-side * Math.PI) / 2;
    crown.position.set(side * (ARM_X + 0.08), AXLE_Y, 0);
  }
  const hub = standPart(hardware.rod(HUB_R, ARM_X * 2 - 0.08, 40));
  hub.rotation.z = Math.PI / 2;
  hub.position.y = AXLE_Y;
  hardware.bake(group); // tarnish flows across the stand as one piece of metal
  // Every part of the stand turns the wheel when dragged.
  group.traverse((o) => o.isMesh && (o.userData.action = "file"));

  // ----- Cases -----
  // Each sits on a pivot round the axle, with its index tab sticking up from the top edge.
  const caseGeo = track(new RoundedBoxGeometry(CASE_SIZE, CASE_SIZE, CASE_DEPTH, 2, 0.02));
  const tabGeo = track(new RoundedBoxGeometry(TAB.w, TAB.h, CASE_DEPTH * 0.5, 2, 0.04));
  const material = (options) => track(new THREE.MeshStandardMaterial(options));
  const pivots = [];
  const cases = PLAYLISTS.map((playlist, index) => {
    const pivot = new THREE.Group();
    pivot.position.y = AXLE_Y;
    group.add(pivot);
    pivots.push(pivot);
    const cover = material({ map: track(coverTexture(playlist)), roughness: 0.25 });
    const back = material({ map: track(backCoverTexture(playlist)), roughness: 0.3 });
    // Face order: +x, -x, +y, -y, +z (front), -z.
    const caseMesh = new THREE.Mesh(caseGeo, [darkPlastic, darkPlastic, darkPlastic, darkPlastic, cover, back]);
    caseMesh.position.y = HUB_R + CASE_SIZE / 2;
    caseMesh.userData = { action: "case", playlist, index };
    // (three.js colours take #rrggbb, so any alpha on the playlist's colour is dropped.)
    const tabSide = material({ color: playlist.color.slice(0, 7), roughness: 0.35 });
    const tabFace = material({ map: track(tabTexture(playlist)), roughness: 0.35 });
    const tab = new THREE.Mesh(tabGeo, [tabSide, tabSide, tabSide, tabSide, tabFace, tabSide]);
    tab.position.set(TAB.stagger[index % TAB.stagger.length], HUB_R + CASE_SIZE + TAB.h / 2 - 0.03, 0);
    tab.userData = caseMesh.userData; // clicking it counts as clicking the case
    pivot.add(caseMesh, tab);
    return caseMesh;
  });

  const meshes = [];
  group.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    meshes.push(o);
  });

  // ----- Turning -----
  // `view.pos` is how far the wheel has turned, in cases (whole numbers put a
  // case at the front); `target` is where it's heading.
  const view = { pos: 0 };
  let target = 0;
  let shownPos = NaN;

  /** How far a case `d` places from the front leans. */
  function leanFor(d) {
    if (d >= 1) return LEAN_BACK - (d - 1) * SPREAD;
    if (d >= 0) return LEAN_UP + (LEAN_BACK - LEAN_UP) * d;
    if (d >= -1) return LEAN_UP + (LEAN_FRONT - LEAN_UP) * -d;
    return LEAN_FRONT + (-d - 1) * SPREAD;
  }
  function layout() {
    if (view.pos === shownPos) return false;
    shownPos = view.pos;
    pivots.forEach((pivot, i) => {
      // How far this case is from the front, wrapped round to -N/2..N/2.
      let d = (i - view.pos) % N;
      if (d < -N / 2) d += N;
      if (d >= N / 2) d -= N;
      pivot.rotation.x = deg(leanFor(d));
    });
    return true;
  }
  layout();

  /** Turn the wheel to `pos`, flipping cases over on the way. */
  function turnTo(pos, { instant = false, duration = 0.5 } = {}) {
    target = pos;
    gsap.killTweensOf(view);
    if (instant || reduceMotion()) view.pos = target;
    else gsap.to(view, { pos: target, duration, ease: "back.out(1.1)" });
  }

  const frontIndex = () => wrap(Math.round(target));
  const front = () => PLAYLISTS[frontIndex()];

  /** Bring a playlist's case to the front, the shortest way round. */
  function show(playlist, options) {
    const index = PLAYLISTS.indexOf(playlist);
    if (index < 0) return;
    let steps = wrap(index - frontIndex());
    if (steps > N / 2) steps -= N;
    turnTo(Math.round(target) + steps, options);
  }

  /** Flip `dir` cases on (+) or back (−). */
  function flip(dir, duration = 0.45) {
    turnTo(Math.round(target) + dir, { duration });
  }

  // Mouse wheel / trackpad: one case per notch's worth of scrolling. After a
  // flip, a trackpad keeps sending "momentum" scrolls that die away; those are
  // ignored, so a flick flips one case. Scrolling that keeps up its strength
  // (a hand still pushing, a wheel still turning) flips on, a few a second.
  let wheelAcc = 0;
  let lastWheelAt = -Infinity;
  let lastFlipAt = -Infinity;
  let lastSize = 0;
  let flipped = false; // this scroll has flipped a case already

  function wheel(deltaY) {
    const now = performance.now();
    const pause = now - lastWheelAt;
    const size = Math.abs(deltaY);
    const fading = size < lastSize;
    lastWheelAt = now;
    lastSize = size;
    // A new scroll: forget any part-scroll left from the last one. (Another
    // flick straight after one gets through below anyway, since it builds up.)
    if (pause > WHEEL_END) {
      wheelAcc = 0;
      flipped = false;
    }
    if (flipped && (fading || now - lastFlipAt < WHEEL_REPEAT)) return;
    if (Math.sign(deltaY) !== Math.sign(wheelAcc)) wheelAcc = 0; // changed direction
    wheelAcc += deltaY;
    if (Math.abs(wheelAcc) < WHEEL_PER_CASE) return;
    flip(Math.sign(wheelAcc));
    wheelAcc = 0;
    flipped = true;
    lastFlipAt = now;
  }

  // Drag up or down to spin it; let go and it settles on a case. A press that
  // hardly moves is a click: on the front case it loads that disc, on another
  // it turns that one to the front.
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const dragPoint = new THREE.Vector3();

  return {
    group,
    pickables: meshes,
    front,
    show,
    flip,

    /** Where a disc taken out of `playlist`'s case starts, in world space. */
    discStart(playlist, position, quaternion) {
      const caseMesh = cases[PLAYLISTS.indexOf(playlist)];
      caseMesh.updateWorldMatrix(true, false);
      caseMesh.getWorldPosition(position);
      caseMesh.getWorldQuaternion(quaternion);
      // Just in front of the cover, facing out like it.
      position.add(new THREE.Vector3(0, 0, CASE_DEPTH).applyQuaternion(quaternion));
      quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)));
    },

    /** The front case is clicked; the rest is dragged. */
    cursorFor(hit) {
      const { action, playlist } = hit.object.userData;
      return action === "case" && playlist === front() ? "pointer" : "grab";
    },

    wheel,

    grab(hit) {
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
          // Pulling down flips the front case toward you, on to the next one.
          view.pos = startPos - dy / DRAG_PER_CASE;
        },
        release() {
          if (moved >= 0.05) {
            turnTo(Math.round(view.pos), { duration: 0.4 });
            return;
          }
          view.pos = startPos;
          const { action, playlist } = hit.object.userData;
          if (action !== "case") return;
          if (playlist === front()) onLoad(playlist);
          else show(playlist);
        },
      };
    },

    /** Lay the cases out; true if anything moved. */
    update() {
      const changed = layout() || hardwareRedrawn;
      hardwareRedrawn = false;
      return changed;
    },

    dispose() {
      gsap.killTweensOf(view);
    },
  };
}
