// A tiny stand-in for a Foundry VTT world, enough to run the Lore Studio Bridge module against Lore Studio in tests.
const [url, token, modulePath] = process.argv.slice(2);
const hooks = {};
globalThis.Hooks = { on: (n, f) => (hooks[n] ??= []).push(f), once: (n, f) => (hooks[n] ??= []).push(f) };
const call = async (n, ...a) => { for (const f of hooks[n] || []) await f(...a); };
const vals = { enabled: true, url, token };
globalThis.window = { location: { origin: "http://100.64.0.5:30000" } };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2, NONE: 0 }, JOURNAL_ENTRY_PAGE_FORMATS: { HTML: 1 } };
globalThis.ui = { notifications: { info() {}, warn() {} } };
globalThis.DOMParser = class { parseFromString(s) { return { body: { textContent: String(s).replace(/<[^>]+>/g, "") } }; } };
const coll = (arr) => Object.assign(arr, { contents: arr, get: (id) => arr.find((x) => x.id === id), getName: (n) => arr.find((x) => x.name === n) });
const log = [];
const tables = coll([{ id: "t1", name: "Wild Magic", formula: "1d20", folder: null,
  draw: async () => ({ roll: { total: 7 }, results: [{ description: "<p>You turn blue.</p>" }] }) }]);
const sheetOpened = [];
const actors = coll([{ id: "a1", name: "Goblin", type: "npc", img: "icons/goblin.png", folder: { name: "Monsters" },
  system: { attributes: { ac: { value: 15 }, hp: { value: 7, max: 7 }, movement: { walk: 30 }, senses: { darkvision: 60 } },
    details: { cr: 0.25, type: { value: "humanoid" }, alignment: "neutral evil", biography: { value: "<p>Sneaky.</p>" } },
    abilities: { str: { value: 8, mod: -1 }, dex: { value: 14, mod: 2 } }, traits: { size: "sm" } },
  items: { contents: [{ name: "Scimitar", type: "weapon", system: { description: { value: "<p>Slash.</p>" } } }] },
  sheet: { render: () => sheetOpened.push("a1") },
  getTokenDocument: async (d) => ({ toObject: () => ({ actorId: "a1", ...d }) }) }]);
const tokens = [];
const scene = { id: "s1", name: "The Cellar", navName: "", active: false, thumb: "", folder: null, grid: { size: 100 },
  view: async () => { log.push("view s1"); }, activate: async () => { scene.active = true; log.push("activate s1"); },
  createEmbeddedDocuments: async (t, docs) => { tokens.push(...docs); return docs; } };
const scenes = coll([scene]);
const sound = { id: "so1", name: "Rain", playing: false };
const pl = { id: "p1", name: "Ambience", playing: false, sounds: coll([sound]),
  playSound: async (so) => { so.playing = true; pl.playing = true; }, stopSound: async (so) => { so.playing = false; },
  playAll: async () => { pl.playing = true; }, stopAll: async () => { pl.playing = false; sound.playing = false; } };
const playlists = Object.assign(coll([pl]), { get playing() { return [pl].filter((x) => x.playing); } });
const journals = [];
globalThis.game = { user: { isGM: true, name: "GM" }, world: { title: "Test World" }, version: "14.369", system: { id: "dnd5e", version: "5.3.1" },
  settings: { register() {}, get: (_, k) => vals[k] }, folders: [], journal: journals, tables, actors, scenes, playlists };
globalThis.canvas = { scene, dimensions: { width: 2000, height: 2000 }, stage: { pivot: { x: 1000, y: 1000 } } };
globalThis.Folder = { create: async (d) => { const f = { id: "f" + game.folders.length, ...d }; game.folders.push(f); return f; } };
globalThis.JournalEntry = { create: async (d) => { const e = { ...d, pages: Object.assign([...(d.pages || [])], { map: (f) => [] }),
  getFlag: (_, k) => d.flags["lore-studio-bridge"][k] }; journals.push(e); log.push("journal " + d.name + " pages=" + d.pages.map((p) => p.type).join("+")); return e; } };
globalThis.foundry = { applications: { apps: { FilePicker: { implementation: {
  createDirectory: async () => {}, upload: async (src, dir, file) => { log.push(`upload ${dir}/${file.name} ${file.size}b`); return { path: `${dir}/${file.name}` }; } } } } },
  documents: { collections: { Journal: { show: async (e, o) => { log.push("show " + e.name + (o.force ? " force" : "")); } } } } };
await import(modulePath);
await call("init"); await call("ready");
// report what happened when asked
setInterval(() => { try { require; } catch {} }, 100000);
process.on("SIGTERM", () => { console.log(JSON.stringify({ log, tokens, sheetOpened, sound: sound.playing, active: scene.active })); process.exit(0); });
