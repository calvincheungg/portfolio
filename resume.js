import { gsap } from "gsap";
import { reduceMotion } from "./settings.js";
// Legacy build: the standard one relies on JavaScript features most browsers
// don't have yet (e.g. Map.getOrInsertComputed); this one includes fallbacks.
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

// Resume viewer. Pages are drawn with PDF.js rather than the browser's built-in
// viewer, which Android Chrome can't show inside a page and iOS shows badly.
// PDF.js is only downloaded the first time someone opens it.

const PDF_URL = "calvin-cheung-resume.pdf";

const link = document.getElementById("work-link");
const dialog = document.getElementById("resume");
const sheet = dialog.querySelector(".resume-sheet");
const pagesEl = document.getElementById("resume-pages");
const closeBtn = document.getElementById("resume-close");

let pdfPromise = null;
let renderedWidth = 0;
let closing = false;

function loadPdf() {
  pdfPromise ??= import("pdfjs-dist/legacy/build/pdf.min.mjs").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    return pdfjs.getDocument({ url: PDF_URL }).promise;
  });
  return pdfPromise;
}

async function renderPages() {
  const width = pagesEl.clientWidth - parseFloat(getComputedStyle(pagesEl).paddingLeft) * 2;
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

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
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

function open(e) {
  // Let modified clicks (new tab, etc.) open the PDF on its own.
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  if (dialog.open) return;
  closing = false;
  dialog.showModal();
  renderPages();
  if (reduceMotion()) return;

  gsap.killTweensOf([dialog, sheet]);
  gsap.fromTo(dialog, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power1.out" });
  // Slides up like a sheet of paper, settling with a small bounce.
  gsap.fromTo(
    sheet,
    { y: 80, rotation: 1.5, autoAlpha: 0 },
    { y: 0, rotation: 0, autoAlpha: 1, duration: 0.8, ease: "elastic.out(1, 0.7)" }
  );
}

function close() {
  if (!dialog.open || closing) return;
  closing = true;
  if (reduceMotion()) {
    dialog.close();
    return;
  }
  gsap.killTweensOf([dialog, sheet]);
  gsap.to(sheet, { y: 60, autoAlpha: 0, duration: 0.22, ease: "power2.in" });
  gsap.to(dialog, { opacity: 0, duration: 0.28, ease: "power1.in", onComplete: () => dialog.close() });
}

link.addEventListener("click", open);
closeBtn.addEventListener("click", close);
dialog.addEventListener("cancel", (e) => {
  e.preventDefault();
  close();
});
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) close();
});

// Redraw sharply if the window is resized while it's open.
let resizeTimer;
window.addEventListener("resize", () => {
  if (!dialog.open) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderPages, 200);
});
