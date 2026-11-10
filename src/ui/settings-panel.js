import { gsap } from "gsap";
import { getSetting, setSetting, onSettingChange, theme } from "../settings.js";
import { createPopover, popIn, popOut } from "./popover.js";

// The Settings pop-up in the bottom-right corner.

const panel = document.getElementById("settings-panel");
const inputs = panel.querySelectorAll("input");

function syncInputs() {
  for (const input of inputs) {
    // Theme shows the one actually in use, even before the visitor has picked.
    const value = input.name === "theme" ? theme() : getSetting(input.name);
    if (input.type === "checkbox") input.checked = value;
    else input.checked = input.value === value;
  }
}

for (const input of inputs) {
  input.addEventListener("change", () => {
    setSetting(input.name, input.type === "checkbox" ? input.checked : input.value);
  });
}
onSettingChange(syncInputs); // e.g. the system theme changes while it's open
syncInputs();

gsap.set(panel, { autoAlpha: 0 });
createPopover({
  panel,
  trigger: document.getElementById("settings-toggle"),
  show: () => popIn(panel, { y: 8, scale: 0.94, transformOrigin: "100% 100%" }),
  hide: () => popOut(panel, { y: 6, scale: 0.97 }),
});
