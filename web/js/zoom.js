// Zoom for the whole app window, like a browser's Ctrl + and Ctrl -. Saved in settings as ui_zoom (1 = 100%).
// The app window does real page zoom (see set_zoom in main.py); in a browser, its own Ctrl + and Ctrl - do it.
import { api } from "./api.js";

export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

let ctxRef = null;
let supported = false;
let saveTimer = null;
const listeners = new Set();

export const zoomSupported = () => supported;
export const currentZoom = () => Number(ctxRef?.boot?.settings?.ui_zoom) || 1;
export const zoomLabel = (z = currentZoom()) => `${Math.round(z * 100)}%`;
/** Call fn whenever the zoom changes (from the buttons or the keyboard). Returns an unsubscribe function. */
export const onZoom = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/** Apply the saved zoom when the app starts (and after settings reload). */
export async function applySavedZoom(ctx) {
  ctxRef = ctx;
  if (!ctx.boot?.native) { supported = false; return; }
  supported = await api.set_zoom(currentZoom()).catch(() => false);
}

export async function setZoom(z) {
  z = Math.min(2, Math.max(0.5, Math.round(z * 100) / 100));
  if (!ctxRef || !supported) return;
  ctxRef.boot.settings.ui_zoom = z;
  await api.set_zoom(z).catch(() => false);
  listeners.forEach((fn) => { try { fn(z); } catch (e) { console.error(e); } });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => ctxRef.saveSettings({ ui_zoom: z }).catch(() => {}), 350);
}

/** One step bigger (+1) or smaller (-1). */
export function stepZoom(dir) {
  const z = currentZoom();
  const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z + 1e-6) : [...ZOOM_STEPS].reverse().find((s) => s < z - 1e-6);
  if (next) return setZoom(next);
}

// Ctrl + / Ctrl - / Ctrl 0 in the app window (a browser keeps its own zoom keys).
document.addEventListener("keydown", (e) => {
  if (!supported || !(e.ctrlKey || e.metaKey) || e.altKey) return;
  if (e.key === "=" || e.key === "+") stepZoom(1);
  else if (e.key === "-" || e.key === "_") stepZoom(-1);
  else if (e.key === "0") setZoom(1);
  else return;
  e.preventDefault();
});
