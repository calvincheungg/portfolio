import { NAME } from "./shared.js";
import { canvasTexture, fitText, seeded } from "./textures.js";
import { music } from "../music/music.js";
import { fonts } from "../lib/fonts.js";
import { formatLength } from "../lib/format.js";

// The CD player's painted surfaces: the worn silver, the lid's print, the
// button icons and screen, and the discs and CD cases.

/**
 * Years of wear on matt silver, drawn the way it happens rather than as clean
 * lines: scratches that wander a little, fade in, deepen and fade out (and
 * sometimes skip), smudges built from overlapping prints and wipes, and dirt
 * specks gathered in clusters. `seed` fixes where everything lands, so it's
 * the same every visit.
 */
function drawWear(c, s, seed) {
  const rnd = seeded(seed);
  c.lineCap = "round";

  // Smooth noise along a scratch (a few out-of-step waves), roughly 0–1.
  const wobble = () => {
    const waves = [0, 1, 2].map(() => ({ f: 2 + rnd() * 9, p: rnd() * Math.PI * 2 }));
    return (t) => 0.5 + waves.reduce((sum, w, i) => sum + Math.sin(t * w.f + w.p) / (3 * (i + 1)), 0);
  };

  /**
   * One scratch: a wandering path whose strength rises from nothing, varies
   * along the way and dies out again. `layers` are [colour, width, offset]:
   * a dark cut, plus a bright lip beside it for deeper ones.
   */
  function scratch({ x, y, angle, len, peak, width, layers }) {
    const steps = Math.max(4, Math.round(len / 3));
    const turn = (rnd() - 0.5) * 0.012; // a slight steady curve
    const drift = wobble(); // and some wander
    const strength = wobble();
    const points = [];
    let a = angle;
    let px = x;
    let py = y;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      points.push([px, py, t]);
      a += turn + (drift(t * 6) - 0.5) * 0.06;
      px += Math.cos(a) * (len / steps);
      py += Math.sin(a) * (len / steps);
    }
    for (const [color, w, offset] of layers) {
      for (let i = 1; i < points.length; i++) {
        const [x0, y0] = points[i - 1];
        const [x1, y1, t] = points[i];
        // Fades in and out at the ends, uneven in between, with the odd gap.
        const along = Math.sin(Math.PI * t) ** 0.8 * (0.35 + 0.65 * strength(t * 5));
        if (along < 0.08) continue;
        c.beginPath();
        c.moveTo(x0 + offset, y0 + offset);
        c.lineTo(x1 + offset, y1 + offset);
        c.strokeStyle = `rgba(${color}, ${peak * along})`;
        c.lineWidth = w * width * (0.45 + 0.55 * along);
        c.stroke();
      }
    }
  }

  // Smudges: fingerprints and wipes, each a cluster of soft overlapping
  // patches, greyish with a touch of warmth (skin oil and dust).
  for (let i = 0; i < 16; i++) {
    const x = rnd() * s;
    const y = rnd() * s;
    const wipe = rnd() < 0.4; // a long smear rather than a print
    const blobs = 3 + Math.floor(rnd() * 5);
    const angle = rnd() * Math.PI;
    for (let k = 0; k < blobs; k++) {
      const along = wipe ? (k / blobs - 0.5) * (80 + rnd() * 120) : (rnd() - 0.5) * 40;
      const bx = x + Math.cos(angle) * along + (rnd() - 0.5) * 20;
      const by = y + Math.sin(angle) * along + (rnd() - 0.5) * 20;
      const r = (wipe ? 30 : 22) + rnd() * (wipe ? 50 : 40);
      const alpha = 0.025 + rnd() * 0.045; // they overlap, so each is light
      c.save();
      c.translate(bx, by);
      c.rotate(angle + (rnd() - 0.5) * 0.6);
      c.scale(wipe ? 1.8 + rnd() : 1 + rnd() * 0.5, 1);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, `rgba(72, 68, 62, ${alpha})`);
      g.addColorStop(0.55, `rgba(72, 68, 62, ${alpha * 0.7})`);
      g.addColorStop(1, "rgba(72, 68, 62, 0)");
      c.fillStyle = g;
      c.fillRect(-r, -r, r * 2, r * 2);
      c.restore();
    }
  }

  // Dirt: specks in loose clusters, with a soft halo, and a few lone ones.
  for (let i = 0; i < 16; i++) {
    const cx = rnd() * s;
    const cy = rnd() * s;
    const count = rnd() < 0.3 ? 1 : 3 + Math.floor(rnd() * 7);
    for (let k = 0; k < count; k++) {
      const x = cx + (rnd() - 0.5) * 50;
      const y = cy + (rnd() - 0.5) * 50;
      const r = 0.6 + rnd() ** 2 * 2.4;
      const g = c.createRadialGradient(x, y, 0, x, y, r * 2.2);
      const alpha = 0.16 + rnd() * 0.26;
      g.addColorStop(0, `rgba(48, 42, 36, ${alpha})`);
      g.addColorStop(0.45, `rgba(48, 42, 36, ${alpha * 0.7})`);
      g.addColorStop(1, "rgba(48, 42, 36, 0)");
      c.fillStyle = g;
      c.fillRect(x - r * 2.2, y - r * 2.2, r * 4.4, r * 4.4);
    }
  }

  // Surface scratches: faint hairlines in loose bunches (things slide across
  // it the same way), dark or catching the light.
  for (let i = 0; i < 55; i++) {
    const cx = rnd() * s;
    const cy = rnd() * s;
    const angle = rnd() * Math.PI * 2;
    const count = 1 + Math.floor(rnd() * 5);
    for (let k = 0; k < count; k++) {
      const light = rnd() < 0.5;
      scratch({
        x: cx + (rnd() - 0.5) * 70,
        y: cy + (rnd() - 0.5) * 70,
        angle: angle + (rnd() - 0.5) * 0.4,
        len: 15 + rnd() ** 2 * 150,
        peak: light ? 0.22 + rnd() * 0.26 : 0.14 + rnd() * 0.2,
        width: 0.5 + rnd() * 0.5,
        layers: [[light ? "255, 255, 255" : "58, 60, 66", 1, 0]],
      });
    }
  }
  // Deeper scratches: a darker cut with a bright lip beside it where the metal
  // was pushed up, both fading in and out together.
  for (let i = 0; i < 16; i++) {
    scratch({
      x: rnd() * s,
      y: rnd() * s,
      angle: rnd() * Math.PI * 2,
      len: 35 + rnd() ** 1.5 * 180,
      peak: 0.5 + rnd() * 0.3,
      width: 1.1 + rnd() * 1.1,
      layers: [
        ["255, 255, 255", 0.7, 0.9],
        ["44, 46, 52", 1, 0],
      ],
    });
  }
  // Nicks.
  for (let i = 0; i < 40; i++) {
    c.fillStyle = `rgba(52, 54, 60, ${0.15 + rnd() * 0.25})`;
    c.fillRect(rnd() * s, rnd() * s, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}

// Bare worn silver, for the body.
export function wornSilverTexture() {
  return canvasTexture(1024, (c, s) => {
    c.fillStyle = "#c6c9ce";
    c.fillRect(0, 0, s, s);
    drawWear(c, s, 4127);
  });
}

// Lid top: matt silver, worn, with the name and model printed on it,
// speaker-style dots and the lettering on the tab. The texture covers the
// player's full width (half-width `R`, in world units); the bottom of the
// canvas is the front edge.
export function lidTexture(R) {
  return canvasTexture(1024, (c, s) => {
    const px = (v) => (v / (2 * R)) * s; // world units → canvas px
    const at = (x, z) => [s / 2 + px(x), s / 2 + px(z)];
    const sheen = c.createLinearGradient(0, 0, s, s);
    sheen.addColorStop(0, "#d2d5d9");
    sheen.addColorStop(0.5, "#c3c6cb");
    sheen.addColorStop(1, "#aeb2b8");
    c.fillStyle = sheen;
    c.fillRect(0, 0, s, s);

    // The name and model, in the middle of the lid.
    c.fillStyle = "#2b2d33";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = `700 ${px(0.25)}px ${fonts.ui}`;
    c.fillText(NAME, ...at(0, -0.3));
    c.fillStyle = "#3d4047";
    c.font = `${px(0.1)}px ${fonts.ui}`;
    c.fillText("CC-2026", ...at(0, -0.07));
    c.font = `${px(0.075)}px ${fonts.ui}`;
    c.fillText("PORTABLE CD PLAYER", ...at(0, 0.08));
    c.font = `700 italic ${px(0.085)}px Helvetica, Arial, sans-serif`;
    c.fillText("S-MIX", ...at(0, 0.22));

    // On the tab.
    c.font = `${px(0.07)}px ${fonts.ui}`;
    c.fillText("ANTI-SKIP MEMORY II", ...at(0, 0.84));
    c.font = `700 ${px(0.05)}px Helvetica, Arial, sans-serif`;
    c.fillText("DIGITAL AUDIO", ...at(0, 0.7));

    // A little grid of dots near the right edge.
    c.fillStyle = "rgba(70, 72, 80, 0.55)";
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 4; j++) {
        c.beginPath();
        c.arc(...at(1.06 + i * 0.045 - j * 0.012, 0.16 + j * 0.05), px(0.011), 0, Math.PI * 2);
        c.fill();
      }
    }

    drawWear(c, s, 90210); // over the print too: it's scuffed like the rest
  });
}

// Icon printed on a button's top. (A cylinder's top face maps its texture a
// quarter-turn round, so it's drawn pre-rotated.)
export function buttonTexture(icon, { lit = false } = {}) {
  return canvasTexture(256, (c, s) => {
    c.fillStyle = "#8b8f97";
    c.fillRect(0, 0, s, s);
    c.fillStyle = c.strokeStyle = lit ? "#e8792a" : "#33363d"; // shuffle glows orange while on
    const m = s / 2;
    c.translate(m, m);
    c.rotate(-Math.PI / 2);
    c.translate(-m, -m);
    const triangle = (x, dir, h = 30) => {
      c.beginPath();
      c.moveTo(x, m - h);
      c.lineTo(x + dir * h * 1.3, m);
      c.lineTo(x, m + h);
      c.fill();
    };
    if (icon === "toggle") {
      // ▶❚❚
      triangle(m - 56, 1);
      c.fillRect(m + 8, m - 30, 14, 60);
      c.fillRect(m + 36, m - 30, 14, 60);
    } else if (icon === "next") {
      // ▶▶|
      triangle(m - 58, 1);
      triangle(m - 16, 1);
      c.fillRect(m + 30, m - 30, 12, 60);
    } else if (icon === "previous") {
      // |◀◀
      c.fillRect(m - 42, m - 30, 12, 60);
      triangle(m + 16, -1);
      triangle(m + 58, -1);
    } else if (icon === "list") {
      for (const dy of [-34, 0, 34]) c.fillRect(m - 50, m + dy - 9, 100, 18);
    } else if (icon === "shuffle") {
      // Two crossing arrows: ⤨
      c.lineWidth = 13;
      c.lineCap = "round";
      for (const dir of [1, -1]) {
        c.beginPath();
        c.moveTo(m - 58, m - dir * 30);
        c.bezierCurveTo(m - 10, m - dir * 30, m + 4, m + dir * 30, m + 40, m + dir * 30);
        c.stroke();
        c.beginPath();
        c.moveTo(m + 62, m + dir * 30);
        c.lineTo(m + 34, m + dir * 30 - 20);
        c.lineTo(m + 34, m + dir * 30 + 20);
        c.fill();
      }
    }
  });
}

// The screen: grey-green LCD with dark segments. `lines` is [big, small,
// flags], the flags little indicators stacked in the top-right corner
// (e.g. "||" for paused, SHUF).
export const LCD_PX = [512, 146];
export function drawLcd(c, [big, small, flags = []]) {
  const [w, h] = LCD_PX;
  c.fillStyle = "#8d9484";
  c.fillRect(0, 0, w, h);
  const shade = c.createLinearGradient(0, 0, 0, h);
  shade.addColorStop(0, "rgba(0, 0, 0, 0.18)");
  shade.addColorStop(0.25, "rgba(0, 0, 0, 0)");
  c.fillStyle = shade;
  c.fillRect(0, 0, w, h);
  c.fillStyle = "rgba(28, 34, 26, 0.88)";
  c.textBaseline = "middle";
  c.textAlign = "left";
  c.font = `700 ${h * 0.5}px ${fonts.ui}`;
  c.fillText(big, 22, h * 0.4);
  c.font = `${h * 0.22}px ${fonts.ui}`;
  fitText(c, small, 24, h * 0.8, w - 48, h * 0.22, fonts.ui);
  c.textAlign = "right";
  c.font = `700 ${h * 0.2}px ${fonts.ui}`;
  flags.forEach((flag, i) => c.fillText(flag, w - 22, h * (0.2 + i * 0.24)));
}

// Back cover of a CD case: the title and its songs, like a real CD's back
// insert. Seen on the card that's just been flipped past, which hangs upside
// down in front of the card file, so it's drawn turned round to read upright
// from there.
export function backCoverTexture(playlist) {
  const tracks = music.tracksFor(playlist);
  return canvasTexture(1024, (c, s) => {
    c.translate(s, s);
    c.rotate(Math.PI); // the box's back face shows it turned round
    c.fillStyle = "#e9e4d8";
    c.fillRect(0, 0, s, s);
    c.fillStyle = playlist.color;
    c.fillRect(0, s - 210, s, 210);
    c.fillStyle = "#ffffff";
    c.textAlign = "left";
    c.textBaseline = "middle";
    fitText(c, playlist.title, 70, s - 105, s - 140, 120, fonts.letter);
    c.fillStyle = "#2b2d33";
    c.textBaseline = "top";
    tracks.slice(0, 12).forEach((t, i) => {
      fitText(c, `${String(i + 1).padStart(2, "0")}  ${t.title}`, 70, 70 + i * 54, s - 140, 34, fonts.ui);
    });
    if (tracks.length > 12) fitText(c, `+ ${tracks.length - 12} more`, 70, 70 + 12 * 54, s - 140, 34, fonts.ui);
  });
}

// A case's index tab: its colour, with the title in white.
export function tabTexture(playlist) {
  return canvasTexture(256, (c, w, h) => {
    c.fillStyle = playlist.color;
    c.fillRect(0, 0, w, h);
    c.fillStyle = "#ffffff";
    c.textAlign = "center";
    c.textBaseline = "middle";
    fitText(c, playlist.title, w / 2, h / 2 + 2, w - 24, h * 0.62, fonts.letter);
  }, { height: 98 });
}

// Printed side of a CD.
export function labelTexture(playlist) {
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
export function coverTexture(playlist) {
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
