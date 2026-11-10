import { gsap } from "gsap";
import { createPopover, popIn, popOut } from "./popover.js";

// Pop-up menu for picking a toy, opened at the pointer (right-click or long
// press). `actions` are extra commands listed under the toys, e.g.
// [{ label: "Reset", onClick }].
export function createToyMenu(el, toys, onSelect, actions = []) {
  el.innerHTML = `<p class="toy-menu-title">Toys</p>`;

  function addItem(label, role, onClick) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "toy-menu-item";
    item.setAttribute("role", role);
    item.textContent = label;
    item.addEventListener("click", () => {
      popover.close();
      onClick();
    });
    el.append(item);
    return item;
  }

  const items = toys.map((toy) => {
    const item = addItem(toy.label, "menuitemradio", () => onSelect(toy.id));
    item.dataset.id = toy.id;
    return item;
  });
  if (actions.length) el.append(Object.assign(document.createElement("hr"), { className: "toy-menu-divider" }));
  const all = [...items, ...actions.map((a) => addItem(a.label, "menuitem", a.onClick))]; // keyboard order

  gsap.set(el, { autoAlpha: 0 });
  const popover = createPopover({
    panel: el,
    show: () => popIn(el, { scale: 0.9, y: -6, transformOrigin: "0% 0%" }, { duration: 0.35, ease: "back.out(2.2)" }),
    hide: () => popOut(el, { scale: 0.96 }, { duration: 0.12 }),
  });

  function open(x, y, currentId) {
    for (const item of items) item.setAttribute("aria-checked", String(item.dataset.id === currentId));

    // Keep it on screen. Measure at full size (still invisible if it was
    // closed; if it's already open, just move it).
    if (!popover.isOpen) gsap.set(el, { autoAlpha: 0, scale: 1, y: 0 });
    const { width, height } = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;

    popover.open();
    (items.find((i) => i.dataset.id === currentId) ?? items[0]).focus({ preventScroll: true });
  }

  window.addEventListener("resize", popover.close);
  el.addEventListener("keydown", (e) => {
    const index = all.indexOf(document.activeElement);
    if (e.key === "ArrowDown") all[(index + 1) % all.length].focus();
    else if (e.key === "ArrowUp") all[(index - 1 + all.length) % all.length].focus();
    else return;
    e.preventDefault();
  });

  return { open, close: popover.close };
}
