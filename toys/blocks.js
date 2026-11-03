import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import * as CANNON from "cannon-es";
import { NAME, LETTER_FONT, BACK_Z, FRONT_Z } from "./shared.js";

const LETTER_COLORS = ["#c0392b", "#2c6e9b", "#3f7d4e", "#d08a1e", "#7a4b8c", "#c0392b"];
const SIZE = 1; // block edge length in world units
const GAP = 0.22;
const NAME_WIDTH = NAME.length * SIZE + (NAME.length - 1) * GAP;
const MAX_THROW_SPEED = 22;

// Block-on-block contact is slipperier than block-on-floor (which uses the
// world default), so blocks slide off each other's edges and topple instead of
// gripping; the floor still grips so they don't skate away.
const blockMaterial = new CANNON.Material("block");
const blockOnBlock = new CANNON.ContactMaterial(blockMaterial, blockMaterial, {
  friction: 0.15,
  restitution: 0.2,
  contactEquationStiffness: 1e8,
  contactEquationRelaxation: 3,
});

const geometry = new RoundedBoxGeometry(SIZE, SIZE, SIZE, 4, SIZE * 0.08);
const boxShape = new CANNON.Box(new CANNON.Vec3(SIZE / 2, SIZE / 2, SIZE / 2));

// ---------- Wood texture ----------

function rand(seed) {
  // Small deterministic PRNG so each face keeps its own grain.
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function makeFaceTexture(renderer, letter, color, seed) {
  const size = 512;
  const tex = document.createElement("canvas");
  tex.width = tex.height = size;
  const c = tex.getContext("2d");
  const rnd = rand(seed * 9973 + 1);

  // Base wood tone with slight variation per face.
  const hue = 30 + rnd() * 6;
  const light = 66 + rnd() * 6;
  const grad = c.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, `hsl(${hue}, 52%, ${light + 5}%)`);
  grad.addColorStop(1, `hsl(${hue - 3}, 48%, ${light - 5}%)`);
  c.fillStyle = grad;
  c.fillRect(0, 0, size, size);

  // Grain.
  const lines = 22;
  for (let i = 0; i < lines; i++) {
    const y0 = (i / lines) * size * 1.2 - size * 0.1;
    const amp = size * (0.01 + rnd() * 0.03);
    const freq = 1.5 + rnd() * 2;
    const phase = rnd() * Math.PI * 2;
    c.beginPath();
    for (let x = 0; x <= size; x += 4) {
      const y = y0 + Math.sin((x / size) * freq * Math.PI + phase) * amp;
      x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    }
    c.strokeStyle = `rgba(110, 62, 24, ${0.06 + rnd() * 0.12})`;
    c.lineWidth = 1.5 + rnd() * 4;
    c.stroke();
  }

  // Classic raised border panel.
  const inset = size * 0.11;
  const r = size * 0.05;
  c.lineWidth = size * 0.018;
  roundRect(c, inset, inset, size - inset * 2, size - inset * 2, r);
  c.strokeStyle = "rgba(100, 55, 20, 0.35)";
  c.stroke();
  roundRect(c, inset + 4, inset + 4, size - inset * 2, size - inset * 2, r);
  c.strokeStyle = "rgba(255, 240, 215, 0.35)";
  c.stroke();

  // Painted letter with a subtle carved shadow.
  c.font = `${Math.round(size * 0.58)}px ${LETTER_FONT}`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  const lx = size / 2;
  const ly = size / 2 + size * 0.03;
  c.fillStyle = "rgba(255, 240, 215, 0.5)";
  c.fillText(letter, lx + size * 0.012, ly + size * 0.012);
  c.fillStyle = "rgba(60, 30, 10, 0.35)";
  c.fillText(letter, lx - size * 0.01, ly - size * 0.01);
  c.fillStyle = color;
  c.fillText(letter, lx, ly);

  const texture = new THREE.CanvasTexture(tex);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

// ---------- Toy ----------

export function createBlocks({ scene, world, camera, renderer, bounds }) {
  if (!world.contactmaterials.includes(blockOnBlock)) world.addContactMaterial(blockOnBlock);

  function makeBlock(letter, index) {
    // Face order: +x, -x, +y, -y, +z (front), -z. Same letter on every face so
    // the name still reads however a block lands; colours rotate across faces.
    const materials = [0, 1, 2, 3, 4, 5].map((face) => {
      const color = LETTER_COLORS[(index + (face === 4 ? 0 : face + 1)) % LETTER_COLORS.length];
      return new THREE.MeshStandardMaterial({
        map: makeFaceTexture(renderer, letter, color, index * 6 + face + 1),
        roughness: 0.7,
        metalness: 0,
      });
    });
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.castShadow = true;
    scene.add(mesh);

    const body = new CANNON.Body({
      mass: 1,
      shape: boxShape,
      material: blockMaterial,
      linearDamping: 0.05,
      angularDamping: 0.02, // low, so a tipping block keeps rotating over
      // Only fall asleep when truly still, so slow topples aren't frozen mid-way.
      sleepSpeedLimit: 0.05,
      sleepTimeLimit: 1.5,
    });
    world.addBody(body);
    mesh.userData.body = body;
    return { mesh, body };
  }

  const blocks = [...NAME].map(makeBlock);
  const startX = -NAME_WIDTH / 2 + SIZE / 2;
  blocks.forEach(({ body }, i) => {
    body.position.set(startX + i * (SIZE + GAP), 5 + i * 0.9, 0); // staggered drop
    body.quaternion.setFromEuler(
      (Math.random() - 0.5) * 0.15,
      (Math.random() - 0.5) * 0.15,
      (Math.random() - 0.5) * 0.15
    );
  });

  // Massless anchor that follows the pointer; the held block is pinned to it.
  const anchor = new CANNON.Body({ type: CANNON.Body.STATIC });
  anchor.collisionFilterGroup = 0;
  anchor.collisionFilterMask = 0;
  world.addBody(anchor);

  // Put back any block that escaped the play area.
  function rescueStrays() {
    const hw = bounds.halfWidth;
    for (const { body } of blocks) {
      const p = body.position;
      if (p.y < -2 || Math.abs(p.x) > hw + 2 || p.z < BACK_Z - 2 || p.z > FRONT_Z + 2) {
        body.position.set(THREE.MathUtils.clamp(p.x, -hw + 1, hw - 1), 6, 0);
        body.velocity.setZero();
        body.angularVelocity.setZero();
        body.wakeUp();
      }
    }
  }

  return {
    pickables: blocks.map((b) => b.mesh),

    grab(hit) {
      const body = hit.object.userData.body;
      // Drag on a camera-facing plane through the grab point, so moving the
      // pointer up lifts the block. Grabbing off-centre lets it swing and tumble.
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        camera.getWorldDirection(new THREE.Vector3()).negate(),
        hit.point
      );
      const target = new THREE.Vector3();
      anchor.position.set(hit.point.x, hit.point.y, hit.point.z);
      const localPivot = body.pointToLocalFrame(new CANNON.Vec3(hit.point.x, hit.point.y, hit.point.z));
      const constraint = new CANNON.PointToPointConstraint(body, localPivot, anchor, new CANNON.Vec3(), 160);
      world.addConstraint(constraint);
      body.wakeUp();

      return {
        move(ray) {
          if (!ray.intersectPlane(plane, target)) return;
          anchor.position.set(
            THREE.MathUtils.clamp(target.x, -bounds.halfWidth, bounds.halfWidth),
            Math.max(target.y, 0.2),
            THREE.MathUtils.clamp(target.z, BACK_Z, FRONT_Z)
          );
          body.wakeUp();
        },
        release() {
          world.removeConstraint(constraint);
          const v = body.velocity;
          const speed = v.length();
          if (speed > MAX_THROW_SPEED) v.scale(MAX_THROW_SPEED / speed, v);
        },
      };
    },

    // Double-click flips a block into the air with a random spin.
    doubleClick(hit) {
      const body = hit.object.userData.body;
      body.wakeUp();
      body.velocity.y += 10;
      body.angularVelocity.set(
        (Math.random() - 0.5) * 24,
        (Math.random() - 0.5) * 24,
        (Math.random() - 0.5) * 24
      );
    },

    update() {
      rescueStrays();
      for (const { mesh, body } of blocks) {
        mesh.position.copy(body.position);
        mesh.quaternion.copy(body.quaternion);
      }
    },

    dispose() {
      for (const { mesh, body } of blocks) {
        scene.remove(mesh);
        mesh.material.forEach((m) => {
          m.map.dispose();
          m.dispose();
        });
        world.removeBody(body);
      }
      world.removeBody(anchor);
    },
  };
}
