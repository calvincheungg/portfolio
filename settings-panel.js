import { gsap } from "gsap";
import { getSetting, setSetting, onSettingChange, reduceMotion, theme } from "./settings.js";

// The Settings pop-up in the bottom-right corner.

const wrap = document.querySelector(".settings");
const toggle = document.getElementById("settings-toggle");
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
let open = false;

function setOpen(next) {
  if (next === open) return;
  open = next;
  toggle.setAttribute("aria-expanded", String(open));
  gsap.killTweensOf(panel);
  if (reduceMotion()) {
    gsap.set(panel, { autoAlpha: open ? 1 : 0, y: 0, scale: 1 });
  } else if (open) {
    gsap.fromTo(
      panel,
      { autoAlpha: 0, y: 8, scale: 0.94, transformOrigin: "100% 100%" },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.4, ease: "back.out(2)" }
    );
  } else {
    gsap.to(panel, { autoAlpha: 0, y: 6, scale: 0.97, duration: 0.15, ease: "power1.in" });
  }
}

toggle.addEventListener("click", () => setOpen(!open));
document.addEventListener("pointerdown", (e) => {
  if (open && !wrap.contains(e.target)) setOpen(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && open) {
    setOpen(false);
    toggle.focus();
  }
});
