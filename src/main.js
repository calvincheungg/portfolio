// Entry point.
import "./settings.js"; // applies the saved theme
import { asciiFrame } from "./ui/ascii.js";
import "./ui/work-menu.js";
import "./ui/contact.js";
import "./ui/about.js";
import "./ui/resume.js";
import "./ui/settings-panel.js";
import "./ui/hover.js";
// The music player (src/music) loads with the CD player toy.

// Menus, panels and dialogs are drawn as ASCII boxes.
for (const card of document.querySelectorAll(".card")) asciiFrame(card);

// The 3D toys load separately, so if they can't start (no WebGL on old devices
// or locked-down machines) the menus above still work. A still picture of the
// blocks takes the scene's place instead.
import("./scene/index.js").catch((err) => {
  console.error("3D scene failed to start:", err);
  const canvas = document.getElementById("stage");
  const img = document.getElementById("stage-fallback");
  canvas.hidden = true;
  document.getElementById("toy-switch").hidden = true; // no toys to choose
  img.src = "/blocks.png"; // only downloaded when needed
  img.hidden = false;
});

// Visit stats load last and on their own: ad blockers often block analytics,
// and that must never stop the rest of the site from working.
import("./lib/visit-stats.js").catch(() => {});
