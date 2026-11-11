import { gsap } from "gsap";
import { createDialog } from "./dialog.js";
// Legacy build: the standard one relies on JavaScript features most browsers
// don't have yet (e.g. Map.getOrInsertComputed); this one includes fallbacks.
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

// Resume viewer. Pages are drawn with PDF.js rather than the browser's built-in
// viewer, which Android Chrome can't show inside a page and iOS shows badly.
// PDF.js is only downloaded the first time someone opens it.

const PDF_URL = "calvin-cheung-resume.pdf";

const link = document.getElementById("resume-link");
const dialog = document.getElementById("resume");
const sheet = dialog.querySelector(".resume-sheet");
const pagesEl = document.getElementById("resume-pages");
const closeBtn = document.getElementById("resume-close");

let pdfPromise = null;
let renderedWidth = 0;
let zoom = 1; // 1 = the page fits the viewer's width

function loadPdf() {
  pdfPromise ??= import("pdfjs-dist/legacy/build/pdf.min.mjs").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    return pdfjs.getDocument({ url: PDF_URL }).promise;
  });
  return pdfPromise;
}

/** Width of a page at zoom 1 (the viewer's width, less its padding). */
const fitWidth = () => pagesEl.clientWidth - parseFloat(getComputedStyle(pagesEl).paddingLeft) * 2;

// Canvases bigger than this get blurry-but-safe instead of failing (phones
// refuse very large canvases).
const MAX_CANVAS = 4096;

async function renderPages() {
  const width = fitWidth() * zoom;
  if (!width || Math.abs(width - renderedWidth) < 1) return;
  renderedWidth = width;

  let pdf;
  try {
    pdf = await loadPdf();
  } catch (err) {
    console.error("Resume failed to load:", err);
    pdfPromise = null;
    renderedWidth = 0;
    pagesEl.innerHTML = `<p class="resume-status">Couldn't load the resume. <a href="${PDF_URL}" target="_blank" rel="noopener">Open the PDF</a></p>`;
    return;
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2, MAX_CANVAS / width);
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });

    const wrap = document.createElement("div");
    wrap.className = "resume-page";
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    wrap.append(canvas);
    await page.render({
      canvas,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
    }).promise;

    // Keep the PDF's links (LinkedIn, GitHub, email…) clickable.
    for (const annot of await page.getAnnotations()) {
      if (annot.subtype !== "Link" || !annot.url) continue;
      const [x1, y1] = viewport.convertToViewportPoint(annot.rect[0], annot.rect[1]);
      const [x2, y2] = viewport.convertToViewportPoint(annot.rect[2], annot.rect[3]);
      const a = document.createElement("a");
      a.href = annot.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.setAttribute("aria-label", annot.url);
      Object.assign(a.style, {
        left: `${(Math.min(x1, x2) / viewport.width) * 100}%`,
        top: `${(Math.min(y1, y2) / viewport.height) * 100}%`,
        width: `${(Math.abs(x2 - x1) / viewport.width) * 100}%`,
        height: `${(Math.abs(y2 - y1) / viewport.height) * 100}%`,
      });
      wrap.append(a);
    }
    pages.push(wrap);
  }
  pagesEl.replaceChildren(...pages);
}

const resume = createDialog(dialog, {
  onOpen() {
    setZoom(1); // opens fitted to the width
    renderPages();
  },
  show() {
    gsap.killTweensOf([dialog, sheet]);
    gsap.fromTo(dialog, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power1.out" });
    // Slides up like a sheet of paper, settling with a small bounce.
    gsap.fromTo(
      sheet,
      { y: 80, rotation: 1.5, autoAlpha: 0 },
      { y: 0, rotation: 0, autoAlpha: 1, duration: 0.8, ease: "elastic.out(1, 0.7)" }
    );
  },
  hide(done) {
    gsap.killTweensOf([dialog, sheet]);
    gsap.to(sheet, { y: 60, autoAlpha: 0, duration: 0.22, ease: "power2.in" });
    gsap.to(dialog, { opacity: 0, duration: 0.28, ease: "power1.in", onComplete: done });
  },
});

link.addEventListener("click", (e) => {
  // Let modified clicks (new tab, etc.) open the PDF on its own.
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  resume.open();
});
closeBtn.addEventListener("click", resume.close);

// Redraw sharply if the window is resized while it's open.
let resizeTimer;
window.addEventListener("resize", () => {
  if (!dialog.open) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderPages, 200);
});

// ----- Zoom (scroll wheel or trackpad pinch) and pan (click and drag) -----

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const view = { zoom: 1 }; // what's shown; glides toward `zoom`
let rerenderTimer;

/** Show the pages at zoom `z` (CSS sizes them; see .resume-page). */
function applyZoom(z) {
  view.zoom = z;
  pagesEl.style.setProperty("--zoom", z);
}

function setZoom(z) {
  gsap.killTweensOf(view);
  zoom = z;
  applyZoom(z);
}

/**
 * Zoom by `factor`, keeping the point under (x, y) (viewport px) in place.
 * Mouse-wheel steps glide; once it settles, the pages are redrawn sharp.
 */
function zoomAt(factor, x, y) {
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
  if (next === zoom) return;
  zoom = next;
  const box = pagesEl.getBoundingClientRect();
  const pad = parseFloat(getComputedStyle(pagesEl).paddingLeft);
  const offsetX = x - box.left;
  const offsetY = y - box.top;
  // Where the pointer is on the pages, as a fraction of their size.
  const fx = (pagesEl.scrollLeft + offsetX - pad) / (pagesEl.scrollWidth - pad * 2);
  const fy = (pagesEl.scrollTop + offsetY - pad) / (pagesEl.scrollHeight - pad * 2);
  gsap.to(view, {
    zoom: next,
    duration: 0.25,
    ease: "power2.out",
    overwrite: true,
    onUpdate() {
      applyZoom(view.zoom);
      pagesEl.scrollLeft = pad + fx * (pagesEl.scrollWidth - pad * 2) - offsetX;
      pagesEl.scrollTop = pad + fy * (pagesEl.scrollHeight - pad * 2) - offsetY;
    },
  });
  clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(renderPages, 300);
}

pagesEl.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    // Pinches arrive as small ctrl+wheel steps, so they count for more.
    zoomAt(Math.exp(-px * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
  },
  { passive: false }
);

// Double-click goes back to fitting the width.
pagesEl.addEventListener("dblclick", () => {
  setZoom(1);
  clearTimeout(rerenderTimer);
  renderPages();
});

// Drag with the mouse (or pen) to move around; touch scrolls natively. A drag
// doesn't count as a click, so it won't open the PDF's links.
let drag = null;
pagesEl.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch" || e.button !== 0) return;
  e.preventDefault(); // no image dragging or text selection
  drag = { x: e.clientX, y: e.clientY, left: pagesEl.scrollLeft, top: pagesEl.scrollTop, moved: false, id: e.pointerId };
});
pagesEl.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  if (!drag.moved) {
    drag.moved = true;
    pagesEl.setPointerCapture(e.pointerId);
    pagesEl.classList.add("dragging");
  }
  pagesEl.scrollLeft = drag.left - dx;
  pagesEl.scrollTop = drag.top - dy;
});
function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  if (drag.moved) {
    pagesEl.classList.remove("dragging");
    // Swallow the click that ends the drag.
    pagesEl.addEventListener("click", (c) => (c.preventDefault(), c.stopPropagation()), { capture: true, once: true });
  }
  drag = null;
}
pagesEl.addEventListener("pointerup", endDrag);
pagesEl.addEventListener("pointercancel", endDrag);
