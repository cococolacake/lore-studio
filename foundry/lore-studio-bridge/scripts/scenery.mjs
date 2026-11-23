// Lore Studio Bridge: scenery backgrounds. Works on its own; Lore Studio doesn't need to be open.
//
// Fit to 1920x1080: scenes in the scenery folder (Module Settings) are sized to 1920x1080 and their background is set
//   to "cover", so any image fills the screen and the overflow is cropped. The image files aren't changed.
// Time of day: name a scene's images like canyon_dawn.webp, canyon_day.webp, canyon_dusk.webp, canyon_night.webp (same
//   folder, same extension) and set the scene to any one of them. The background follows Calendaria's clock (or
//   Foundry's world time), and versions you don't have are skipped: dawn and dusk fall back to day, night to dusk, then day.
// Crossfade: when the background changes, every screen fades from the old image to the new one.
const ID = "lore-studio-bridge";
const SOCKET = `module.${ID}`;
const WIDTH = 1920, HEIGHT = 1080;
const DAWN_BEFORE_SUNRISE = 1, DAWN_AFTER_SUNRISE = 1.5, DUSK_BEFORE_SUNSET = 1.5, DUSK_AFTER_SUNSET = 1;
const FALLBACK_SUNRISE = 6, FALLBACK_SUNSET = 19;
const PATTERN = /^(.*)_(dawn|day|dusk|night)(\.\w+)$/;
const FALLBACKS = { dawn: ["dawn", "day"], day: ["day"], dusk: ["dusk", "day"], night: ["night", "dusk", "day"] };

const exists = new Map();   // file path -> Promise<boolean>
let busy = false;
let overlay = null;

function setting(key) { return game.settings.get(ID, key); }
const loadTex = (src) => (foundry.canvas?.loadTexture ?? globalThis.loadTexture)(src);
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- time of day
function calendaria() { return globalThis.CALENDARIA?.api; }

function toHours(v, fallback) {
  if (typeof v === "number" && isFinite(v)) return v;
  if (v && typeof v.hour === "number") return v.hour + (v.minute ?? 0) / 60;
  return fallback;
}

function currentHour() {
  try {
    const dt = calendaria()?.getCurrentDateTime?.();
    if (dt && typeof dt.hour === "number") return dt.hour + (dt.minute ?? 0) / 60;
  } catch {}
  const c = game.time?.components;
  if (c && typeof c.hour === "number") return c.hour + (c.minute ?? 0) / 60;
  return ((game.time?.worldTime ?? 0) % 86400) / 3600;
}

function sunTimes() {
  let rise, set;
  try { rise = calendaria()?.getSunrise?.(); } catch {}
  try { set = calendaria()?.getSunset?.(); } catch {}
  return { sunrise: toHours(rise, FALLBACK_SUNRISE), sunset: toHours(set, FALLBACK_SUNSET) };
}

export function currentPhase() {
  const h = currentHour();
  const { sunrise, sunset } = sunTimes();
  if (h >= sunrise - DAWN_BEFORE_SUNRISE && h < sunrise + DAWN_AFTER_SUNRISE) return "dawn";
  if (h >= sunset - DUSK_BEFORE_SUNSET && h < sunset + DUSK_AFTER_SUNSET) return "dusk";
  if (h >= sunrise + DAWN_AFTER_SUNRISE && h < sunset - DUSK_BEFORE_SUNSET) return "day";
  return "night";
}

function fileExists(path) {
  if (!exists.has(path)) {
    const url = /^(https?:|\/)/.test(path) ? path : foundry.utils.getRoute(path);
    exists.set(path, fetch(url, { method: "HEAD" }).then((r) => r.ok).catch(() => false));
  }
  return exists.get(path);
}

async function pick(prefix, ext, phase) {
  for (const p of FALLBACKS[phase]) {
    const candidate = `${prefix}_${p}${ext}`;
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

// Foundry 14 keeps the background on the scene's Levels; older scenes keep it on the scene itself.
function backgroundTargets(scene) {
  const levels = scene.levels ? Array.from(scene.levels) : [];
  const withBg = levels.filter((l) => l.background?.src);
  return withBg.length ? withBg : [scene];
}

// ---- fit to 1920x1080
function inSceneryFolder(scene) {
  const name = String(setting("sceneryFolder") || "").trim().toLowerCase();
  if (!name) return false;
  for (let f = scene.folder; f; f = f.folder) if (f.name.trim().toLowerCase() === name) return true;
  return false;
}

async function fitScene(scene) {
  if (!setting("sceneryFit") || !inSceneryFolder(scene)) return false;
  const changes = {};
  if (scene.width !== WIDTH) changes.width = WIDTH;
  if (scene.height !== HEIGHT) changes.height = HEIGHT;
  if (scene.padding !== 0) changes.padding = 0;
  for (const doc of backgroundTargets(scene)) {
    if (!doc.background?.src || doc.background.fit === "cover") continue;
    if (doc === scene) changes["background.fit"] = "cover";
    else await doc.update({ "background.fit": "cover" });
  }
  if (!Object.keys(changes).length) return false;
  await scene.update(changes);
  return true;
}

// ---- crossfade: every screen snapshots its current view, the background swaps underneath, the snapshot fades out
function removeOverlay() { overlay?.remove(); overlay = null; }

function showSnapshot() {
  removeOverlay();
  try {
    const board = document.getElementById("board");
    const r = canvas.app?.renderer;
    if (!board || !r || !canvas.ready) return;
    const rt = PIXI.RenderTexture.create({ width: r.screen.width, height: r.screen.height, resolution: r.resolution });
    r.render(canvas.stage, { renderTexture: rt });
    const snap = r.extract.canvas(rt);
    rt.destroy(true);
    const box = board.getBoundingClientRect();
    const ms = Number(setting("sceneryFadeMs")) || 0;
    Object.assign(snap.style, { position: "fixed", left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`,
      height: `${box.height}px`, pointerEvents: "none", zIndex: getComputedStyle(board).zIndex || "0", opacity: "1",
      transition: `opacity ${ms}ms ease-in-out` });
    board.after(snap);
    overlay = snap;
    setTimeout(() => fadeOut(snap), 8000 + ms);    // failsafe: never leave an old snapshot on screen
  } catch (err) {
    console.warn("Lore Studio Bridge: no crossfade this time.", err);
  }
}

function fadeOut(snap) {
  if (!snap?.isConnected || snap.dataset.fading) return;
  snap.dataset.fading = "1";
  snap.style.opacity = "0";
  setTimeout(() => { snap.remove(); if (overlay === snap) overlay = null; }, (Number(setting("sceneryFadeMs")) || 0) + 100);
}

// After the swap, wait for the new image and for any canvas redraw, then fade the snapshot away.
async function revealNew(src) {
  const snap = overlay;
  if (!snap) return;
  try { await loadTex(src); } catch {}
  const start = Date.now();
  await frame();
  while (!canvas.ready && Date.now() - start < 6000) await frame();
  await frame(); await frame();
  fadeOut(snap);
}

function onMessage(msg) {
  if (!msg || canvas?.scene?.id !== msg.scene) return;
  if (msg.type === "scenery-snapshot") { loadTex(msg.src).catch(() => {}); showSnapshot(); }
  if (msg.type === "scenery-swapped") revealNew(msg.src);
}

function broadcast(msg) { game.socket?.emit(SOCKET, msg); onMessage(msg); }   // emit doesn't echo back, so run it here too

// ---- the GM's browser decides; everyone else just fades
export async function updateScenery() {
  if (!game.user || game.user !== game.users?.activeGM || busy) return;
  const scene = canvas?.scene;
  if (!scene) return;
  busy = true;
  try {
    if (await fitScene(scene)) return;            // the scene redraws; canvasReady calls this again
    if (!setting("sceneryDayNight")) return;
    const phase = currentPhase();
    const changes = [];
    for (const doc of backgroundTargets(scene)) {
      const src = doc.background?.src;
      const m = src ? src.match(PATTERN) : null;
      if (!m) continue;
      const next = await pick(m[1], m[3], phase);
      if (next && next !== src) changes.push([doc, next]);
    }
    if (!changes.length) return;
    const src = changes[0][1];
    const fade = (Number(setting("sceneryFadeMs")) || 0) > 0;
    if (fade) { broadcast({ type: "scenery-snapshot", scene: scene.id, src }); await wait(400); }   // time to snapshot and preload
    for (const [doc, next] of changes) await doc.update({ "background.src": next });
    if (fade) broadcast({ type: "scenery-swapped", scene: scene.id, src });
  } catch (err) {
    console.error("Lore Studio Bridge: scenery", err);
    removeOverlay();
  } finally {
    busy = false;
  }
}

export function registerScenerySettings() {
  const reapply = () => { exists.clear(); updateScenery(); };
  game.settings.register(ID, "sceneryFit", { name: "LORESTUDIO.sceneryFit", hint: "LORESTUDIO.sceneryFitHint", scope: "world", config: true,
    type: Boolean, default: true, onChange: reapply });
  game.settings.register(ID, "sceneryFolder", { name: "LORESTUDIO.sceneryFolder", hint: "LORESTUDIO.sceneryFolderHint", scope: "world", config: true,
    type: String, default: "Static Scenery", onChange: reapply });
  game.settings.register(ID, "sceneryDayNight", { name: "LORESTUDIO.sceneryDayNight", hint: "LORESTUDIO.sceneryDayNightHint", scope: "world", config: true,
    type: Boolean, default: true, onChange: reapply });
  game.settings.register(ID, "sceneryFadeMs", { name: "LORESTUDIO.sceneryFade", hint: "LORESTUDIO.sceneryFadeHint", scope: "world", config: true,
    type: Number, default: 1500, range: { min: 0, max: 5000, step: 100 } });
}

export function startScenery() {
  game.socket?.on(SOCKET, onMessage);
  Hooks.on("calendaria.dateTimeChange", updateScenery);
  Hooks.on("updateWorldTime", updateScenery);
  Hooks.on("canvasReady", updateScenery);
  globalThis.LoreStudioScenery = { update: updateScenery, phase: currentPhase, clearCache: () => exists.clear() };
  updateScenery();
}
