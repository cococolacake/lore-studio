// Lore Studio Bridge: scenery sounds. The GM keeps a small library of sounds (Rain, Forest, Wind...), says which one
// plays for each kind of weather and which one loops on each scene, in Module Settings → Scenery sounds.
// Every player's browser plays them itself, fading between them as the scene, the weather or the time of day changes.
// A file named like forest_day.ogg / forest_night.ogg follows the time of day, the same way backgrounds do.
import { currentPhase, currentWeather, weatherName, isScenery, forPhase, onWeatherChange } from "./scenery.mjs";

const ID = "lore-studio-bridge";
const KEY = "scenerySoundLibrary";
const FADE_MS = 2500;

// Weather slots, matched against Calendaria's weather name like the visual effects. First match wins; each slot falls
// back to the next one listed in `or` when you haven't chosen a sound for it. Sand comes first: "sandstorm" contains "storm".
export const WEATHER_SLOTS = [
  { key: "sandstorm", label: "Sandstorm", re: /sand|dust/, or: ["wind"] },
  { key: "blizzard", label: "Blizzard", re: /blizzard|snowstorm/, or: ["wind", "snow"] },
  { key: "snow", label: "Snow", re: /snow|flurr|sleet/, or: [] },
  { key: "hail", label: "Hail", re: /hail/, or: ["storm", "rain"] },
  { key: "storm", label: "Thunderstorm", re: /thunder|storm|downpour|monsoon|heavy rain|torrent/, or: ["rain"] },
  { key: "rain", label: "Rain", re: /rain|drizzle|shower/, or: [] },
  { key: "wind", label: "Wind", re: /wind|gale|gust|breez/, or: [] },
  { key: "fog", label: "Fog", re: /fog|mist|haze|smog/, or: [] },
];

export function library() {
  let v;
  try { v = game.settings.get(ID, KEY); } catch { v = null; }
  return { sounds: Array.isArray(v?.sounds) ? v.sounds : [], weather: v?.weather || {}, scenes: v?.scenes || {} };
}

export function registerSoundscapeSettings() {
  game.settings.register(ID, KEY, { scope: "world", config: false, type: Object, default: { sounds: [], weather: {}, scenes: {} },
    onChange: () => updateSoundscape() });
  game.settings.registerMenu(ID, "scenerySoundsMenu", {
    name: "LORESTUDIO.scenerySoundsMenu", label: "LORESTUDIO.scenerySoundsMenuLabel", hint: "LORESTUDIO.scenerySoundsMenuHint",
    icon: "fa-solid fa-cloud-rain", type: SoundsMenu, restricted: true });
}

// ---- what should be playing ---------------------------------------------------------------------------------
function weatherSlot() {
  const name = weatherName(currentWeather()).toLowerCase();
  if (!name) return null;
  return WEATHER_SLOTS.find((s) => s.re.test(name)) || null;
}

function soundFor(id, lib) { return id ? lib.sounds.find((s) => s.id === id && s.path) || null : null; }

function weatherSound(lib) {
  const slot = weatherSlot();
  if (!slot) return null;
  for (const key of [slot.key, ...slot.or]) {
    const s = soundFor(lib.weather[key], lib);
    if (s) return s;
  }
  return null;
}

function weatherHere(scene) {
  let everywhere = false;
  try { everywhere = game.settings.get(ID, "sceneryWeatherEverywhere"); } catch {}
  return isScenery(scene) || everywhere;
}

// ---- playing: each layer ("ambience", "weather") holds one looping sound and fades to the next -------------------
const layers = { ambience: null, weather: null };   // layer -> { src, sound, volume }
let running = Promise.resolve();

function masterVolume() {
  try { const v = Number(game.settings.get("core", "globalAmbientVolume")); return Number.isFinite(v) ? v : 1; } catch { return 1; }
}

async function startSound(src, volume) {
  const helper = foundry.audio?.AudioHelper ?? globalThis.AudioHelper;
  const sound = await helper.play({ src, volume: 0, loop: true }, false);
  try { sound?.fade?.(volume, { duration: FADE_MS }); } catch {}
  return sound;
}

function stopSound(sound) {
  if (!sound) return;
  try { sound.fade?.(0, { duration: FADE_MS }); } catch {}
  setTimeout(() => { try { sound.stop?.(); } catch {} }, FADE_MS + 100);
}

async function setLayer(name, entry) {
  const cur = layers[name];
  const src = entry ? (await forPhase(entry.path, currentPhase())) || entry.path : null;
  const volume = entry ? Math.max(0, Math.min(1, Number(entry.volume ?? 0.5))) * masterVolume() : 0;
  if (cur && cur.src === src) {
    if (Math.abs(cur.volume - volume) > 0.01) { try { cur.sound?.fade?.(volume, { duration: 600 }); } catch {} cur.volume = volume; }
    return;
  }
  if (cur) stopSound(cur.sound);
  layers[name] = null;
  if (!src) return;
  try { layers[name] = { src, volume, sound: await startSound(src, volume) }; }
  catch (err) { console.warn(`Lore Studio Bridge: couldn't play ${src}`, err); }
}

/** Bring this browser's scenery sounds in line with the scene, the weather and the time of day. */
export function updateSoundscape() {
  if (!globalThis.canvas) return running;
  running = running.then(async () => {
    const scene = canvas?.scene;
    const lib = library();
    await setLayer("ambience", scene ? soundFor(lib.scenes[scene.id], lib) : null);
    await setLayer("weather", scene && weatherHere(scene) ? weatherSound(lib) : null);
  }).catch((err) => console.error("Lore Studio Bridge: scenery sounds", err));
  return running;
}

export function startSoundscape() {
  // browsers only allow sound after the first click or key press; try again then
  const kick = () => { updateSoundscape(); window.removeEventListener("pointerdown", kick); window.removeEventListener("keydown", kick); };
  window.addEventListener("pointerdown", kick);
  window.addEventListener("keydown", kick);
  Hooks.on("canvasReady", updateSoundscape);
  Hooks.on("updateWorldTime", updateSoundscape);
  Hooks.on("calendaria.dateTimeChange", updateSoundscape);
  onWeatherChange(updateSoundscape);
  Hooks.on("updateSetting", (s) => { if (s?.key === "core.globalAmbientVolume") updateSoundscape(); });
  updateSoundscape();
}

// ---- the menu ---------------------------------------------------------------------------------------------------
const AppV2 = foundry.applications?.api?.ApplicationV2;
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "style") Object.assign(e.style, v);
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) e.append(kid);
  return e;
};
const newId = () => foundry.utils.randomID?.() ?? Math.random().toString(36).slice(2, 12);

export class SoundsMenu extends (AppV2 ?? class {}) {
  static DEFAULT_OPTIONS = {
    id: "lore-studio-scenery-sounds", tag: "div", window: { title: "Scenery sounds", icon: "fa-solid fa-cloud-rain", resizable: true },
    position: { width: 640, height: 720 },
  };

  #draft = null;
  #preview = null;

  get draft() { return (this.#draft ??= foundry.utils.deepClone(library())); }

  async _renderHTML() {
    const d = this.draft;
    const options = (selected) => [el("option", { value: "" }, "None"),
      ...d.sounds.map((s) => el("option", { value: s.id, selected: s.id === selected }, s.name || "(unnamed)"))];
    const section = (title, hint, ...body) => el("section", { style: { marginBottom: "14px" } },
      el("h3", { style: { margin: "0 0 2px", borderBottom: "1px solid var(--color-border, #555)" } }, title),
      el("p", { style: { margin: "2px 0 8px", opacity: "0.75", fontSize: "12px" } }, hint), ...body);
    const row = (...kids) => el("div", { style: { display: "flex", gap: "6px", alignItems: "center", marginBottom: "6px" } }, ...kids);

    const soundRows = d.sounds.map((s) => row(
      el("input", { type: "text", value: s.name || "", placeholder: "Name, like Rain", style: { flex: "0 0 130px" },
        onchange: (e) => { s.name = e.target.value.trim(); this.render(); } }),
      el("input", { type: "text", value: s.path || "", placeholder: "Sound file", style: { flex: "1" },
        onchange: (e) => { s.path = e.target.value.trim(); } }),
      el("button", { type: "button", title: "Choose a file", style: { flex: "0 0 32px" }, onclick: () => this.#pick(s) }, el("i", { class: "fa-solid fa-folder-open" })),
      el("input", { type: "range", min: 0, max: 1, step: 0.05, value: s.volume ?? 0.5, title: "Volume", style: { flex: "0 0 80px" },
        oninput: (e) => { s.volume = Number(e.target.value); } }),
      el("button", { type: "button", title: "Preview", style: { flex: "0 0 32px" }, onclick: () => this.#play(s) }, el("i", { class: "fa-solid fa-play" })),
      el("button", { type: "button", title: "Remove", style: { flex: "0 0 32px" }, onclick: () => { d.sounds = d.sounds.filter((x) => x !== s); this.render(); } },
        el("i", { class: "fa-solid fa-trash" }))));

    const weatherRows = WEATHER_SLOTS.map((slot) => row(
      el("label", { style: { flex: "0 0 130px" } }, slot.label),
      el("select", { style: { flex: "1" }, onchange: (e) => { d.weather[slot.key] = e.target.value || undefined; } }, options(d.weather[slot.key])),
      el("span", { style: { flex: "0 0 150px", opacity: "0.6", fontSize: "11px" } },
        slot.or.length ? `If none: ${slot.or.map((k) => WEATHER_SLOTS.find((x) => x.key === k)?.label).join(", then ")}` : "")));

    const scenes = [...game.scenes.contents].sort((a, b) => (isScenery(b) - isScenery(a)) || a.name.localeCompare(b.name));
    const sceneRows = scenes.map((sc) => row(
      el("label", { style: { flex: "0 0 200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: sc.name },
        sc.name, isScenery(sc) ? el("span", { style: { opacity: "0.6", fontSize: "11px" } }, "  scenery") : null),
      el("select", { style: { flex: "1" }, onchange: (e) => { d.scenes[sc.id] = e.target.value || undefined; } }, options(d.scenes[sc.id]))));

    return el("div", { class: "standard-form", style: { padding: "8px 10px", overflowY: "auto", height: "100%" } },
      section("Your sounds", "Name each sound once and pick its file. Files named like forest_day.ogg and forest_night.ogg follow the time of day.",
        ...soundRows,
        el("button", { type: "button", onclick: () => { d.sounds.push({ id: newId(), name: "", path: "", volume: 0.5 }); this.render(); } },
          el("i", { class: "fa-solid fa-plus" }), " Add a sound")),
      section("Weather sounds", "Plays with Calendaria's weather, on scenery scenes (and on every scene if that's on in Module Settings).", ...weatherRows),
      section("Scene ambience", "Loops while a scene is open, under any weather sound.", ...sceneRows),
      el("footer", { class: "form-footer", style: { display: "flex", gap: "8px", position: "sticky", bottom: "0", padding: "8px 0", background: "inherit" } },
        el("button", { type: "button", onclick: () => this.close() }, "Cancel"),
        el("button", { type: "button", class: "bright", onclick: () => this.#save() }, el("i", { class: "fa-solid fa-floppy-disk" }), " Save")));
  }

  _replaceHTML(result, content) { content.replaceChildren(result); }

  #pick(s) {
    const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    new FP({ type: "audio", current: s.path || "", callback: (path) => { s.path = path; this.render(); } }).render(true);
  }

  async #play(s) {
    try { this.#preview?.stop?.(); } catch {}
    if (!s.path) return ui.notifications?.warn("Choose a file for this sound first.");
    const helper = foundry.audio?.AudioHelper ?? globalThis.AudioHelper;
    this.#preview = await helper.play({ src: s.path, volume: (s.volume ?? 0.5) * masterVolume(), loop: false }, false);
    setTimeout(() => { try { this.#preview?.stop?.(); } catch {} }, 8000);
  }

  async #save() {
    const d = this.draft;
    d.sounds = d.sounds.filter((s) => s.path || s.name);
    const known = new Set(d.sounds.map((s) => s.id));
    for (const map of [d.weather, d.scenes]) for (const k of Object.keys(map)) if (!known.has(map[k])) delete map[k];
    await game.settings.set(ID, KEY, d);
    ui.notifications?.info("Scenery sounds saved.");
    this.close();
  }

  async close(options) {
    try { this.#preview?.stop?.(); } catch {}
    return super.close?.(options);
  }
}
