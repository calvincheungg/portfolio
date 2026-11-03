import { gsap } from "gsap";

// Small pop-up menu for picking a toy, opened at the pointer. `actions` are
// extra commands listed under the toys, e.g. [{ label: "Reset", onClick }].
export function createToyMenu(el, toys, onSelect, actions = []) {
  el.innerHTML = `<p class="toy-menu-title">Toys</p>`;
  const items = toys.map((toy) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "toy-menu-item";
    item.setAttribute("role", "menuitemradio");
    item.dataset.id = toy.id;
    item.textContent = toy.label;
    item.addEventListener("click", () => {
      close();
      onSelect(toy.id);
    });
    el.append(item);
    return item;
  });

  if (actions.length) el.append(Object.assign(document.createElement("hr"), { className: "toy-menu-divider" }));
  const commands = actions.map(({ label, onClick }) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "toy-menu-item";
    item.setAttribute("role", "menuitem");
    item.textContent = label;
    item.addEventListener("click", () => {
      close();
      onClick();
    });
    el.append(item);
    return item;
  });
  const all = [...items, ...commands]; // keyboard order
  gsap.set(el, { autoAlpha: 0 });

  let isOpen = false;

  function open(x, y, currentId) {
    for (const item of items) item.setAttribute("aria-checked", String(item.dataset.id === currentId));

    // Keep it on screen.
    gsap.set(el, { autoAlpha: 1 });
    const { width, height } = el.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - width - 8);
    const top = Math.min(y, window.innerHeight - height - 8);
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${Math.max(8, top)}px`;

    gsap.killTweensOf(el);
    gsap.fromTo(
      el,
      { autoAlpha: 0, scale: 0.9, y: -6, transformOrigin: "0% 0%" },
      { autoAlpha: 1, scale: 1, y: 0, duration: 0.35, ease: "back.out(2.2)" }
    );
    isOpen = true;
    (items.find((i) => i.dataset.id === currentId) ?? items[0]).focus({ preventScroll: true });
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    gsap.killTweensOf(el);
    gsap.to(el, { autoAlpha: 0, scale: 0.96, duration: 0.12, ease: "power1.in" });
  }

  document.addEventListener("pointerdown", (e) => {
    if (isOpen && !el.contains(e.target)) close();
  });
  window.addEventListener("resize", close);
  el.addEventListener("keydown", (e) => {
    const index = all.indexOf(document.activeElement);
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown") all[(index + 1) % all.length].focus();
    else if (e.key === "ArrowUp") all[(index - 1 + all.length) % all.length].focus();
    else return;
    e.preventDefault();
  });

  return { open, close };
}
