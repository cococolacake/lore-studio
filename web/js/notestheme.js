// Session notes frames (plan preview, live scene) take on the app's theme; saved and printed notes keep their own look.
import { onThemeChange, THEME_ATTRS } from "./themecolors.js";

const ATTRS = THEME_ATTRS.map((a) => a.slice("data-".length));
const frames = new Set();

const appTheme = () => document.documentElement.dataset;
const cssTheme = () => document.getElementById("css-theme")?.textContent || "";
const attr = (v) => String(v).replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`);

/** The notes page with the app's theme added, so it shows themed from its first frame. */
export function themedNotes(html) {
  const app = appTheme();
  const attrs = ATTRS.filter((a) => app[a] != null).map((a) => ` data-${a}="${attr(app[a])}"`).join("");
  const tokens = new URL("css/tokens.css", document.baseURI).href, custom = new URL("css/custom.css", document.baseURI).href;
  // a "</style>" inside the theme would end the tag early
  const head = `<link rel="stylesheet" href="${attr(tokens)}"><style id="app-css-theme">${cssTheme().replace(/<\/style/gi, "<\\/style")}</style><link rel="stylesheet" href="${attr(custom)}">`;
  return html
    .replace(/(<html[^>]*?)\sdata-theme="[^"]*"/, "$1")
    .replace(/<html([^>]*)>/, `<html$1 data-notes data-theme="${attr(app.base || "light")}"${attrs}>`)
    .replace("</head>", `${head}</head>`);
}

function repaint(frame) {
  const doc = frame.contentDocument;
  if (!doc?.documentElement?.hasAttribute("data-notes")) return;
  const root = doc.documentElement, app = appTheme();
  for (const a of ATTRS) {
    if (app[a] == null) delete root.dataset[a]; else root.dataset[a] = app[a];
  }
  root.dataset.theme = app.base || "light";
  const style = doc.getElementById("app-css-theme");
  if (style) style.textContent = cssTheme();
}

function repaintAll() {
  for (const f of frames) {
    if (f.isConnected) repaint(f); else frames.delete(f);
  }
}

/** Keep an open notes frame in step when the theme, light or dark, or the CSS theme changes. */
export function followTheme(frame) {
  for (const f of frames) if (!f.isConnected) frames.delete(f);
  frames.add(frame);
}

onThemeChange(repaintAll);
