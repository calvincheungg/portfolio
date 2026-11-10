import * as CANNON from "cannon-es";
import { BACK_Z, FRONT_Z } from "../toys/shared.js";
import { onResize } from "./stage.js";

// The physics world (used by the blocks), boxed in by an invisible floor and
// walls that track the visible area.

export const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -35, 0) });
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

// Side walls sit at the edge of what's visible.
onResize(({ halfWidth }) => {
  leftWall.position.x = -halfWidth;
  rightWall.position.x = halfWidth;
});
