import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { gsap } from "gsap";
import { NAME } from "./shared.js";
import { canvasTexture, fitText } from "./textures.js";
import { PLAYLISTS } from "../../playlists.js";
import { music } from "../music/music.js";
import { openTrackList } from "../music/tracklist.js";
import { reduceMotion } from "../settings.js";
import { fonts } from "../lib/fonts.js";
import { formatLength } from "../lib/format.js";

// Portable CD player (round, Discman-style) propped up facing the viewer, with
// a row of CD cases beside it, one per playlist. Click a case to load its disc;
// the buttons on the lid play/pause and stop. Audio comes from music.js.

const R = 1.45; // player radius
const BODY_H = 0.36;
const LID_H = 0.1;
const WINDOW_R = 0.72; // smoky window in the lid
const DISC_R = 0.92;
const HOLE_R = 0.1;
const TILT = 1.15; // radians the player leans back toward the camera
const PLAYER_X = 0; // centred; the CD shelf sits to its right
const LID_OPEN = 1.9; // radians the lid swings open
const SPIN_SPEED = 9; // disc rad/s while playing

const CASE_SIZE = 1.1;
const CASE_DEPTH = 0.1;

// Shelf of CD cases: two columns, a row per two playlists, first one top-left.
const SHELF_COLS = 2;
const CASE_GAP = 0.14; // between cases in a row
const PLANK = 0.06; // shelf board thickness
const ROW_HEIGHT = CASE_SIZE + 0.16 + PLANK; // case + headroom + board
const SHELF_DEPTH = 0.55;
const SHELF_LEFT = R + 0.55; // left edge, clear of the player
const SHELF_PAD = 0.12; // inside the side posts
const PULL_OUT = 0.35; // how far the loaded CD's case slides forward

// ---------- Canvas textures ----------

// Lid: brushed silver ring with "CALVIN" printed on it and a see-through window.
// CircleGeometry maps the texture across its diameter; after laying it flat the
// bottom of the texture is the front edge.
function lidTexture({ printed = true } = {}) {
  return canvasTexture(1024, (c, s) => {
    const mid = s / 2;
    const ring = c.createRadialGradient(mid * 0.8, mid * 0.7, 0, mid, mid, mid);
    ring.addColorStop(0, "#d3d6db");
    ring.addColorStop(1, "#9ea3ab");
    c.fillStyle = ring;
    c.beginPath();
    c.arc(mid, mid, mid, 0, Math.PI * 2);
    c.fill();

    // Fine circular brushing.
    for (let r = mid * 0.72; r < mid; r += 3) {
      c.strokeStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.08})`;
      c.beginPath();
      c.arc(mid, mid, r, 0, Math.PI * 2);
      c.stroke();
    }

    // Window: cut out, then tint smoky.
    const w = (WINDOW_R / R) * mid;
    c.globalCompositeOperation = "destination-out";
    c.beginPath();
    c.arc(mid, mid, w, 0, Math.PI * 2);
    c.fill();
    c.globalCompositeOperation = "source-over";
    c.fillStyle = "rgba(25, 25, 32, 0.38)";
    c.fill();
    c.lineWidth = 6;
    c.strokeStyle = "rgba(60, 62, 70, 0.6)";
    c.stroke();

    if (!printed) return; // underside: plain

    // Branding on the front of the ring.
    c.fillStyle = "#2b2d33";
    c.textAlign = "center";
    c.textBaseline = "middle";
    const band = mid - w; // ring width between window and edge
    fitText(c, NAME, mid, mid + w + band * 0.36, mid * 0.5, 72, fonts.letter);
    c.fillStyle = "#4b4f57";
    fitText(c, "PORTABLE CD PLAYER", mid, mid + w + band * 0.66, mid * 0.62, 30, fonts.ui);
  });
}

function buttonTexture(icon) {
  return canvasTexture(256, (c, s) => {
    c.fillStyle = "#2b2d33";
    c.fillRect(0, 0, s, s);
    c.fillStyle = "#e9eaec";
    const m = s / 2;
    // A cylinder's top face maps its texture a quarter-turn round; pre-rotate.
    c.translate(m, m);
    c.rotate(-Math.PI / 2);
    c.translate(-m, -m);
    if (icon === "toggle") {
      // ▶❚❚
      c.beginPath();
      c.moveTo(m - 62, m - 34);
      c.lineTo(m - 10, m);
      c.lineTo(m - 62, m + 34);
      c.fill();
      c.fillRect(m + 6, m - 34, 18, 68);
      c.fillRect(m + 40, m - 34, 18, 68);
    } else if (icon === "list") {
      // Three bulleted lines.
      for (const dy of [-30, 0, 30]) {
        c.beginPath();
        c.arc(m - 44, m + dy, 9, 0, Math.PI * 2);
        c.fill();
        c.fillRect(m - 22, m + dy - 7, 76, 14);
      }
    } else {
      c.fillRect(m - 32, m - 32, 64, 64); // ■
    }
  });
}

// Printed side of a CD.
function labelTexture(playlist) {
  return canvasTexture(1024, (c, s) => {
    const mid = s / 2;
    c.fillStyle = playlist.color;
    c.beginPath();
    c.arc(mid, mid, mid, 0, Math.PI * 2);
    c.fill();
    // Clear plastic hub around the hole.
    c.fillStyle = "rgba(225, 228, 232, 0.9)";
    c.beginPath();
    c.arc(mid, mid, mid * 0.24, 0, Math.PI * 2);
    c.fill();

    c.fillStyle = "#ffffff";
    c.textAlign = "center";
    c.textBaseline = "middle";
    fitText(c, playlist.title, mid, mid * 0.52, s * 0.62, 110, fonts.letter);
    c.globalAlpha = 0.85;
    fitText(c, playlist.subtitle ?? "", mid, mid * 0.72, s * 0.55, 36, fonts.ui);
    fitText(c, `${NAME} · MIX`, mid, mid * 1.55, s * 0.4, 34, fonts.ui);
  });
}

// Front cover of a CD case.
function coverTexture(playlist) {
  const tracks = music.tracksFor(playlist);
  const length = tracks.reduce((total, t) => total + t.duration, 0);
  return canvasTexture(1024, (c, s) => {
    c.fillStyle = playlist.color;
    c.fillRect(0, 0, s, s);
    // A big faint disc as artwork.
    c.strokeStyle = "rgba(255,255,255,0.18)";
    c.lineWidth = 3;
    for (let r = 120; r < 520; r += 26) {
      c.beginPath();
      c.arc(s * 0.72, s * 0.62, r, 0, Math.PI * 2);
      c.stroke();
    }
    c.fillStyle = "#ffffff";
    c.textAlign = "left";
    c.textBaseline = "top";
    fitText(c, playlist.title, 70, 90, s - 140, 150, fonts.letter);
    c.globalAlpha = 0.85;
    fitText(c, playlist.subtitle ?? "", 74, 270, s - 150, 44, fonts.ui);
    c.textBaseline = "bottom";
    // Total running time in the bottom corner (left blank if the track list
    // couldn't be fetched).
    if (length) fitText(c, formatLength(length), 74, s - 70, s * 0.6, 58, fonts.ui);
  });
}

// ---------- Toy ----------

export function createCdPlayer({ scene, renderer }) {
  const root = new THREE.Group();
  scene.add(root);

  const disposables = [];
  const track = (thing) => (disposables.push(thing), thing);

  // Something for the silver and the disc's underside to reflect.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = track(pmrem.fromScene(new RoomEnvironment(), 0.04).texture);
  pmrem.dispose();

  // Toned down: the studio reflection plus the scene lights wash bright silver out to white.
  const silver = track(
    new THREE.MeshStandardMaterial({ color: 0xaeb3ba, metalness: 0.55, roughness: 0.32, envMap, envMapIntensity: 0.45 })
  );
  const darkPlastic = track(new THREE.MeshStandardMaterial({ color: 0x24252b, roughness: 0.5 }));

  // ----- Player -----
  const player = new THREE.Group();
  player.position.x = PLAYER_X;
  player.rotation.x = TILT; // top face leans toward the camera
  root.add(player);

  const body = new THREE.Mesh(track(new THREE.CylinderGeometry(R, R * 0.98, BODY_H, 96)), silver);
  player.add(body);

  const well = new THREE.Mesh(track(new THREE.CircleGeometry(R * 0.96, 96)), darkPlastic);
  well.rotation.x = -Math.PI / 2;
  well.position.y = BODY_H / 2 + 0.002;
  player.add(well);

  const spindle = new THREE.Mesh(track(new THREE.CylinderGeometry(0.085, 0.085, 0.06, 24)), silver);
  spindle.position.y = BODY_H / 2 + 0.03;
  player.add(spindle);

  const tray = new THREE.Object3D(); // where a loaded disc sits
  tray.position.y = BODY_H / 2 + 0.035;
  player.add(tray);

  // Lid, hinged along the back edge.
  const lid = new THREE.Group();
  lid.position.set(0, BODY_H / 2, -R);
  player.add(lid);

  const lidTop = new THREE.Mesh(
    track(new THREE.CircleGeometry(R, 96)),
    track(new THREE.MeshStandardMaterial({ map: track(lidTexture()), color: 0xb4b8bf, transparent: true, metalness: 0.3, roughness: 0.35, envMap, envMapIntensity: 0.4 }))
  );
  lidTop.rotation.x = -Math.PI / 2;
  lidTop.position.set(0, LID_H, R);
  lidTop.userData.action = "toggle";
  lid.add(lidTop);

  // Plain underside, seen when the lid swings open.
  const lidUnder = new THREE.Mesh(
    lidTop.geometry,
    track(new THREE.MeshStandardMaterial({ map: track(lidTexture({ printed: false })), color: 0x9a9ea6, transparent: true, roughness: 0.5 }))
  );
  lidUnder.rotation.x = Math.PI / 2;
  lidUnder.position.set(0, 0.002, R);
  lid.add(lidUnder);

  const lidSide = new THREE.Mesh(track(new THREE.CylinderGeometry(R, R, LID_H, 96, 1, true)), silver);
  lidSide.position.set(0, LID_H / 2, R);
  lid.add(lidSide);

  // Play/pause and stop on the ring either side of the name; song list up top.
  const buttonGeo = track(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 32));
  const ringR = (R + WINDOW_R) / 2;
  const buttons = [
    ["toggle", -2.45],
    ["stop", -0.69],
    ["list", 0.69], // upper right of the ring
  ].map(([action, angle]) => {
    const top = track(new THREE.MeshStandardMaterial({ map: track(buttonTexture(action)), roughness: 0.4 }));
    const button = new THREE.Mesh(buttonGeo, [darkPlastic, top, darkPlastic]);
    button.position.set(Math.cos(angle) * ringR, LID_H + 0.025, R - Math.sin(angle) * ringR);
    button.userData.action = action;
    button.userData.restY = button.position.y;
    lid.add(button);
    return button;
  });

  // ----- Disc -----
  const discGeo = track(new THREE.RingGeometry(HOLE_R, DISC_R, 96));
  const labelMat = track(new THREE.MeshStandardMaterial({ roughness: 0.45 }));
  const shinyMat = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xe8e8ec,
      metalness: 0.9,
      roughness: 0.12,
      iridescence: 1,
      iridescenceIOR: 1.6,
      iridescenceThicknessRange: [180, 700],
      envMap,
    })
  );
  const disc = new THREE.Group();
  const discTop = new THREE.Mesh(discGeo, labelMat);
  discTop.rotation.x = -Math.PI / 2;
  const discBottom = new THREE.Mesh(discGeo, shinyMat);
  discBottom.rotation.x = Math.PI / 2;
  disc.add(discTop, discBottom);
  disc.visible = false;
  tray.add(disc);

  const labels = new Map(); // playlist → texture, made on first use
  function setDiscLabel(playlist) {
    if (!labels.has(playlist)) labels.set(playlist, track(labelTexture(playlist)));
    labelMat.map = labels.get(playlist);
    labelMat.needsUpdate = true;
  }

  // ----- CD cases -----
  const cols = Math.min(SHELF_COLS, PLAYLISTS.length);
  const rows = Math.ceil(PLAYLISTS.length / cols);
  const innerWidth = cols * CASE_SIZE + (cols - 1) * CASE_GAP;
  const shelfWidth = innerWidth + SHELF_PAD * 2;
  const shelfHeight = rows * ROW_HEIGHT + PLANK;
  const shelfCenterX = SHELF_LEFT + shelfWidth / 2;

  // Wooden shelf unit: a board under each row and one on top, plus side posts.
  const wood = track(new THREE.MeshStandardMaterial({ color: 0xc49a6c, roughness: 0.7 }));
  const boardGeo = track(new THREE.BoxGeometry(shelfWidth + PLANK * 2, PLANK, SHELF_DEPTH));
  const postGeo = track(new THREE.BoxGeometry(PLANK, shelfHeight, SHELF_DEPTH));
  for (let r = 0; r <= rows; r++) {
    const board = new THREE.Mesh(boardGeo, wood);
    board.position.set(shelfCenterX, r * ROW_HEIGHT + PLANK / 2, 0);
    root.add(board);
  }
  for (const x of [SHELF_LEFT - PLANK / 2, SHELF_LEFT + shelfWidth + PLANK / 2]) {
    const post = new THREE.Mesh(postGeo, wood);
    post.position.set(x, shelfHeight / 2, 0);
    root.add(post);
  }

  const caseGeo = track(new RoundedBoxGeometry(CASE_SIZE, CASE_SIZE, CASE_DEPTH, 2, 0.02));
  const cases = PLAYLISTS.map((playlist, i) => {
    const cover = track(new THREE.MeshStandardMaterial({ map: track(coverTexture(playlist)), roughness: 0.25 }));
    // Face order: +x, -x, +y, -y, +z (front), -z.
    const mesh = new THREE.Mesh(caseGeo, [darkPlastic, darkPlastic, darkPlastic, darkPlastic, cover, darkPlastic]);
    const col = i % cols;
    const row = rows - 1 - Math.floor(i / cols); // first playlist on the top row
    mesh.position.set(
      SHELF_LEFT + SHELF_PAD + CASE_SIZE / 2 + col * (CASE_SIZE + CASE_GAP),
      row * ROW_HEIGHT + PLANK + CASE_SIZE / 2,
      0.05
    );
    mesh.rotation.y = -0.12; // angled slightly toward the player
    mesh.userData.action = "case";
    mesh.userData.playlist = playlist;
    mesh.userData.restZ = mesh.position.z;
    root.add(mesh);
    return mesh;
  });

  root.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });

  // Stand the player on its lower edge.
  player.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(player);
  player.position.y -= bounds.min.y;

  // ----- Loading a disc -----
  let loaded = null; // playlist whose disc is in the player
  let busy = false;
  let timeline = null;

  // The loaded CD's case slides forward off its shelf.
  function liftCase(playlist) {
    for (const mesh of cases) {
      const z = mesh.userData.restZ + (mesh.userData.playlist === playlist ? PULL_OUT : 0);
      if (reduceMotion()) mesh.position.z = z;
      else gsap.to(mesh.position, { z, duration: 0.35, ease: "power2.out" });
    }
  }

  function placeInstantly(playlist) {
    loaded = playlist;
    setDiscLabel(playlist);
    tray.attach(disc);
    disc.position.set(0, 0, 0);
    disc.quaternion.identity();
    disc.scale.setScalar(1);
    disc.visible = true;
    lid.rotation.x = 0;
    liftCase(playlist);
  }

  function loadDisc(caseMesh) {
    const playlist = caseMesh.userData.playlist;
    if (busy) return;
    if (playlist === loaded) {
      music.play(playlist); // resume if it was stopped
      return;
    }
    if (reduceMotion()) {
      placeInstantly(playlist);
      music.play(playlist);
      return;
    }

    busy = true;
    liftCase(playlist);
    const from = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    const to = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    const flight = { t: 0 };

    const tl = (timeline = gsap.timeline({ onComplete: () => (busy = false) }));
    tl.to(lid.rotation, { x: -LID_OPEN, duration: 0.4, ease: "power2.out" });
    if (loaded) tl.to(disc.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.2, ease: "power2.in" });
    tl.call(() => {
      loaded = playlist;
      setDiscLabel(playlist);
      // Disc starts at the case, facing out like the cover.
      caseMesh.updateMatrixWorld();
      caseMesh.getWorldPosition(from.pos);
      from.pos.add(new THREE.Vector3(0, 0, CASE_DEPTH).applyQuaternion(caseMesh.quaternion));
      from.quat.copy(caseMesh.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)));
      tray.getWorldPosition(to.pos);
      tray.getWorldQuaternion(to.quat);
      root.attach(disc);
      disc.position.copy(from.pos);
      disc.quaternion.copy(from.quat);
      disc.scale.setScalar(1);
      disc.visible = true;
      flight.t = 0;
    });
    // Arc over to the player, turning to lie in the tray.
    tl.to(flight, {
      t: 1,
      duration: 0.75,
      ease: "power2.inOut",
      onUpdate: () => {
        disc.position.lerpVectors(from.pos, to.pos, flight.t);
        disc.position.y += Math.sin(Math.PI * flight.t) * 1.1;
        disc.quaternion.slerpQuaternions(from.quat, to.quat, flight.t);
      },
    });
    tl.call(() => {
      tray.attach(disc);
      disc.position.set(0, 0, 0);
      disc.quaternion.identity();
    });
    tl.to(lid.rotation, { x: 0, duration: 0.45, ease: "bounce.out" });

    // Start the music now rather than when the disc lands: it takes a moment to
    // buffer, and browsers only allow sound straight after a click. (After
    // busy is set, so our own listener doesn't snap the disc into place.)
    music.play(playlist);
  }

  function press(button) {
    if (reduceMotion()) return;
    gsap.fromTo(button.position, { y: button.userData.restY - 0.03 }, { y: button.userData.restY, duration: 0.25, ease: "power2.out" });
  }

  // If music is already playing (e.g. switching back to this toy), show its disc.
  if (music.state.playlist) placeInstantly(music.state.playlist);

  // Stopping from the widget (or the stop button) drops the lifted case back.
  const unsubscribe = music.subscribe((state) => {
    if (!state.playlist && !busy) liftCase(null);
    else if (state.playlist && state.playlist !== loaded && !busy) placeInstantly(state.playlist);
  });

  let spin = 0; // current disc speed, eased toward the target
  // Everything that tweens (lid, disc, cases, buttons).
  const animated = [lid.rotation, disc.scale, ...cases.map((c) => c.position), ...buttons.map((b) => b.position)];

  return {
    cursor: "pointer",
    pickables: [...cases, lidTop, ...buttons, body],

    grab(hit) {
      const { action } = hit.object.userData;
      if (action === "case") loadDisc(hit.object);
      else if (action === "list") {
        press(hit.object);
        openTrackList(loaded ?? PLAYLISTS[0]);
      } else if (action === "stop") {
        press(hit.object);
        music.stop();
      } else {
        // Play/pause button, or anywhere on the player.
        if (hit.object.userData.restY !== undefined) press(hit.object);
        if (music.state.playlist) music.toggle();
        else if (loaded) music.play(loaded);
        else loadDisc(cases[0]);
      }
      return { move() {}, release() {} };
    },

    // Something to redraw while the disc spins or anything is animating.
    update(dt) {
      const playing = !!music.state.playlist && !music.state.isPaused && disc.parent === tray;
      spin += ((playing ? SPIN_SPEED : 0) - spin) * Math.min(1, dt * 3);
      disc.rotation.y += spin * dt;
      return spin > 0.001 || busy || animated.some((target) => gsap.isTweening(target));
    },

    dispose() {
      unsubscribe();
      timeline?.kill();
      gsap.killTweensOf([lid.rotation, disc.scale, ...cases.map((c) => c.position), ...buttons.map((b) => b.position)]);
      scene.remove(root);
      for (const thing of disposables) thing.dispose();
    },
  };
}
