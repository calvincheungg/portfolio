import { gsap } from "gsap";
import { createDialog } from "./dialog.js";
import { flapIn } from "./splitflap.js";

// About popup: drops in like a block landing; on close it hangs from a corner,
// falls to the bottom of the screen, topples flat and fades.

const dialog = document.getElementById("about");
const card = dialog.querySelector(".about-card");

const about = createDialog(dialog, {
  show() {
    gsap.killTweensOf([dialog, card]);
    flapIn(card, { delay: 0.15, gap: 0.25 }); // the text clicks over like a departures board
    gsap.fromTo(dialog, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power1.out" });
    // Falls, tilts, then bounces level.
    gsap.fromTo(
      card,
      { x: 0, y: -140, rotation: -5, scale: 0.94, autoAlpha: 0, transformOrigin: "50% 50%" },
      { y: 0, rotation: 0, scale: 1, autoAlpha: 1, duration: 1, ease: "elastic.out(1, 0.55)" }
    );
  },
  hide(done) {
    gsap.killTweensOf([dialog, card]);
    dropToFloor().to([card, dialog], {
      opacity: 0,
      duration: 0.35,
      ease: "power1.out",
      delay: 0.3, // let it rest a beat once flat
      onComplete: done,
    });
  },
});

document.getElementById("about-toggle").addEventListener("click", about.open);
document.getElementById("about-close").addEventListener("click", about.close);

// The card hangs from one top corner (like a sign losing a nail), swings, then
// drops to the bottom of the screen and bounces. Fall times come from
// kinematics (t = sqrt(2h / g)) so it reads as real gravity.
const GRAVITY = 5200; // px/s²
const RESTITUTION = 0.38; // fraction of speed kept per bounce
const FLOOR_MARGIN = 12; // px above the bottom edge where it lands

const randomBetween = (min, max) => min + Math.random() * (max - min);

function dropToFloor() {
  // Start from the card's resting pose so the geometry below is exact, even if
  // it's closed mid-way through the opening bounce.
  gsap.set(card, { x: 0, y: 0, rotation: 0, scale: 1, autoAlpha: 1 });

  // Hinge on a random top corner; the opposite side swings down.
  const hingeLeft = Math.random() < 0.5;
  const dir = hingeLeft ? 1 : -1; // positive rotation = clockwise
  gsap.set(card, { transformOrigin: hingeLeft ? "0% 0%" : "100% 0%" });

  const swingAngle = dir * randomBetween(16, 28);
  const landAngle = swingAngle + dir * randomBetween(8, 22); // keeps turning as it falls

  // How far down the card can move before its lowest corner reaches the floor
  // at the angle it lands at.
  const w = card.offsetWidth;
  const h = card.offsetHeight;
  const pivotX = hingeLeft ? 0 : w;
  const pivotScreenY = card.getBoundingClientRect().top;
  // Corners relative to the hinge, and where each ends up when rotated (screen
  // coords: y points down, positive angle = clockwise, same as CSS).
  const corners = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => [x - pivotX, y]);
  const rotate = ([x, y], deg) => {
    const r = (deg * Math.PI) / 180;
    return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
  };
  // The corner that touches the floor first is the lowest one at landing.
  const contact = corners.reduce((a, b) => (rotate(b, landAngle)[1] > rotate(a, landAngle)[1] ? b : a));
  const floorY = window.innerHeight - FLOOR_MARGIN - (pivotScreenY + rotate(contact, landAngle)[1]);
  const fallTime = Math.sqrt((2 * Math.max(floorY, 1)) / GRAVITY);

  const tl = gsap.timeline();

  // 1. One corner lets go: the card swings down on the other and wobbles.
  tl.to(card, { rotation: swingAngle, duration: 0.7, ease: "elastic.out(1, 0.4)" });

  // 2. The last corner gives: free fall (power2.in is exactly constant
  //    acceleration), still rotating from the swing.
  tl.addLabel("fall", "-=0.2");
  tl.to(card, { y: floorY, duration: fallTime, ease: "power2.in" }, "fall");
  tl.to(card, { rotation: landAngle, duration: fallTime, ease: "none" }, "fall");

  // 3. Decaying bounces on the floor.
  let speed = GRAVITY * fallTime;
  for (let i = 0; i < 2; i++) {
    speed *= RESTITUTION;
    const riseTime = speed / GRAVITY;
    const height = (speed * speed) / (2 * GRAVITY);
    tl.to(card, { y: floorY - height, duration: riseTime, ease: "power2.out" });
    tl.to(card, { y: floorY, duration: riseTime, ease: "power2.in" });
  }

  // 4. Topple off the corner and settle flat on its bottom edge, pivoting on
  //    the corner touching the floor (shifting x/y so that corner stays put).
  //    Its centre of mass is always inside that corner at these angles, so it
  //    falls back to 0° rather than over onto its side.
  const [landX, landY] = rotate(contact, landAngle);
  const tilt = { angle: landAngle };
  const applyTilt = () => {
    const [cx, cy] = rotate(contact, tilt.angle);
    gsap.set(card, { rotation: tilt.angle, x: landX - cx, y: floorY + landY - cy });
  };
  const toppleTime = 0.25 + (Math.abs(landAngle) / 50) * 0.25; // steeper = longer to fall
  tl.to(tilt, { angle: 0, duration: toppleTime, ease: "power2.in", onUpdate: applyTilt });
  // Small knock as the far edge hits the floor.
  tl.to(tilt, { angle: dir * 2, duration: 0.07, ease: "power2.out", onUpdate: applyTilt });
  tl.to(tilt, { angle: 0, duration: 0.07, ease: "power2.in", onUpdate: applyTilt });
  return tl;
}
