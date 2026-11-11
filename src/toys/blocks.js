import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import * as CANNON from "cannon-es";
import { NAME, BACK_Z, FRONT_Z } from "./shared.js";
import { canvasTexture, roundRect, seeded } from "./textures.js";
import { fonts } from "../lib/fonts.js";
import { onToyKeys } from "../scene/keys.js";

// The set's paints: red, blue, green, orange, purple. Every block shows all five.
const LETTER_COLORS = ["#c0392b", "#2c6e9b", "#3f7d4e", "#d08a1e", "#7a4b8c"];
// Which paint each face uses, as a step from the block's front colour, by face
// (+x, -x, +y, -y, front, back). Six faces and five paints, so the back
// matches the front and the other four take the rest.
const FACE_STEP = [1, 2, 3, 4, 0, 0];
// The set's wood (hsl hue and lightness), shared by every face.
const WOOD_HUE = 33;
const WOOD_LIGHT = 69;
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

const boxShape = new CANNON.Box(new CANNON.Vec3(SIZE / 2, SIZE / 2, SIZE / 2));

// ---------- Worn shape ----------

/**
 * A rounded block that's been played with: chips knocked out along its edges
 * and the odd bashed corner. `seed` picks where, so each block wears
 * differently but the same way every visit. Faces still meet exactly, since
 * every vertex moves by a function of where it is.
 */
function wornBlockGeometry(seed) {
  const geo = new RoundedBoxGeometry(SIZE, SIZE, SIZE, 6, SIZE * 0.08);
  const rnd = seeded(seed * 7919 + 3);
  const half = SIZE / 2;

  // Chips: a few per edge at most, each a dent of some length and depth.
  const chips = [];
  for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
    for (const sa of [-1, 1]) {
      for (const sb of [-1, 1]) {
        const count = Math.floor(rnd() * 3); // 0–2
        for (let k = 0; k < count; k++) {
          chips.push({ a, b, sa, sb, t: (rnd() - 0.5) * 0.8 * SIZE, len: 0.06 + rnd() * 0.2, depth: 0.015 + rnd() * 0.045, jag: rnd() * 100 });
        }
      }
    }
  }
  // Corners knocked off now and then.
  const corners = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    if (rnd() < 0.4) corners.push({ s: [sx, sy, sz], depth: 0.025 + rnd() * 0.06 });
  }

  const pos = geo.attributes.position;
  const normal = geo.attributes.normal;
  const original = normal.array.slice();
  const moved = new Uint8Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const q = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const out = [...q];
    const inset = q.map((v) => half - Math.abs(v)); // 0 on a face
    for (const c of chips) {
      if (Math.sign(q[c.a]) !== c.sa || Math.sign(q[c.b]) !== c.sb) continue;
      const reach = c.depth * 2.5;
      const dist = Math.hypot(inset[c.a], inset[c.b]);
      if (dist > reach) continue;
      const along = 3 - c.a - c.b;
      const u = (q[along] - c.t) / (c.len / 2);
      if (Math.abs(u) > 1) continue;
      // Deepest in the middle, ragged along its length.
      const amount = c.depth * (1 - u * u) ** 2 * (1 - dist / reach) ** 2 * (0.7 + 0.3 * Math.sin(q[along] * 90 + c.jag));
      out[c.a] -= c.sa * amount;
      out[c.b] -= c.sb * amount;
      moved[i] = 1;
    }
    for (const c of corners) {
      if (c.s.some((s, a) => Math.sign(q[a]) !== s)) continue;
      const reach = c.depth * 2.2;
      const dist = Math.hypot(...inset);
      if (dist > reach) continue;
      const amount = c.depth * (1 - dist / reach) ** 2;
      for (let a = 0; a < 3; a++) out[a] -= c.s[a] * amount * 0.6;
      moved[i] = 1;
    }
    pos.setXYZ(i, ...out);
  }
  // New normals only where the shape changed, so the untouched rounding keeps
  // its smooth shading.
  geo.computeVertexNormals();
  for (let i = 0; i < pos.count; i++) {
    if (!moved[i]) normal.setXYZ(i, original[i * 3], original[i * 3 + 1], original[i * 3 + 2]);
  }
  return geo;
}

// ---------- Wood texture ----------

/**
 * The wear on one face, as a list of marks, so the colour and bump maps can
 * draw the same ones: scratches (some through to pale fresh wood, some filled
 * with grime), dents, and rubbed spots along the edges.
 */
function wearMarks(rnd, size) {
  const scratches = Array.from({ length: 10 + Math.floor(rnd() * 16) }, () => {
    const x = rnd() * size;
    const y = rnd() * size;
    const angle = rnd() * Math.PI;
    const len = size * (0.03 + rnd() ** 2 * 0.3);
    return {
      x, y, angle, len,
      bend: (rnd() - 0.5) * 0.6,
      w: 0.8 + rnd() * 1.8,
      pale: rnd() < 0.55,
      a: 0.25 + rnd() * 0.45,
      throughPaint: rnd() < 0.3, // only some go deep enough to take the paint off
    };
  });
  const dents = Array.from({ length: 3 + Math.floor(rnd() * 7) }, () => ({
    x: rnd() * size,
    y: rnd() * size,
    r: size * (0.004 + rnd() * 0.011),
    stretch: 1 + rnd() * 2.5,
    angle: rnd() * Math.PI,
  }));
  // Rubbed spots hug the edges.
  const rubs = Array.from({ length: 6 + Math.floor(rnd() * 8) }, () => {
    const side = Math.floor(rnd() * 4);
    const t = rnd() * size;
    const e = rnd() * size * 0.05;
    const [x, y] = [[t, e], [t, size - e], [e, t], [size - e, t]][side];
    return { x, y, r: size * (0.02 + rnd() * 0.06), a: 0.12 + rnd() * 0.2 };
  });
  // Chips of paint flaked off the letter: a few jagged, uneven shapes, mostly
  // small, the odd bigger one.
  const chips = Array.from({ length: 2 + Math.floor(rnd() * 6) }, () => {
    const r = size * (0.006 + rnd() ** 2.5 * 0.035);
    const stretch = 1.2 + rnd() * 1.8;
    const angle = rnd() * Math.PI;
    const sides = 5 + Math.floor(rnd() * 5);
    // Corners at uneven angles and distances, so no two look alike.
    const points = Array.from({ length: sides }, (_, k) => {
      const a = ((k + (rnd() - 0.5) * 0.7) / sides) * Math.PI * 2;
      const d = r * (0.45 + rnd() * 0.55);
      const px = Math.cos(a) * d * stretch;
      const py = Math.sin(a) * d;
      return [px * Math.cos(angle) - py * Math.sin(angle), px * Math.sin(angle) + py * Math.cos(angle)];
    });
    return { x: size * (0.25 + rnd() * 0.5), y: size * (0.22 + rnd() * 0.56), points };
  });
  return { scratches, dents, rubs, chips };
}

function scratchPath(c, m) {
  const dx = Math.cos(m.angle) * m.len;
  const dy = Math.sin(m.angle) * m.len;
  c.beginPath();
  c.moveTo(m.x, m.y);
  c.quadraticCurveTo(m.x + dx / 2 - dy * m.bend * 0.5, m.y + dy / 2 + dx * m.bend * 0.5, m.x + dx, m.y + dy);
}

function dentPath(c, m) {
  c.beginPath();
  c.ellipse(m.x, m.y, m.r * m.stretch, m.r, m.angle, 0, Math.PI * 2);
}

/** Darken the face toward its edges and (more) its corners: handling grime. */
function grime(c, size, strength) {
  for (const [x0, y0, x1, y1] of [[0, 0, size * 0.09, 0], [0, size, 0, size - size * 0.09], [0, 0, 0, size * 0.09], [size, 0, size - size * 0.09, 0]]) {
    const g = c.createLinearGradient(x0, y0, x1 || x0, y1);
    g.addColorStop(0, `rgba(60, 35, 15, ${strength})`);
    g.addColorStop(1, "rgba(60, 35, 15, 0)");
    c.fillStyle = g;
    c.fillRect(0, 0, size, size);
  }
  for (const [x, y] of [[0, 0], [size, 0], [0, size], [size, size]]) {
    const g = c.createRadialGradient(x, y, 0, x, y, size * 0.16);
    g.addColorStop(0, `rgba(50, 28, 12, ${strength * 1.2})`);
    g.addColorStop(1, "rgba(50, 28, 12, 0)");
    c.fillStyle = g;
    c.fillRect(0, 0, size, size);
  }
}

function makeFaceTexture(renderer, letter, color, seed) {
  const anisotropy = renderer.capabilities.getMaxAnisotropy();
  const marks = wearMarks(seeded(seed * 4241 + 7), 512);

  const map = canvasTexture(512, (c, size) => {
    const rnd = seeded(seed * 9973 + 1);

    // Base wood tone: the same on every face of every block, since they're
    // one set from the same wood and finish. Only the grain and wear differ.
    const hue = WOOD_HUE;
    const light = WOOD_LIGHT;
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

    // Painted letter with a subtle carved shadow. The paint is worn: a few
    // chips flaked off and the odd deep scratch through it, so it's drawn on
    // its own layer and worn there before going onto the wood.
    const paint = document.createElement("canvas");
    paint.width = paint.height = size;
    const p = paint.getContext("2d");
    p.font = `${Math.round(size * 0.58)}px ${fonts.letter}`;
    p.textAlign = "center";
    p.textBaseline = "middle";
    const lx = size / 2;
    const ly = size / 2 + size * 0.03;
    p.fillStyle = "rgba(255, 240, 215, 0.5)";
    p.fillText(letter, lx + size * 0.012, ly + size * 0.012);
    p.fillStyle = "rgba(60, 30, 10, 0.35)";
    p.fillText(letter, lx - size * 0.01, ly - size * 0.01);
    p.fillStyle = color;
    p.fillText(letter, lx, ly);
    p.globalCompositeOperation = "destination-out";
    p.fillStyle = "#000";
    for (const chip of marks.chips) {
      p.beginPath();
      for (const [px, py] of chip.points) p.lineTo(chip.x + px, chip.y + py);
      p.closePath();
      p.fill();
    }
    p.strokeStyle = "#000";
    for (const m of marks.scratches) {
      if (!m.throughPaint) continue;
      scratchPath(p, m);
      p.lineWidth = m.w;
      p.stroke();
    }
    c.drawImage(paint, 0, 0);

    // Handling: grime toward the edges, rubbed-pale spots along them.
    grime(c, size, 0.28);
    for (const m of marks.rubs) {
      const g = c.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r);
      g.addColorStop(0, `rgba(250, 232, 205, ${m.a})`);
      g.addColorStop(1, "rgba(250, 232, 205, 0)");
      c.fillStyle = g;
      c.fillRect(m.x - m.r, m.y - m.r, m.r * 2, m.r * 2);
    }
    // Scratches: pale where they cut to fresh wood, dark where grime filled them.
    for (const m of marks.scratches) {
      scratchPath(c, m);
      c.lineWidth = m.w;
      c.strokeStyle = m.pale ? `rgba(255, 238, 210, ${m.a})` : `rgba(70, 40, 18, ${m.a})`;
      c.stroke();
    }
    // Dents: a dark pit with a pale rim on the lit side.
    for (const m of marks.dents) {
      dentPath(c, m);
      c.fillStyle = "rgba(80, 45, 20, 0.28)";
      c.fill();
      c.save();
      c.translate(-m.r * 0.35, -m.r * 0.35);
      dentPath(c, m);
      c.strokeStyle = "rgba(255, 238, 210, 0.4)";
      c.lineWidth = 1;
      c.stroke();
      c.restore();
    }
  }, { anisotropy });

  // Bump: scratches and dents cut into the surface (darker is lower).
  const bumpMap = canvasTexture(512, (c, size) => {
    c.fillStyle = "rgb(200, 200, 200)";
    c.fillRect(0, 0, size, size);
    for (const m of marks.scratches) {
      scratchPath(c, m);
      c.lineWidth = m.w + 0.5;
      c.strokeStyle = `rgba(40, 40, 40, ${0.5 + m.a})`;
      c.stroke();
    }
    for (const m of marks.dents) {
      dentPath(c, m);
      c.fillStyle = "rgba(30, 30, 30, 0.8)";
      c.fill();
    }
  }, { anisotropy, color: false });

  return { map, bumpMap };
}

// ---------- Toy ----------

export function createBlocks({ scene, world, camera, renderer, bounds }) {
  if (!world.contactmaterials.includes(blockOnBlock)) world.addContactMaterial(blockOnBlock);

  function makeBlock(letter, index) {
    // Face order: +x, -x, +y, -y, +z (front), -z. Same letter on every face so
    // the name still reads however a block lands; colours rotate across faces.
    const materials = [0, 1, 2, 3, 4, 5].map((face) => {
      const color = LETTER_COLORS[(index + FACE_STEP[face]) % LETTER_COLORS.length];
      const { map, bumpMap } = makeFaceTexture(renderer, letter, color, index * 6 + face + 1);
      return new THREE.MeshStandardMaterial({ map, bumpMap, bumpScale: 1.5, roughness: 0.7, metalness: 0 });
    });
    const mesh = new THREE.Mesh(wornBlockGeometry(index + 1), materials);
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

  /** Drop the blocks in from above, in a row spelling the name (one after another). */
  function drop() {
    const startX = -NAME_WIDTH / 2 + SIZE / 2;
    blocks.forEach(({ body }, i) => {
      body.position.set(startX + i * (SIZE + GAP), 5 + i * 0.9, 0);
      body.quaternion.setFromEuler(
        (Math.random() - 0.5) * 0.15,
        (Math.random() - 0.5) * 0.15,
        (Math.random() - 0.5) * 0.15
      );
      body.velocity.setZero();
      body.angularVelocity.setZero();
      body.wakeUp();
    });
  }
  drop();

  /** Toss every block up a little, tumbling. */
  function toss() {
    for (const { body } of blocks) {
      body.wakeUp();
      body.velocity.y += 5 + Math.random() * 3;
      body.velocity.x += (Math.random() - 0.5) * 2;
      body.angularVelocity.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
    }
  }

  // Keyboard: Space tosses the blocks, R drops them in again to spell the name.
  const stopKeys = onToyKeys((key, e) => {
    if (key !== " " && key !== "r") return false;
    if (!e.repeat) (key === " " ? toss : drop)();
    return true;
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

    // Returns false once every block has fallen asleep (nothing to redraw).
    update() {
      rescueStrays();
      let moving = false;
      for (const { mesh, body } of blocks) {
        mesh.position.copy(body.position);
        mesh.quaternion.copy(body.quaternion);
        if (body.sleepState !== CANNON.Body.SLEEPING) moving = true;
      }
      return moving;
    },

    dispose() {
      stopKeys();
      for (const { mesh, body } of blocks) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.forEach((m) => {
          m.map.dispose();
          m.bumpMap.dispose();
          m.dispose();
        });
        world.removeBody(body);
      }
      world.removeBody(anchor);
    },
  };
}
