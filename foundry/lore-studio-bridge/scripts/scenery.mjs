// Lore Studio Bridge: scenery. Works on its own; Lore Studio doesn't need to be open. Every part has a switch in
// Module Settings.
//
// Fit to 1920x1080: scenes in the scenery folder are sized to 1920x1080, gridless, and their background is set to
//   "cover", so any image fills the screen with the edges cropped. The image files aren't changed.
// Time of day: files named like canyon_dawn.webp, canyon_day.webp, canyon_dusk.webp, canyon_night.webp (same folder, same
//   extension) follow Calendaria's clock, or Foundry's world time without it. That goes for scene backgrounds, ambient
//   sounds placed on the scene and playing playlist sounds. Missing versions are skipped: dawn and dusk fall back to
//   day, night to dusk and then day.
// Crossfade: background changes, and scenery shown from Lore Studio, fade from the old image to the new on every screen.
// Weather: Calendaria's weather plays matching FXMaster effects (rain, snow, fog, clouds...) on scenery scenes.
// Scenery mode: on scenery scenes, players get the picture only: no scene controls or token HUD, and a locked view.
const ID = "lore-studio-bridge";
const SOCKET = `module.${ID}`;
const WIDTH = 1920, HEIGHT = 1080;
const DAWN_BEFORE_SUNRISE = 1, DAWN_AFTER_SUNRISE = 1.5, DUSK_BEFORE_SUNSET = 1.5, DUSK_AFTER_SUNSET = 1;
const FALLBACK_SUNRISE = 6, FALLBACK_SUNSET = 19;
const PATTERN = /^(.*)_(dawn|day|dusk|night)(\.\w+)$/;
const FALLBACKS = { dawn: ["dawn", "day"], day: ["day"], dusk: ["dusk", "day"], night: ["night", "dusk", "day"] };
const SOUND_FADE_MS = 3000;

// Calendaria weather (matched by its name or id, first match wins) -> FXMaster particle effects.
// FXMaster+ effects (sandstorm) are skipped when FXMaster+ isn't active.
const WEATHER_FX = [
  [/blizzard|snowstorm/, [{ type: "snowstorm" }]],
  [/snow|flurr|sleet/, [{ type: "snow" }]],
  [/hail/, [{ type: "hail" }]],
  [/thunder|storm|downpour|monsoon|heavy rain|torrent/, [{ type: "rain", options: { density: 0.8 } }, { type: "clouds" }]],
  [/rain|drizzle|shower/, [{ type: "rain" }]],
  [/sand|dust/, [{ type: "sandstorm", plus: true }]],
  [/fog|mist|haze|smog/, [{ type: "fog" }]],
  [/ash|ember|cinder|volcan/, [{ type: "embers" }]],
  [/overcast|cloud/, [{ type: "clouds" }]],
];

const exists = new Map();   // file path -> Promise<boolean>
let busy = false;
let overlay = null;
let lastPhase = null;
let lastWeather = null;
let onScenery = () => {};    // set by the bridge: reports scene, time of day and weather for session recaps

function setting(key) { try { return game.settings.get(ID, key); } catch { return undefined; } }
// Load (and cache) a texture; never throws, so a failed preload can't stop a background change.
async function loadTex(src) {
  try { const load = foundry.canvas?.loadTexture ?? globalThis.loadTexture; if (load) await load(src); } catch {}
}
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const isActiveGM = () => !!game.user && game.user === game.users?.activeGM;
const fadeMs = () => Math.max(0, Number(setting("sceneryFadeMs")) || 0);

// ---- time of day ------------------------------------------------------------------------------
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

/** The in-game date as Calendaria writes it, if it can. */
function currentDate() {
  try {
    const api = calendaria();
    const s = api?.formatDate?.(api.getCurrentDateTime?.()) ?? api?.getFormattedDate?.();
    if (typeof s === "string") return s;
  } catch {}
  return "";
}

function fileExists(path) {
  if (!exists.has(path)) {
    const url = /^(https?:|\/)/.test(path) ? path : foundry.utils.getRoute(path);
    exists.set(path, fetch(url, { method: "HEAD" }).then((r) => r.ok).catch(() => false));
  }
  return exists.get(path);
}

/** Time of day, in-game date and weather, for the session log. */
export function sceneryInfo() {
  return { daypart: currentPhase(), date: currentDate(), weather: weatherLabel(currentWeather()) };
}

/** The best existing file for this time of day, or null if the path isn't a _dawn/_day/_dusk/_night file. */
async function forPhase(path, phase) {
  const m = path ? String(path).match(PATTERN) : null;
  if (!m) return null;
  for (const p of FALLBACKS[phase]) {
    const candidate = `${m[1]}_${p}${m[3]}`;
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

// ---- scenery scenes ---------------------------------------------------------------------------
export function isScenery(scene) {
  const name = String(setting("sceneryFolder") || "").trim().toLowerCase();
  if (!scene || !name) return false;
  for (let f = scene.folder; f; f = f.folder) if (String(f.name).trim().toLowerCase() === name) return true;
  return false;
}

async function fitScene(scene) {
  if (!setting("sceneryFit") || !isScenery(scene)) return false;
  const changes = {};
  if (scene.width !== WIDTH) changes.width = WIDTH;
  if (scene.height !== HEIGHT) changes.height = HEIGHT;
  if (scene.padding !== 0) changes.padding = 0;
  const gridless = CONST.GRID_TYPES?.GRIDLESS ?? 0;
  if (scene.grid?.type !== gridless) changes["grid.type"] = gridless;
  for (const doc of backgroundTargets(scene)) {
    if (!doc.background?.src || doc.background.fit === "cover") continue;
    if (doc === scene) changes["background.fit"] = "cover";
    else await doc.update({ "background.fit": "cover" });
  }
  if (!Object.keys(changes).length) return false;
  await scene.update(changes);
  return true;
}

// ---- crossfade: every screen snapshots its view, the change happens underneath, the snapshot fades out -----------
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
    Object.assign(snap.style, { position: "fixed", left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`,
      height: `${box.height}px`, pointerEvents: "none", zIndex: getComputedStyle(board).zIndex || "0", opacity: "1",
      transition: `opacity ${fadeMs()}ms ease-in-out` });
    board.after(snap);
    overlay = snap;
    setTimeout(() => fadeOut(snap), 12000 + fadeMs());    // failsafe: never leave an old snapshot on screen
  } catch (err) {
    console.warn("Lore Studio Bridge: no crossfade this time.", err);
  }
}

function fadeOut(snap) {
  if (!snap?.isConnected || snap.dataset.fading) return;
  snap.dataset.fading = "1";
  snap.style.opacity = "0";
  setTimeout(() => { snap.remove(); if (overlay === snap) overlay = null; }, fadeMs() + 100);
}

// Wait for the new picture (and for the scene to finish loading if it changed), then fade the snapshot away.
async function reveal({ src, scene }) {
  const snap = overlay;
  if (!snap) return;
  if (src) await loadTex(src);
  const start = Date.now();
  await frame();
  while (Date.now() - start < 10000 && (!canvas.ready || (scene && canvas.scene?.id !== scene))) await frame();
  await frame(); await frame();
  fadeOut(snap);
}

function onMessage(msg) {
  if (!msg) return;
  const here = canvas?.scene?.id;
  if (msg.type === "scenery-snapshot" && (msg.scene === "*" || msg.scene === here)) {
    if (msg.src) loadTex(msg.src);
    showSnapshot();
  }
  if (msg.type === "scenery-swapped") reveal({ src: msg.src, scene: msg.to });
}

function broadcast(msg) { game.socket?.emit(SOCKET, msg); onMessage(msg); }   // emit doesn't echo back, so run it here too

// ---- time-of-day sounds -------------------------------------------------------------------------
async function updateSounds(scene, phase) {
  if (!setting("scenerySounds")) return;
  // ambient sounds placed on this scene
  for (const snd of scene.sounds?.contents ?? []) {
    const next = await forPhase(snd.path, phase);
    if (next && next !== snd.path) await snd.update({ path: next });
  }
  // playlist sounds that are playing right now (a playing sound restarts with its fade, so it eases in)
  for (const pl of game.playlists?.contents ?? []) {
    for (const so of pl.sounds?.contents ?? []) {
      if (!so.playing) continue;
      const next = await forPhase(so.path, phase);
      if (next && next !== so.path) await so.update({ path: next, ...(so.fade ? {} : { fade: SOUND_FADE_MS }) });
    }
  }
}

// ---- weather -> FXMaster ---------------------------------------------------------------------------
/** Calendaria's current weather, whatever shape this version gives it in. */
export function currentWeather() {
  const api = calendaria();
  if (!api) return null;
  for (const fn of ["getCurrentWeather", "getWeather", "currentWeather"]) {
    try {
      const w = typeof api[fn] === "function" ? api[fn]() : null;
      if (w) return w;
    } catch {}
  }
  return null;
}

function weatherName(w) {
  if (!w) return "";
  if (typeof w === "string") return w;
  const parts = [w.id, w.key, w.preset, w.name, w.label, w.type, w.condition, w.weather?.label, w.weather?.id];
  return parts.filter((x) => typeof x === "string").join(" ");
}

function weatherLabel(w) {
  if (!w) return "";
  if (typeof w === "string") return w;
  const raw = w.label || w.name || w.weather?.label || w.id || "";
  const s = typeof raw === "string" ? raw : "";
  return s && game.i18n?.has?.(s) ? game.i18n.localize(s) : s;
}

// FXMaster's own defaults for an effect, when this version exposes them.
function fxDefaults(type) {
  const cls = globalThis.CONFIG?.fxmaster?.particleEffects?.[type];
  try {
    const d = cls?.default ?? (cls?.parameters ? Object.fromEntries(Object.entries(cls.parameters).map(([k, v]) => [k, v?.value])) : null);
    return d && typeof d === "object" ? d : {};
  } catch { return {}; }
}

// Weather strength (Module Settings, 10-100%) scales speed, density and opacity down from FXMaster's defaults.
// Clouds and fog cover the whole picture, so they're slowed down twice as much.
function tone(type, options = {}) {
  const k = Math.min(1, Math.max(0.1, (Number(setting("sceneryWeatherStrength")) || 40) / 100));
  const d = fxDefaults(type);
  const out = { ...options };
  const slow = type === "clouds" || type === "fog" ? k * k : k;
  const num = (key, fallback) => (typeof out[key] === "number" ? out[key] : typeof d[key] === "number" ? d[key] : fallback);
  const speed = num("speed", 1);
  out.speed = Math.round(speed * slow * 1000) / 1000;
  const density = num("density", null);
  if (density != null) out.density = Math.round(density * k * 1000) / 1000;
  const alpha = num("alpha", 1);
  out.alpha = Math.round(Math.min(1, alpha * (0.4 + 0.6 * k)) * 1000) / 1000;
  return out;
}

function weatherEffects(w) {
  const name = weatherName(w).toLowerCase();
  if (!name) return [];
  const plus = !!game.modules?.get("fxmaster-plus")?.active;
  for (const [re, fx] of WEATHER_FX) {
    if (re.test(name)) return fx.filter((e) => !e.plus || plus).map(({ type, options }) => ({ type, options: tone(type, options) }));
  }
  return [];
}

async function updateWeather(scene) {
  const fx = globalThis.FXMASTER?.api?.effects;
  if (!fx || !setting("sceneryWeather")) return;
  const want = isScenery(scene) || setting("sceneryWeatherEverywhere") ? weatherEffects(currentWeather()) : [];
  const key = JSON.stringify(want);
  const prev = scene.getFlag(ID, "weather") || null;
  if (prev ? prev.key === key : !want.length) return;
  if (prev) {
    try { await fx.stop({ scene, ...(prev.ids || {}) }); }
    catch { try { await fx.stop({ scene, particles: prev.particles || [] }); } catch {} }
  }
  if (!want.length) { await scene.unsetFlag(ID, "weather"); return; }
  let ids = null;
  try { ids = await fx.play({ scene, particles: want }); } catch (err) { console.warn("Lore Studio Bridge: FXMaster weather", err); return; }
  await scene.setFlag(ID, "weather", { key, particles: want, ids: ids && typeof ids === "object" ? { particles: ids.particles || [], filters: ids.filters || [] } : null });
}

// ---- scenery mode: players see the picture, nothing else -------------------------------------------------
let locked = false;

function coverView() {
  const d = canvas.dimensions;
  if (!d) return null;
  const r = d.sceneRect ?? { x: d.sceneX ?? 0, y: d.sceneY ?? 0, width: d.sceneWidth ?? WIDTH, height: d.sceneHeight ?? HEIGHT };
  const scale = Math.max(window.innerWidth / r.width, window.innerHeight / r.height);
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, scale };
}

function refit() { if (locked) canvas.pan(); }

// Replace this canvas's pan and animatePan so every pan (mouse wheel, dragging, keys, resizes) lands on the cover view.
function lockView(on) {
  document.body.classList.toggle("lsb-scenery", on);
  const proto = Object.getPrototypeOf(canvas);
  if (on) {
    canvas.pan = function (...args) { const v = coverView(); return v ? proto.pan.call(this, v) : proto.pan.apply(this, args); };
    canvas.animatePan = function (...args) { const v = coverView(); return v ? proto.pan.call(this, v) : proto.animatePan.apply(this, args); };
    if (!locked) window.addEventListener("resize", refit);
    locked = true;
    canvas.pan();
  } else if (locked) {
    delete canvas.pan;
    delete canvas.animatePan;
    window.removeEventListener("resize", refit);
    locked = false;
  }
}

function applySceneryMode() {
  const on = !!setting("sceneryMode") && !game.user?.isGM && isScenery(canvas?.scene);
  if (on || locked) lockView(on);
}

function addStyles() {
  if (document.getElementById("lsb-scenery-style")) return;
  const css = `
body.lsb-scenery #scene-controls, body.lsb-scenery #controls, body.lsb-scenery #token-hud,
body.lsb-scenery #hud, body.lsb-scenery #measurement { display: none !important; }`;
  document.head.append(Object.assign(document.createElement("style"), { id: "lsb-scenery-style", textContent: css }));
}

// ---- show a scene from Lore Studio, crossfading into it ------------------------------------------------------
export async function showScenery(sceneId) {
  const scene = game.scenes.get(sceneId);
  if (!scene) throw new Error("That scene isn't in this world.");
  if (scene.active && canvas.scene?.id === scene.id) return { name: scene.name, already: true };
  const src = backgroundTargets(scene)[0]?.background?.src || "";
  const fade = fadeMs() > 0;
  if (fade) { broadcast({ type: "scenery-snapshot", scene: "*", src }); await wait(400); }
  await scene.activate();
  if (fade) broadcast({ type: "scenery-swapped", src, to: scene.id });
  return { name: scene.name };
}

// ---- the active GM's browser makes the changes; everyone else just fades --------------------------------------
export async function updateScenery() {
  if (!isActiveGM() || busy) return;
  const scene = canvas?.scene;
  if (!scene) return;
  busy = true;
  try {
    if (await fitScene(scene)) return;            // the scene redraws; canvasReady calls this again
    const phase = currentPhase();
    if (setting("sceneryDayNight")) {
      const changes = [];
      for (const doc of backgroundTargets(scene)) {
        const next = await forPhase(doc.background?.src, phase);
        if (next && next !== doc.background.src) changes.push([doc, next]);
      }
      if (changes.length) {
        const src = changes[0][1];
        const fade = fadeMs() > 0;
        if (fade) { broadcast({ type: "scenery-snapshot", scene: scene.id, src }); await wait(400); }
        for (const [doc, next] of changes) await doc.update({ "background.src": next });
        if (fade) broadcast({ type: "scenery-swapped", src });
      }
    }
    await updateSounds(scene, phase);
    await updateWeather(scene);
    // tell the session log when the time of day or the weather changes (scene changes are logged by the bridge)
    const weather = weatherLabel(currentWeather());
    const changed = lastPhase !== null && (phase !== lastPhase || weather !== lastWeather);
    lastPhase = phase; lastWeather = weather;
    if (changed) onScenery({ scene: scene.navName || scene.name, ...sceneryInfo() });
  } catch (err) {
    console.error("Lore Studio Bridge: scenery", err);
    removeOverlay();
  } finally {
    busy = false;
  }
}

export function registerScenerySettings() {
  const reapply = () => { exists.clear(); updateScenery(); };
  const reapplyAll = () => { applySceneryMode(); reapply(); };
  const reg = (key, type, def, extra = {}) => game.settings.register(ID, key, {
    name: `LORESTUDIO.${key}`, hint: `LORESTUDIO.${key}Hint`, scope: "world", config: true, type, default: def, onChange: reapply, ...extra });
  reg("sceneryFolder", String, "Static Scenery", { onChange: reapplyAll });
  reg("sceneryFit", Boolean, true);
  reg("sceneryMode", Boolean, true, { onChange: reapplyAll });
  reg("sceneryDayNight", Boolean, true);
  reg("scenerySounds", Boolean, true);
  reg("sceneryFadeMs", Number, 1500, { range: { min: 0, max: 5000, step: 100 }, onChange: undefined });
  reg("sceneryWeather", Boolean, true);
  reg("sceneryWeatherStrength", Number, 40, { range: { min: 10, max: 100, step: 5 } });
  reg("sceneryWeatherEverywhere", Boolean, false);
}

/** Start everything. `report` receives {scene, daypart, date, weather} whenever one of them changes. */
export function startScenery(report) {
  if (typeof report === "function") onScenery = report;
  addStyles();
  game.socket?.on(SOCKET, onMessage);
  Hooks.on("calendaria.dateTimeChange", updateScenery);
  Hooks.on("updateWorldTime", updateScenery);
  Hooks.on("canvasReady", () => { applySceneryMode(); updateScenery(); });
  // Calendaria's weather hooks: react to any calendaria.* hook about weather, whatever this version names it
  const callAll = Hooks.callAll;
  if (typeof callAll === "function") {
    Hooks.callAll = function (name, ...args) {
      const r = callAll.call(this, name, ...args);
      if (typeof name === "string" && /^calendaria\./i.test(name) && /weather/i.test(name)) updateScenery();
      return r;
    };
  }
  globalThis.LoreStudioScenery = { update: updateScenery, phase: currentPhase, weather: currentWeather,
    effects: () => weatherEffects(currentWeather()), show: showScenery, clearCache: () => exists.clear() };
  applySceneryMode();
  updateScenery();
}
