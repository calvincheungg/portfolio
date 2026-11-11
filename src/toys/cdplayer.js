import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { gsap } from "gsap";
import { createTracker } from "./shared.js";
import { studioEnvMap } from "./textures.js";
import { LCD_PX, buttonTexture, drawLcd, labelTexture, lidTexture, wornSilverTexture } from "./cdplayer-textures.js";
import { createCardFile, onCardFile } from "./cardfile.js";
import { PLAYLISTS } from "../../playlists.js";
import { music } from "../music/music.js";
import { openTrackList } from "../music/tracklist.js";
import { onToyKeys } from "../scene/keys.js";
import { reduceMotion } from "../settings.js";
import { asciiFrame } from "../ui/ascii.js";
import { formatTime } from "../lib/format.js";

// Portable CD player (a late-90s silver Discman) propped up facing the viewer,
// with a rotary card file of CD cases beside it, one per playlist (cardfile.js).
// Click the case at the front of the card file to load its disc. The buttons
// along the front work: previous, next, shuffle, play/pause and the song list.
// Clicking the lid opens it, and with it open, clicking the spinning disc
// pauses or plays. The little screen shows the track and time. Audio comes
// from music.js; the painted surfaces from cdplayer-textures.js.
//
// It works from the keyboard too (KEYS), and a list of the playlists, hidden
// until it has focus, lets keyboard and screen-reader visitors pick a disc.

const R = 1.45; // half the player's width
const BODY_H = 0.36;
const SHELL = 0.1; // the dark lower shell under the silver top
const LID_H = 0.11;
const DISC_R = 0.92;
const HOLE_R = 0.1;
const TILT = 1.15; // radians the player leans back toward the camera
const FILE_X = R + 1.25; // centre of the card file, right of the player
const LID_OPEN = 1.9; // radians the lid swings open
const SPIN_SPEED = 9; // disc rad/s while playing

// The player's outline from above is a "squircle" (a superellipse): rounder
// than a square, squarer than a circle.
const SQUIRCLE = 3;
/** Half-depth of the outline at `x`, for an outline of half-width `r`. */
const outlineZ = (x, r = R) => r * Math.max(0, 1 - Math.abs(x / r) ** SQUIRCLE) ** (1 / SQUIRCLE);

// The lid covers the back and middle; the controls sit on the crescent of body
// left in front of it. A tab in the middle of the lid's front edge reaches down
// to the screen.
const LID_R = R * 0.94;
const TAB_W = 0.5; // the tab's half-width
const TAB_Z = 1.0; // how far forward it reaches
/** Where the lid's front edge is at `x` (z, toward the viewer). */
function lidFrontZ(x) {
  const edge = 0.86 - 0.3 * (x / R) ** 2 * R;
  const t = THREE.MathUtils.smoothstep(Math.abs(x), TAB_W - 0.08, TAB_W + 0.08);
  return TAB_Z + (edge - TAB_Z) * t;
}

const LCD = { z: 1.2, w: 0.84, d: 0.24 }; // the screen, on the front deck

// The buttons on the front deck: [action, x, z, oval?, turn to follow the edge].
const BUTTONS = [
  ["previous", -0.93, 0.97, true, 0.5],
  ["next", -0.63, 1.11, true, 0.3],
  ["shuffle", 0.63, 1.11, true, -0.3],
  ["toggle", 0.93, 0.97, true, -0.5],
  ["list", 1.15, 0.72, false, 0],
];
// Buttons rise a touch under the pointer, sink when pressed and spring back up
// when let go. Shuffle stays a little sunk while it's on, like a latching switch.
const HOVER_LIFT = 0.012;
const PRESS_DEPTH = 0.028;
const LATCH_DEPTH = 0.012;

// Keyboard shortcuts: key → a button to press, or a turn of the card file.
const KEYS = {
  " ": "toggle",
  k: "toggle",
  ArrowRight: "next",
  ArrowLeft: "previous",
  s: "shuffle",
  l: "list",
  ArrowDown: 1,
  ArrowUp: -1,
};
const KEY_HINT = "Space play/pause · ←/→ skip · ↑/↓ flip cases · Enter load · S shuffle · L songs";

/** The squircle outline (half-width r) as a shape, cut off at `front(x)`; shape y runs toward the back. */
function outline(r, front = () => Infinity) {
  const N = 120;
  const points = [];
  // Round the back, left to right, then the front edge back again.
  for (let i = 0; i <= N; i++) {
    const x = -r * Math.cos((i / N) * Math.PI);
    points.push(new THREE.Vector2(x, outlineZ(x, r)));
  }
  for (let i = 0; i <= N; i++) {
    const x = r * Math.cos((i / N) * Math.PI);
    points.push(new THREE.Vector2(x, -Math.min(outlineZ(x, r), front(x))));
  }
  return new THREE.Shape(points);
}

/** A slab with that outline, `h` thick, standing on y = 0, its top edge rounded over by `bevel`. */
function slab(shape, h, bevel) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: h - bevel,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 1.6,
    bevelOffset: -bevel * 1.6,
    bevelSegments: 6,
    curveSegments: 1,
  });
  // (The matching bevel underneath sinks into whatever it stands on.)
  geo.rotateX(-Math.PI / 2);
  // Lay the texture across the full width, whatever the shape.
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const normal = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    // The underside stays plain (one blank corner of the texture), so the
    // lid's print doesn't show through, mirrored, when it's open.
    if (normal.getY(i) < -0.5) uv.setXY(i, 0.02, 0.98);
    else uv.setXY(i, pos.getX(i) / (2 * R) + 0.5, -pos.getZ(i) / (2 * R) + 0.5);
  }
  return geo;
}

export function createCdPlayer({ scene, renderer }) {
  // ----- State -----
  let loaded = null; // playlist whose disc is in the player
  let lidOpen = false; // opened by clicking the lid
  let busy = false; // a disc is being loaded
  let timeline = null; // ...by this
  let spin = 0; // the disc's speed, eased toward playing / stopped
  let hovered = null; // the button under the pointer
  let pressed = null; // the button held down
  let buttonsChanged = false; // so a change shows even without a tween (Reduce motion)
  let lcdText = "";

  const root = new THREE.Group();
  scene.add(root);

  const track = createTracker(); // GPU resources, freed in dispose()
  const material = (options, Material = THREE.MeshStandardMaterial) => track(new Material(options));

  // Something for the silver and the disc's underside to reflect.
  const envMap = track(studioEnvMap(renderer));

  // Toned down: the studio reflection plus the scene lights wash bright silver out to white.
  const silver = material({ color: 0x8e9299, metalness: 0.5, roughness: 0.4, envMap, envMapIntensity: 0.3 });
  const darkPlastic = material({ color: 0x24252b, roughness: 0.5 });
  const greyPlastic = material({ color: 0x4a4d54, roughness: 0.55 });

  // ----- Player -----
  const player = new THREE.Group();
  player.rotation.x = TILT; // top face leans toward the camera
  root.add(player);

  // Body: a dark lower shell with the silver top shell on it.
  const lower = new THREE.Mesh(track(slab(outline(R * 0.985), SHELL, 0)), greyPlastic);
  lower.position.y = -BODY_H / 2;
  const bodyMat = material({ map: track(wornSilverTexture()), color: 0xb9bcc2, metalness: 0.5, roughness: 0.4, envMap, envMapIntensity: 0.3 });
  const body = new THREE.Mesh(track(slab(outline(R), BODY_H - SHELL, 0.05)), bodyMat);
  body.position.y = -BODY_H / 2 + SHELL;
  player.add(lower, body);
  const TOP = BODY_H / 2; // the deck

  const well = new THREE.Mesh(track(new THREE.CircleGeometry(DISC_R + 0.02, 96)), darkPlastic);
  well.rotation.x = -Math.PI / 2;
  well.position.y = TOP + 0.002;
  const spindle = new THREE.Mesh(track(new THREE.CylinderGeometry(0.085, 0.085, 0.06, 24)), silver);
  spindle.position.y = TOP + 0.03;
  const tray = new THREE.Object3D(); // where a loaded disc sits
  tray.position.y = TOP + 0.035;
  player.add(well, spindle, tray);

  // Lid, hinged along the back edge: domed at the rim, printed on top.
  const lid = new THREE.Group();
  lid.position.set(0, TOP, -R);
  player.add(lid);
  const lidMat = material({ map: track(lidTexture(R)), color: 0xa6a9ae, metalness: 0.35, roughness: 0.45, envMap, envMapIntensity: 0.25 });
  const lidTop = new THREE.Mesh(track(slab(outline(LID_R, lidFrontZ), LID_H, 0.07)), lidMat);
  lidTop.position.set(0, 0, R);
  lidTop.userData.action = "lid"; // clicking the lid opens and shuts it
  lid.add(lidTop);

  // ----- Controls on the front deck -----
  // Each button sits in a dark socket. Ovals: previous / next on the left,
  // shuffle / play-pause on the right. A small round one opens the song list.
  const ovalGeo = track(new THREE.CylinderGeometry(0.115, 0.125, 0.07, 40));
  const roundGeo = track(new THREE.CylinderGeometry(0.06, 0.065, 0.06, 28));
  const buttonSide = material({ color: 0x8b8f97, roughness: 0.5 });
  const buttons = BUTTONS.map(([action, x, z, oval, turn]) => {
    const geo = oval ? ovalGeo : roundGeo;
    const top = material({ map: track(buttonTexture(action)), roughness: 0.45 });
    const button = new THREE.Mesh(geo, [buttonSide, top, buttonSide]);
    button.position.set(x, TOP + 0.02, z);
    button.rotation.y = turn;
    if (oval) button.scale.z = 1.5;
    button.userData = { action, restY: button.position.y, top }; // top: brightened on hover
    if (action === "shuffle") {
      button.userData.icons = { off: top.map, on: track(buttonTexture("shuffle", { lit: true })) };
    }
    const socket = new THREE.Mesh(geo, darkPlastic);
    socket.position.set(x, TOP - 0.028, z);
    socket.rotation.y = turn;
    socket.scale.set(1.16, 1, oval ? 1.5 * 1.12 : 1.16);
    player.add(socket, button);
    return button;
  });
  const shuffleBtn = buttons.find((b) => b.userData.action === "shuffle");

  // The screen, in a dark bezel under the lid's tab.
  const bezel = new THREE.Mesh(track(new RoundedBoxGeometry(LCD.w + 0.1, 0.05, LCD.d + 0.09, 2, 0.02)), darkPlastic);
  bezel.position.set(0, TOP, LCD.z);
  const lcdCanvas = document.createElement("canvas");
  [lcdCanvas.width, lcdCanvas.height] = LCD_PX;
  const lcdTex = track(new THREE.CanvasTexture(lcdCanvas));
  lcdTex.colorSpace = THREE.SRGBColorSpace;
  lcdTex.anisotropy = 8;
  const screen = new THREE.Mesh(track(new THREE.PlaneGeometry(LCD.w, LCD.d)), material({ map: lcdTex, roughness: 0.25 }));
  screen.rotation.x = -Math.PI / 2;
  screen.position.set(0, TOP + 0.027, LCD.z);
  player.add(bezel, screen);

  // ----- Disc -----
  const discGeo = track(new THREE.RingGeometry(HOLE_R, DISC_R, 96));
  const labelMat = material({ roughness: 0.45 });
  const shinyMat = material(
    {
      color: 0xe8e8ec,
      metalness: 0.9,
      roughness: 0.12,
      iridescence: 1,
      iridescenceIOR: 1.6,
      iridescenceThicknessMinimum: 180,
      iridescenceThicknessMaximum: 700,
      envMap,
    },
    THREE.MeshPhysicalMaterial
  );
  const disc = new THREE.Group();
  const discTop = new THREE.Mesh(discGeo, labelMat);
  discTop.rotation.x = -Math.PI / 2;
  const discBottom = new THREE.Mesh(discGeo, shinyMat);
  discBottom.rotation.x = Math.PI / 2;
  disc.add(discTop, discBottom);
  discTop.userData.action = discBottom.userData.action = "disc"; // with the lid open, pauses / plays
  disc.visible = false;
  tray.add(disc);

  const labels = new Map(); // playlist → texture, made on first use
  function setDiscLabel(playlist) {
    if (!labels.has(playlist)) labels.set(playlist, track(labelTexture(playlist)));
    labelMat.map = labels.get(playlist);
    labelMat.needsUpdate = true;
    syncShelf(); // (the disc changes along with its label)
  }

  // ----- Card file -----
  const cardFile = createCardFile({ envMap, track, onLoad: loadDisc });
  cardFile.group.position.x = FILE_X;
  cardFile.group.rotation.y = -0.18; // turned a little toward the player
  root.add(cardFile.group);

  root.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });

  // Stand the player on its lower edge.
  player.updateMatrixWorld(true);
  player.position.y -= new THREE.Box3().setFromObject(player).min.y;

  // ----- Screen -----
  // Track number and time, and the song underneath; pause and shuffle
  // indicators in the corner.
  function updateLcd() {
    const { playlist, track: song, index, isPaused, shuffle } = music.state;
    let lines = ["NO DISC", ""];
    if (playlist) {
      const time = formatTime(music.position());
      lines = [`${String(index + 1).padStart(2, "0")}  ${time}`, (song?.title ?? playlist.title).toUpperCase()];
    } else if (loaded) lines = ["--  0:00", loaded.title.toUpperCase()];
    lines[2] = [shuffle && "SHUF", playlist && isPaused && "||"].filter(Boolean);
    const text = lines.flat().join("\n");
    if (text === lcdText) return false;
    lcdText = text;
    drawLcd(lcdCanvas.getContext("2d"), lines);
    lcdTex.needsUpdate = true;
    return true;
  }

  // ----- Loading a disc -----
  function placeInstantly(playlist) {
    loaded = playlist;
    setDiscLabel(playlist);
    tray.attach(disc);
    disc.position.set(0, 0, 0);
    disc.quaternion.identity();
    disc.scale.setScalar(1);
    disc.visible = true;
    lid.rotation.x = 0;
    lidOpen = false;
    cardFile.show(playlist, { instant: true });
  }

  /** Take `playlist`'s disc from its case and drop it into the player, playing. */
  function loadDisc(playlist) {
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
    lidOpen = false;
    const from = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    const to = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    const flight = { t: 0 };

    const tl = (timeline = gsap.timeline({ onComplete: () => (busy = false) }));
    tl.to(lid.rotation, { x: -LID_OPEN, duration: 0.4, ease: "power2.out" });
    if (loaded) tl.to(disc.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.2, ease: "power2.in" });
    tl.call(() => {
      loaded = playlist;
      setDiscLabel(playlist);
      // Disc starts at the case, facing out like the cover. (The case is on
      // the card file, so work in world space.)
      cardFile.discStart(playlist, from.pos, from.quat);
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

  // Clicking the lid lifts it to show the disc (spinning, if it's playing); again shuts it.
  function toggleLid() {
    if (busy) return;
    lidOpen = !lidOpen;
    const x = lidOpen ? -LID_OPEN : 0;
    if (reduceMotion()) lid.rotation.x = x;
    else gsap.to(lid.rotation, { x, duration: lidOpen ? 0.45 : 0.5, ease: lidOpen ? "back.out(1.6)" : "bounce.out", overwrite: true });
  }

  // ----- Buttons -----
  const restingY = (button) =>
    button.userData.restY +
    (button === hovered ? HOVER_LIFT : 0) -
    (button === shuffleBtn && music.state.shuffle ? LATCH_DEPTH : 0);

  function settleButton(button, ease = "power2.out", duration = 0.18) {
    buttonsChanged = true;
    const y = restingY(button);
    if (reduceMotion()) button.position.y = y;
    else gsap.to(button.position, { y, duration, ease, overwrite: true });
    button.userData.top.emissive.setScalar(button === hovered ? 0.08 : 0);
  }

  function hoverButton(button) {
    if (button === hovered) return;
    const was = hovered;
    hovered = button;
    for (const b of [was, button]) if (b && b !== pressed) settleButton(b);
  }

  /** Press `button` down; the returned handle springs it back up on release. */
  function press(button) {
    pressed = button;
    if (reduceMotion()) button.position.y = button.userData.restY - PRESS_DEPTH;
    else gsap.to(button.position, { y: button.userData.restY - PRESS_DEPTH, duration: 0.07, ease: "power2.in", overwrite: true });
    return {
      move() {},
      release() {
        pressed = null;
        settleButton(button, "back.out(3)", 0.3);
      },
    };
  }

  /** What each button does. */
  function run(action) {
    if (action === "list") openTrackList(loaded ?? cardFile.front());
    else if (action === "shuffle") music.toggleShuffle();
    else if (action === "next" || action === "previous") {
      if (music.state.playlist) music[action]();
    } else if (action === "toggle") {
      if (music.state.playlist) music.toggle();
      else if (loaded) music.play(loaded);
      else loadDisc(cardFile.front());
    }
  }

  // Shuffle's icon lights up (and its button latches) whenever shuffle is on,
  // whether it was switched here or on the Now playing panel.
  let shownShuffle = null;
  function syncShuffle() {
    if (shownShuffle === music.state.shuffle) return;
    shownShuffle = music.state.shuffle;
    const top = shuffleBtn.userData.top;
    top.map = shuffleBtn.userData.icons[shownShuffle ? "on" : "off"];
    top.needsUpdate = true;
    if (shuffleBtn !== pressed) settleButton(shuffleBtn);
  }
  syncShuffle();

  // ----- Keyboard -----
  const releases = new Set(); // keyboard presses waiting to spring back up
  const stopKeys = onToyKeys((key, e) => {
    if (!(key in KEYS || key === "Enter")) return false;
    const what = KEYS[key];
    if (typeof what === "number") cardFile.flip(what);
    else if (e.repeat) return true;
    else if (key === "Enter") loadDisc(cardFile.front());
    else {
      // Press the button on the player, as if clicked.
      const handle = press(buttons.find((b) => b.userData.action === what));
      run(what);
      const timer = setTimeout(() => {
        releases.delete(timer);
        handle.release();
      }, 120);
      releases.add(timer);
    }
    return true;
  });

  // ----- Playlists, for keyboards and screen readers -----
  // Hidden until tabbed to; focusing one turns its case to the front, and
  // choosing it loads the disc.
  const shelf = document.createElement("nav");
  shelf.className = "cd-shelf card";
  shelf.setAttribute("aria-label", "CD player");
  shelf.innerHTML = `
    <p class="cd-shelf-title">Playlists</p>
    <ul>${PLAYLISTS.map((p, i) => `<li><button class="text-btn ascii-btn" type="button" data-index="${i}">${p.title}</button></li>`).join("")}</ul>
    <p class="cd-shelf-keys">${KEY_HINT}</p>`;
  document.body.append(shelf);
  const unframe = asciiFrame(shelf);
  const shelfButtons = [...shelf.querySelectorAll("button")];
  shelf.addEventListener("focusin", (e) => {
    const index = e.target.dataset?.index;
    if (index !== undefined) cardFile.show(PLAYLISTS[index]);
  });
  shelf.addEventListener("click", (e) => {
    const index = e.target.closest("button")?.dataset.index;
    if (index !== undefined) loadDisc(PLAYLISTS[index]);
  });
  function syncShelf() {
    for (const button of shelfButtons) {
      if (PLAYLISTS[button.dataset.index] === loaded) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    }
  }

  // The disc in the player: what's playing (e.g. switching back to this toy),
  // or else the one played last time, ready to go.
  const last = music.state.playlist ?? PLAYLISTS.find((p) => p.url === music.lastPlayed());
  if (last) placeInstantly(last);

  // A disc chosen elsewhere (the song list, the widget) shows up in the player.
  const unsubscribe = music.subscribe((state) => {
    syncShuffle();
    if (state.playlist && state.playlist !== loaded && !busy) placeInstantly(state.playlist);
  });

  // Everything that tweens (lid, disc, buttons).
  const animated = [lid.rotation, disc.scale, ...buttons.map((b) => b.position)];
  const idle = { move() {}, release() {} };

  return {
    cursor: "pointer",
    pickables: [...cardFile.pickables, lidTop, discTop, ...buttons, body, lower],

    // The front case is clicked; the rest of the card file is dragged; the
    // player's body isn't a button, and nor is the disc while the lid's shut.
    cursorFor(hit) {
      const { action } = hit.object.userData;
      if (onCardFile(hit)) return cardFile.cursorFor(hit);
      if (!action || (action === "disc" && !(lidOpen && !busy))) return "default";
      return "pointer";
    },

    // Scrolling over the card file flips through it.
    wheel(hit, e) {
      if (!onCardFile(hit)) return false;
      cardFile.wheel(e.deltaY * (e.deltaMode === 1 ? 16 : 1));
      return true;
    },

    grab(hit) {
      const { action } = hit.object.userData;
      if (onCardFile(hit)) return cardFile.grab(hit);
      if (action === "lid") toggleLid();
      else if (action === "disc") {
        // The spinning disc, seen with the lid open: pause or carry on.
        if (lidOpen && !busy && loaded) {
          if (music.state.playlist) music.toggle();
          else music.play(loaded);
        }
      } else if (hit.object.userData.restY !== undefined) {
        const handle = press(hit.object);
        run(action);
        return handle;
      }
      return idle;
    },

    // Lift the button under the pointer.
    hover(hit) {
      const object = hit?.object;
      hoverButton(object?.userData.restY !== undefined ? object : null);
    },

    // True when there's something new to draw.
    update(dt) {
      const playing = !!music.state.playlist && !music.state.isPaused && disc.parent === tray;
      spin += ((playing ? SPIN_SPEED : 0) - spin) * Math.min(1, dt * 3);
      disc.rotation.y += spin * dt;
      // The disc is only seen spinning with the lid up (or on its way in); shut,
      // the screen's clock is all that changes, once a second.
      const discShown = disc.visible && (disc.parent !== tray || lid.rotation.x < -0.01);
      const changed = updateLcd() | cardFile.update() | buttonsChanged;
      buttonsChanged = false;
      return !!changed || (discShown && spin > 0.001) || busy || animated.some((target) => gsap.isTweening(target));
    },

    dispose() {
      unsubscribe();
      stopKeys();
      for (const timer of releases) clearTimeout(timer);
      unframe();
      shelf.remove();
      timeline?.kill();
      gsap.killTweensOf(animated);
      cardFile.dispose();
      scene.remove(root);
      track.disposeAll();
    },
  };
}
