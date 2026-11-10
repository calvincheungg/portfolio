// Font stacks for drawing on canvases (block faces, CD labels…), read from the
// CSS variables in src/styles/base.css so each font is defined in one place.
// Read on use, by which point the stylesheet has loaded.

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const fonts = {
  /** Abril Fatface: the toy-block serif. */
  get letter() {
    return cssVar("--font-letter");
  },
  /** Space Mono: menus and small print. */
  get ui() {
    return cssVar("--font-ui");
  },
};
