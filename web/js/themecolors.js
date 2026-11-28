// Theme hooks for code that colours or draws things itself: category colours, and redrawing when the theme changes.
const ATTRS = ["data-style", "data-base", "data-family", "data-glass", "data-font"];

/** Category colour n (1 to 8) for CSS: the theme's --cat-n, or today's colour when the theme doesn't set one. */
export const cat = (n, fallback) => `var(--cat-${n}, ${fallback})`;

/** A colour for a canvas, which can't read var(): resolves var(--x, fallback) against the current theme. */
export function resolve(color) {
  const m = /^var\((--[\w-]+)(?:,\s*(.+))?\)$/.exec(color || "");
  if (!m) return color;
  return getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || m[2] || "";
}

/** Call fn when the theme, light or dark, or the CSS theme changes. Returns a function that stops listening. */
export function onThemeChange(fn) {
  const watcher = new MutationObserver(() => fn());
  watcher.observe(document.documentElement, { attributes: true, attributeFilter: ATTRS });
  window.addEventListener("cssthemechange", fn);
  return () => { watcher.disconnect(); window.removeEventListener("cssthemechange", fn); };
}
