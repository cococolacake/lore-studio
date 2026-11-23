// Runs the bridge's scenery.mjs against a fake Foundry world and prints what it did as JSON.
// Usage: node fake_scenery.mjs <file URL of scenery.mjs>
const log = [];
let hour = 12;
let weather = { id: "heavy-rain", label: "Heavy Rain" };
const files = new Set(["assets/sky_day.jpg", "assets/sky_night.jpg", "sounds/forest_day.ogg", "sounds/forest_night.ogg"]);

const hooks = {};
globalThis.Hooks = { on: (n, f) => (hooks[n] ??= []).push(f), once: (n, f) => (hooks[n] ??= []).push(f), callAll: () => true };
globalThis.CONST = { GRID_TYPES: { GRIDLESS: 0, SQUARE: 1 } };
globalThis.foundry = { utils: { getRoute: (p) => "/" + p } };
globalThis.fetch = async (url) => ({ ok: files.has(String(url).replace(/^\//, "")) });
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
globalThis.document = { getElementById: () => null, head: { append() {} }, body: { classList: { toggle() {} } }, createElement: () => ({}) };
globalThis.window = { innerWidth: 1920, innerHeight: 1080, addEventListener() {}, removeEventListener() {} };

const settings = {};
const folder = { name: "Static Scenery", folder: null };
const flags = {};
const ambient = { path: "sounds/forest_day.ogg", update: async (d) => { Object.assign(ambient, d); log.push("ambient " + d.path); } };
const scene = {
  id: "s1", name: "Sky", folder, width: 4000, height: 2000, padding: 0.25, grid: { type: 1 },
  background: { src: "assets/sky_day.jpg", fit: "fill" }, sounds: { contents: [ambient] },
  update: async (d) => {
    for (const [k, v] of Object.entries(d)) {
      if (k.includes(".")) { const [a, b] = k.split("."); scene[a][b] = v; } else scene[k] = v;
    }
    log.push("scene " + Object.keys(d).sort().join(","));
  },
  activate: async () => { scene.active = true; log.push("activate"); },
  getFlag: (_, k) => flags[k], setFlag: async (_, k, v) => { flags[k] = v; }, unsetFlag: async (_, k) => { delete flags[k]; },
};
const gm = { isGM: true };
globalThis.game = {
  user: gm, users: { activeGM: gm }, modules: new Map(), playlists: { contents: [] }, i18n: { has: () => false },
  scenes: { get: (id) => (id === "s1" ? scene : null) },
  settings: { register: (_, k, o) => { settings[k] = o.default; }, get: (_, k) => settings[k] },
};
globalThis.canvas = { scene, ready: true };
globalThis.CALENDARIA = { api: { getCurrentDateTime: () => ({ hour, minute: 0 }), getSunrise: () => 6, getSunset: () => 19, getCurrentWeather: () => weather } };
const played = [];
globalThis.FXMASTER = { api: { effects: {
  play: async ({ particles }) => { played.push(particles.map((p) => p.type).join("+")); return { particles: particles.map((p, i) => `apiMacro_${p.type}_${i}`), filters: [] }; },
  stop: async ({ particles }) => { log.push("stop " + particles.join(",")); return {}; },
} } };

const mod = await import(process.argv[2]);
const reports = [];
mod.registerScenerySettings();
mod.startScenery((ev) => reports.push(ev));
const settle = () => new Promise((r) => setTimeout(r, 30));
await settle();
const fitted = { width: scene.width, height: scene.height, padding: scene.padding, grid: scene.grid.type, fit: scene.background.fit };
await mod.updateScenery(); await settle();                       // canvasReady after the fit
const noon = { bg: scene.background.src, weather: [...played], phase: mod.currentPhase() };
hour = 19; await mod.updateScenery(); await settle();             // dusk: no _dusk file, so it stays on day
const dusk = { bg: scene.background.src, phase: mod.currentPhase() };
hour = 22; weather = { id: "clear", label: "Clear" };
await mod.updateScenery(); await settle();                        // night: background and ambient sound switch, rain stops
const night = { bg: scene.background.src, sound: ambient.path, phase: mod.currentPhase(), flag: flags.weather ?? null };
const shown = await mod.showScenery("s1");
console.log(JSON.stringify({ fitted, noon, dusk, night, reports, log, shown, isScenery: mod.isScenery(scene) }));
process.exit(0);
