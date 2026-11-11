import * as THREE from "three";
import { canvasTexture, noisyFill } from "./textures.js";
import { fonts } from "../lib/fonts.js";

// Old, worn silver and its ornamental hardware, shared by the toys (the
// drawing board's easel, the Newton's cradle frame).
//
// createSilver({ envMap, track }) gives the materials plus builders:
//   chromeMat / flutedMat / bandMat   plain worn silver, polished fluted ribs
//                                     with dark grooves, the engraved band
//   box(w, h, d)       a silver box with even-sized scratches on every face
//   rod(r, length)     a silver cylinder (along y), likewise
//   finial(scale)      a crown finial standing on y = 0
//   stud()             a small fluted stud standing on y = 0
//   bake(root)         call once everything is built and placed (see bakeSilver)
// Everything it makes is passed to `track` for disposal.

const rand = Math.random;

// The band's engraving, in blackletter.
const BAND_TEXT = "Calvin";
const BAND_FONT = '"UnifrakturMaguntia"'; // loaded with the site's Google Fonts

/**
 * The fine detail of old silver: hazed all over with scratches (a
 * dense grain of short ones running roughly one way, plus longer stray ones).
 * Returns a colour map and a matching roughness map, where scratches are
 * duller than the metal. It's small enough to tile unnoticed; the tarnish is
 * added on top by silverShader.
 */
function silverTextures() {
  const S = 1024;
  const marks = []; // (the big tarnish patches come from silverShader, so they never repeat)
  // Grain: thousands of short scratches, hatched in two close directions.
  const grain = (rand() - 0.5) * 0.4;
  for (let i = 0; i < 7000; i++) {
    marks.push({
      x: rand() * S,
      y: rand() * S,
      len: 4 + rand() * 26,
      angle: grain + (i % 2 ? 0.35 : -0.25) + (rand() - 0.5) * 0.5,
      arc: 0,
      dark: rand() < 0.35,
      a: 0.04 + rand() * 0.12,
      w: 0.6 + rand() * 0.5,
    });
  }
  // Longer stray scratches, some curving.
  for (let i = 0; i < 260; i++) {
    marks.push({
      x: rand() * S,
      y: rand() * S,
      len: 40 + rand() ** 2 * 360,
      angle: rand() * Math.PI,
      arc: rand() < 0.4 ? (rand() - 0.5) * 0.006 : 0,
      dark: rand() < 0.4,
      a: 0.06 + rand() * 0.16,
      w: 0.5 + rand() * 0.6,
    });
  }

  function scratchPath(c, m) {
    c.beginPath();
    c.moveTo(m.x, m.y);
    let { x, y, angle } = m;
    const step = Math.min(12, m.len);
    for (let d = 0; d < m.len; d += step) {
      angle += m.arc * step;
      x += Math.cos(angle) * step;
      y += Math.sin(angle) * step;
      c.lineTo(x, y);
    }
  }

  // The texture repeats, so a mark running off one edge carries on from the
  // opposite one: draw it again shifted by a tile wherever it overhangs.
  function wrapped(m, reach, draw) {
    for (const dx of [-S, 0, S]) {
      for (const dy of [-S, 0, S]) {
        const x = m.x + dx;
        const y = m.y + dy;
        if (x + reach < 0 || x - reach > S || y + reach < 0 || y - reach > S) continue;
        draw({ ...m, x, y });
      }
    }
  }

  const map = canvasTexture(S, (c) => {
    noisyFill(c, S, S, "#74767a", 12);
    for (const m of marks) {
      c.strokeStyle = m.dark ? `rgba(18, 18, 20, ${m.a})` : `rgba(215, 220, 226, ${m.a})`;
      c.lineWidth = m.w;
      wrapped(m, m.len, (w) => {
        scratchPath(c, w);
        c.stroke();
      });
    }
  });
  const roughnessMap = canvasTexture(
    S,
    (c) => {
      noisyFill(c, S, S, "rgb(115, 115, 115)", 16); // satin, not mirror
      for (const m of marks) {
        c.strokeStyle = `rgba(185, 185, 185, ${m.a * 1.5})`;
        c.lineWidth = m.w + 0.4;
        wrapped(m, m.len, (w) => {
          scratchPath(c, w);
          c.stroke();
        });
      }
    },
    { color: false }
  );
  for (const t of [map, roughnessMap]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return { map, roughnessMap };
}

// Tarnish for the old silver, worked out per pixel from where it is on the
// piece (the `aSilver` attribute, see bakeSilver) with layered 3D noise, so it
// never repeats and runs on unbroken round corners. Dark, slightly warm
// patches build up in broad clouds with finer mottling inside them, and are
// duller as well as darker; a few spots are rubbed brighter. `seed` moves the
// pattern, so every visit is a little different.
export function silverShader(material, seed) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSeed = { value: seed };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 aSilver;\nvarying vec3 vSilver;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSilver = aSilver;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform vec3 uSeed;
        varying vec3 vSilver;
        float silverHash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float silverNoise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(silverHash(i), silverHash(i + vec3(1, 0, 0)), f.x),
                mix(silverHash(i + vec3(0, 1, 0)), silverHash(i + vec3(1, 1, 0)), f.x), f.y),
            mix(mix(silverHash(i + vec3(0, 0, 1)), silverHash(i + vec3(1, 0, 1)), f.x),
                mix(silverHash(i + vec3(0, 1, 1)), silverHash(i + vec3(1, 1, 1)), f.x), f.y),
            f.z);
        }
        float silverFbm(vec3 p) {
          float sum = 0.0;
          float amp = 0.5;
          for (int i = 0; i < 5; i++) {
            sum += amp * silverNoise(p);
            p = p * 2.07 + vec3(1.7, 9.2, 3.1);
            amp *= 0.5;
          }
          return sum;
        }`
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        vec3 sp = vSilver + uSeed;
        float cloud = silverFbm(sp * 0.9);
        float mottle = silverFbm(sp * 5.0 + 11.0);
        float tarnish = smoothstep(0.3, 0.8, cloud * 0.8 + mottle * 0.25);
        float rubbed = smoothstep(0.62, 0.8, silverFbm(sp * 1.6 + 37.0));
        diffuseColor.rgb *= mix(vec3(1.0), vec3(0.55, 0.5, 0.44), tarnish * 0.75);
        diffuseColor.rgb *= 1.0 + rubbed * 0.22 * (1.0 - tarnish);`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + tarnish * 0.22 - rubbed * 0.1, 0.05, 1.0);`
      );
  };
}

/**
 * A fluted crown dome: a bulb that swells out from its base and closes to a
 * point, with `flutes` rounded ribs running up it. The grooves between ribs
 * are darkened through vertex colours, like blackened, unpolished recesses.
 * Stands on y = 0, `height` tall.
 */
function flutedDome(radius, height, flutes = 8) {
  const U = 96;
  const V = 28;
  const pos = [];
  const col = [];
  const uv = [];
  const index = [];
  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  for (let j = 0; j <= V; j++) {
    const v = j / V;
    const bulge = Math.sqrt(Math.max(0, 1 - v ** 2.4)) * (1 + 0.32 * Math.sin(Math.PI * Math.min(1, v * 1.15)));
    const depth = Math.sin(Math.PI * Math.min(1, 0.06 + v * 0.97)) ** 0.6; // ribs fade out at the base and tip
    for (let i = 0; i <= U; i++) {
      const angle = (i / U) * Math.PI * 2;
      const ridge = Math.abs(Math.cos((angle * flutes) / 2)) ** 0.7; // 1 on a rib, 0 in a groove
      const r = radius * bulge * (1 - 0.24 * depth * (1 - ridge));
      pos.push(Math.cos(angle) * r, height * v, Math.sin(angle) * r);
      // Near-black well up the sides of each groove, so the polished ribs stand out.
      const shade = 1 - depth * 0.985 * (1 - smooth(0.22, 0.82, ridge));
      col.push(shade, shade, shade);
      uv.push((i / U) * 2, v);
      if (i < U && j < V) {
        const a = j * (U + 1) + i;
        const b = a + U + 1;
        index.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

// The engraved band round each finial: blackened, with "Calvin" in
// blackletter and small diamond ornaments left in bright silver.
function drawBand(c, w, h, family) {
  noisyFill(c, w, h, "#17171a", 10);
  c.fillStyle = "#c4c7cc";
  c.fillRect(0, 0, w, h * 0.07);
  c.fillRect(0, h * 0.93, w, h * 0.07);
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.font = `${h * 0.74}px ${family}`;
  const diamond = (x, r) => {
    c.beginPath();
    c.moveTo(x, h / 2 - r);
    c.quadraticCurveTo(x + r * 0.2, h / 2 - r * 0.2, x + r, h / 2);
    c.quadraticCurveTo(x + r * 0.2, h / 2 + r * 0.2, x, h / 2 + r);
    c.quadraticCurveTo(x - r * 0.2, h / 2 + r * 0.2, x - r, h / 2);
    c.quadraticCurveTo(x - r * 0.2, h / 2 - r * 0.2, x, h / 2 - r);
    c.fill();
  };
  for (const start of [0, w / 2]) {
    diamond(start + w * 0.045, h * 0.3);
    diamond(start + w * 0.115, h * 0.2);
    diamond(start + w * 0.185, h * 0.3);
    c.fillText(BAND_TEXT, start + w * 0.345, h * 0.52);
  }
}

/**
 * Record where each vertex of `parent`'s silver parts sits (in `parent`'s
 * space) for silverShader, so the tarnish flows across the parts as one piece
 * of metal and stays put on moving parts (like a spinning board).
 */
export function bakeSilver(parent, materials) {
  parent.updateMatrixWorld(true);
  const toParent = new THREE.Matrix4();
  const inverse = new THREE.Matrix4().copy(parent.matrixWorld).invert();
  const v = new THREE.Vector3();
  parent.traverse((mesh) => {
    if (!mesh.isMesh || !materials.includes(mesh.material)) return;
    toParent.multiplyMatrices(inverse, mesh.matrixWorld);
    const pos = mesh.geometry.attributes.position;
    const out = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(toParent);
      out.set([v.x, v.y, v.z], i * 3);
    }
    mesh.geometry.setAttribute("aSilver", new THREE.BufferAttribute(out, 3));
  });
}

const CHROME_TILE = 1.1; // world units the scratch texture covers before repeating

/**
 * Give a box world-sized UVs, so the silver's scratches are the same size on
 * every face (rather than one texture squashed onto each long, thin side).
 */
export function worldUVs(geo, w, h, d) {
  const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // BoxGeometry's ±x, ±y, ±z
  const uv = geo.attributes.uv;
  faces.forEach(([fu, fv], face) => {
    // Each face starts somewhere random, so no two line up.
    const ou = rand();
    const ov = rand();
    for (let i = face * 4; i < face * 4 + 4; i++) {
      uv.setXY(i, ou + (uv.getX(i) * fu) / CHROME_TILE, ov + (uv.getY(i) * fv) / CHROME_TILE);
    }
  });
  return geo;
}

/** Scale a geometry's UVs so its scratches come out `u` by `v` tiles. */
function scaleUVs(geo, u, v) {
  const uv = geo.attributes.uv;
  const ou = rand();
  const ov = rand();
  for (let i = 0; i < uv.count; i++) uv.setXY(i, ou + uv.getX(i) * u, ov + uv.getY(i) * v);
  return geo;
}

/**
 * The silver materials and builders (see the top of this file). `onRedraw`
 * runs if the band's engraving is redrawn once its font arrives.
 */
export function createSilver({ envMap, track, onRedraw = () => {} }) {
  const textures = silverTextures();
  track(textures.map);
  track(textures.roughnessMap);
  const seed = new THREE.Vector3(rand() * 100, rand() * 100, rand() * 100);
  const materials = [];
  const silver = (options) => {
    const material = track(
      new THREE.MeshStandardMaterial({
        map: textures.map,
        roughnessMap: textures.roughnessMap,
        roughness: 1, // scaled by the map
        metalness: 0.8,
        envMap,
        envMapIntensity: 0.55, // a soft sheen rather than a mirror
        ...options,
      })
    );
    silverShader(material, seed);
    materials.push(material);
    return material;
  };
  const chromeMat = silver();
  // Fluted pieces: polished bright on the ribs, dark in the grooves.
  const flutedMat = silver({ vertexColors: true, roughnessMap: null, roughness: 0.3, metalness: 0.95, envMapIntensity: 1.1 });
  const bandTex = track(canvasTexture(1024, (c, w, h) => drawBand(c, w, h, fonts.letter), { height: 96 }));
  const bandMat = silver({ map: bandTex });
  // The blackletter font may still be on its way: redraw the bands when it lands.
  document.fonts
    ?.load(`60px ${BAND_FONT}`)
    .then(() => {
      if (!document.fonts.check(`60px ${BAND_FONT}`)) return;
      drawBand(bandTex.image.getContext("2d"), 1024, 96, BAND_FONT);
      bandTex.needsUpdate = true;
      onRedraw();
    })
    .catch(() => {});

  const mesh = (geo, mat) => {
    const m = new THREE.Mesh(track(geo), mat);
    m.castShadow = true;
    return m;
  };

  // A crown finial: a flared foot, the engraved band between two beaded
  // rings, then the fluted dome with a nub on its tip.
  const footGeo = new THREE.LatheGeometry(
    [[0, 0], [0.135, 0], [0.152, 0.018], [0.152, 0.045], [0.132, 0.068], [0.132, 0.075]].map(([x, y]) => new THREE.Vector2(x, y)),
    40
  );
  const bandGeo = new THREE.CylinderGeometry(0.129, 0.129, 0.075, 48, 1, true);
  const beadGeo = new THREE.TorusGeometry(0.131, 0.013, 10, 48);
  const domeGeo = flutedDome(0.125, 0.27);
  const nubGeo = new THREE.SphereGeometry(0.03, 16, 10);
  const studGeo = flutedDome(0.072, 0.05, 6);
  for (const geo of [footGeo, bandGeo, beadGeo, domeGeo, nubGeo, studGeo]) track(geo);
  // (Each part gets its own copy of the geometry, since bakeSilver writes to it.)
  const part = (geo, mat, y = 0) => {
    const m = mesh(geo.clone(), mat);
    m.position.y = y;
    return m;
  };

  return {
    chromeMat,
    flutedMat,
    bandMat,
    materials,

    box(w, h, d) {
      return mesh(worldUVs(new THREE.BoxGeometry(w, h, d), w, h, d), chromeMat);
    },

    rod(radius, length, segments = 20) {
      const geo = new THREE.CylinderGeometry(radius, radius, length, segments);
      return mesh(scaleUVs(geo, (Math.PI * 2 * radius) / CHROME_TILE, length / CHROME_TILE), chromeMat);
    },

    finial(scale) {
      const group = new THREE.Group();
      const beads = [0.078, 0.158].map((y) => {
        const bead = part(beadGeo, chromeMat, y);
        bead.rotation.x = Math.PI / 2;
        return bead;
      });
      group.add(part(footGeo, chromeMat), part(bandGeo, bandMat, 0.118), ...beads, part(domeGeo, flutedMat, 0.16), part(nubGeo, chromeMat, 0.432));
      group.scale.setScalar(scale);
      return group;
    },

    /** A beaded ring (a collar round a post), lying flat, radius `r`. */
    bead(r, thickness = 0.013) {
      const ring = mesh(new THREE.TorusGeometry(r, thickness, 10, 40), chromeMat);
      ring.rotation.x = Math.PI / 2;
      return ring;
    },

    stud() {
      return part(studGeo, flutedMat);
    },

    bake(root) {
      bakeSilver(root, materials);
    },
  };
}
