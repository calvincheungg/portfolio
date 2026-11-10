import { inject, pageview } from "@vercel/analytics";

// Vercel Web Analytics. Turn it on in the Vercel dashboard (Project → Analytics);
// in local dev it only logs to the console.
inject();

// Custom events need a paid Vercel plan, so the clicks worth knowing about
// (resume opened, project and contact links) are recorded as page views of
// made-up paths instead, e.g. "/resume" or "/projects/beatmap". They show up
// in the Pages list.
//
// Mark an element with data-track="/some/path" to count clicks on it.
document.addEventListener("click", (e) => {
  const path = e.target.closest?.("[data-track]")?.dataset.track;
  if (path) pageview({ route: path, path });
});
