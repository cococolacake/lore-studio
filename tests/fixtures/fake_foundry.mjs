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
// monster maker: full actor data, compendiums, creating and updating actors
const goblin = actors[0];
goblin.toObject = () => ({ _id: "a1", name: "Goblin", type: "npc", system: { ...goblin.system, abilities: { str: { value: 8 }, dex: { value: 14, proficient: 1 }, con: { value: 10 }, int: { value: 10 }, wis: { value: 8 }, cha: { value: 8 } },
  attributes: { ...goblin.system.attributes, ac: { flat: 15 }, hp: { value: 7, max: 7, formula: "2d6" } }, skills: { ste: { value: 2 } } },
  items: [{ name: "Scimitar", type: "weapon", system: { description: { value: "<p>Melee Weapon Attack: [[/r 1d20+4]]{+4} to hit. Hit: 5 ([[/r 1d6+2]]{1d6 + 2}) slashing damage.</p>" },
    activities: { x: { activation: { type: "action" } } } } }] });
// a wizard 5 with a broken level-up: level 4 never got hit points, so the GM added a +40 bonus to cover it
const wizard = { id: "cls1", name: "Wizard", type: "class", system: { levels: 5, hd: { denomination: "d6" }, isOriginalClass: true },
  _source: { system: { advancement: [{ _id: "adv1", type: "HitPoints", value: { 1: "max", 2: "avg", 3: 3, 5: "avg" } }] } },
  update: async (u) => { wizard._source.system.advancement = u["system.advancement"]; log.push("wizard hp " + JSON.stringify(u["system.advancement"][0].value)); } };
const jane = { id: "pc1", name: "Jane Roe", type: "character", img: "icons/jane.png", folder: null,
  _source: { system: { attributes: { hp: { max: null, bonuses: { overall: "40", level: "" } } } } },
  system: { details: { level: 5, race: "Elf" }, abilities: { str: { value: 8, mod: -1 }, int: { value: 18, mod: 4 }, con: { value: 14, mod: 2 } },
    attributes: { hp: { value: 30, max: 75 }, ac: { value: 13 }, movement: { walk: 30 }, spell: { dc: 15 } }, skills: { prc: { passive: 14 } } },
  classes: { wizard }, items: coll([{ type: "background", name: "Sage" }, wizard]),
  update: async (u) => {
    const hp = jane._source.system.attributes.hp;
    if ("system.attributes.hp.bonuses.overall" in u) hp.bonuses.overall = u["system.attributes.hp.bonuses.overall"];
    if ("system.attributes.hp.max" in u) hp.max = u["system.attributes.hp.max"];
    log.push("jane " + JSON.stringify(u));
  } };
actors.push(jane);
globalThis.foundry_utils = true;
const created = [];
const mkActor = (d, id) => {
  const its = coll((d.items || []).map((it, n) => ({ ...it, id: `${id}-i${n}`, getFlag: (_, k) => it.flags?.["lore-studio-bridge"]?.[k] })));
  const actor = { id, name: d.name, type: d.type, system: d.system, folder: d.folder, items: its,
    update: async (u) => { Object.assign(actor, { name: u.name ?? actor.name, system: u.system ?? actor.system }); log.push("update " + actor.name); },
    deleteEmbeddedDocuments: async (t, ids) => { for (const i of ids) its.splice(its.findIndex((x) => x.id === i), 1); log.push(`delete ${ids.length} items`); },
    createEmbeddedDocuments: async (t, docs) => { docs.forEach((it, n) => its.push({ ...it, id: `${id}-n${its.length + n}`, getFlag: (_, k) => it.flags?.["lore-studio-bridge"]?.[k] })); log.push(`create ${docs.length} items`); } };
  return actor;
};
globalThis.Actor = { create: async (d) => { const a = mkActor(d, "new" + created.length); created.push(a); actors.push(a); log.push(`create actor ${d.name} in ${d.folder}`); return a; } };
const ogreDoc = { toObject: () => ({ _id: "og1", name: "Ogre", type: "npc", system: { details: { cr: 2, type: { value: "giant" } }, abilities: { str: { value: 19 } },
  attributes: { ac: { flat: 11 }, hp: { max: 59, formula: "7d10+21" }, movement: { walk: 40 } }, traits: { size: "lg" } }, items: [] }) };
const packs = [{ documentName: "Actor", collection: "world.bestiary", title: "My Bestiary",
  getIndex: async () => ({ contents: [{ _id: "og1", name: "Ogre", type: "npc", system: { details: { cr: 2 } } }] }),
  getDocument: async (id) => (id === "og1" ? ogreDoc : null) }];
packs.get = (k) => packs.find((p) => p.collection === k);
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
const modules = new Map([["lore-studio-bridge", { version: process.env.FAKE_MODULE_VERSION || "0.8.0" }]]);
globalThis.game = { modules, user: { isGM: true, name: "GM" }, world: { title: "Test World" }, version: "14.369", system: { id: "dnd5e", version: "5.3.1" },
  settings: { register() {}, get: (_, k) => vals[k] }, folders: [], journal: journals, tables, actors, scenes, playlists, packs };
globalThis.canvas = { scene, dimensions: { width: 2000, height: 2000 }, stage: { pivot: { x: 1000, y: 1000 } } };
globalThis.Folder = { create: async (d) => { const f = { id: "f" + game.folders.length, ...d }; game.folders.push(f); return f; } };
globalThis.JournalEntry = { create: async (d) => { const e = { ...d, pages: Object.assign([...(d.pages || [])], { map: (f) => [] }),
  getFlag: (_, k) => d.flags["lore-studio-bridge"][k] }; journals.push(e); log.push("journal " + d.name + " pages=" + d.pages.map((p) => p.type).join("+")); return e; } };
globalThis.foundry = { utils: { deepClone: (x) => JSON.parse(JSON.stringify(x)) }, applications: { apps: { FilePicker: { implementation: {
  createDirectory: async () => {}, upload: async (src, dir, file) => { log.push(`upload ${dir}/${file.name} ${file.size}b`); return { path: `${dir}/${file.name}` }; } } } } },
  documents: { collections: { Journal: { show: async (e, o) => { log.push("show " + e.name + (o.force ? " force" : "")); } } } } };
await import(modulePath);
await call("init"); await call("ready");
// report what happened when asked
setInterval(() => { try { require; } catch {} }, 100000);
process.on("SIGTERM", () => { console.log(JSON.stringify({ log, tokens, sheetOpened, sound: sound.playing, active: scene.active,
  created: created.map((a) => ({ name: a.name, items: a.items.map((i) => i.name), cr: a.system?.details?.cr })) })); process.exit(0); });
