// Lore Studio Bridge for Foundry VTT v13-v14. Plain browser APIs only (no jQuery).
// Sends chat, rolls, combat turns and scene changes to Lore Studio, and creates or updates journal
// entries that Lore Studio queues (lore pages, player recaps, handouts). From live mode it can roll tables, look up
// actors and place their tokens, switch scenes and play sounds. Runs only in one GM browser that opts in.
const ID = "lore-studio-bridge";
const queue = [];
let failures = 0;

function setting(key) { return game.settings.get(ID, key); }
function active() { return game.user?.isGM && setting("enabled") && setting("token"); }
function base() { return String(setting("url") || "http://127.0.0.1:42012").replace(/\/+$/, ""); }

async function call(path, body) {
  const res = await fetch(base() + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "X-Lore-Token": setting("token") },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Lore Studio answered ${res.status}`);
  return res.json();
}

function plain(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
}

function push(ev) {
  if (!active()) return;
  queue.push({ time: new Date().toISOString(), ...ev });
  if (queue.length > 2000) queue.splice(0, queue.length - 2000);
}

async function flush() {
  if (!active() || !queue.length) return;
  const batch = queue.splice(0, 200);
  try {
    await call("/foundry/events", { events: batch });
    failures = 0;
  } catch (e) {
    queue.unshift(...batch);
    if (++failures === 3) ui.notifications?.warn("Lore Studio Bridge: can't reach Lore Studio. Is it open? Check the address and token in Module Settings.");
  }
}

async function folderFor(name) {
  let f = game.folders.find((x) => x.type === "JournalEntry" && x.name === name);
  if (!f) f = await Folder.create({ name, type: "JournalEntry", color: "#9381FF" });
  return f;
}

async function applyJournal(a) {
  const OBSERVER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  const NONE = CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
  let entry = game.journal.find((j) => j.getFlag(ID, "key") === a.key);
  const page = { name: a.name, type: "text", text: { content: a.html, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML } };
  if (!entry) {
    const folder = await folderFor(a.folder || "Lore Studio");
    entry = await JournalEntry.create({ name: a.name, folder: folder.id, pages: [page], ownership: { default: a.share ? OBSERVER : NONE },
      flags: { [ID]: { key: a.key } } });
  } else {
    await entry.update({ name: a.name, ownership: { default: a.share ? OBSERVER : NONE } });
    const first = entry.pages.contents[0];
    if (first) await first.update({ name: a.name, "text.content": a.html });
    else await entry.createEmbeddedDocuments("JournalEntryPage", [page]);
  }
  ui.notifications?.info(`Lore Studio: “${a.name}” is in your journal.`);
}

// ---- handouts ---------------------------------------------------------------------------
const FP = () => foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
const JournalCls = () => foundry?.documents?.collections?.Journal ?? globalThis.Journal;

async function uploadImage(dataUrl, name) {
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], name || "handout.png", { type: blob.type });
  const dir = "lore-studio-handouts";
  try { await FP().createDirectory("data", dir); } catch { /* already there */ }
  const res = await FP().upload("data", dir, file, {}, { notify: false });
  return res?.path || `${dir}/${file.name}`;
}

async function applyHandout(a) {
  const OBSERVER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  const pages = [];
  let src = "";
  if (a.image) {
    src = await uploadImage(a.image, a.image_name);
    pages.push({ name: a.name, type: "image", src, title: { show: false } });
  }
  if (a.html) pages.push({ name: a.image ? "Text" : a.name, type: "text", text: { content: a.html, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML } });
  let entry = game.journal.find((j) => j.getFlag(ID, "key") === a.key);
  if (entry) {
    await entry.deleteEmbeddedDocuments("JournalEntryPage", entry.pages.map((p) => p.id));
    await entry.update({ name: a.name, ownership: { default: OBSERVER } });
    await entry.createEmbeddedDocuments("JournalEntryPage", pages);
  } else {
    const folder = await folderFor(a.folder || "Lore Studio · Handouts");
    entry = await JournalEntry.create({ name: a.name, folder: folder.id, pages, ownership: { default: OBSERVER }, flags: { [ID]: { key: a.key } } });
  }
  if (a.popup) {
    const J = JournalCls();
    if (J?.show) await J.show(entry, { force: true });
    else if (src) {
      const IP = foundry?.applications?.apps?.ImagePopout ?? globalThis.ImagePopout;
      new IP({ src, window: { title: a.name } }).shareImage();
    }
  }
  ui.notifications?.info(`Lore Studio: showed “${a.name}” to the players.`);
}

// ---- live-mode extras: tables, actors, scenes, sounds --------------------------------------
const num = (v) => (v === undefined || v === null || v === "" ? null : v);

function actorSummary(actor) {
  const s = actor.system || {};
  const abil = {};
  for (const [k, v] of Object.entries(s.abilities || {})) abil[k] = { value: v.value, mod: v.mod, save: v.save?.value ?? v.save };
  const items = actor.items.contents.slice(0, 60).map((i) => ({ name: i.name, type: i.type,
    desc: plain(i.system?.description?.value || "").slice(0, 400), activation: i.system?.activities?.contents?.[0]?.activation?.type || i.system?.activation?.type || "" }));
  return {
    id: actor.id, name: actor.name, type: actor.type, img: actor.img,
    ac: num(s.attributes?.ac?.value), hp: num(s.attributes?.hp?.value), hp_max: num(s.attributes?.hp?.max),
    cr: num(s.details?.cr), xp: num(s.details?.xp?.value), alignment: s.details?.alignment || "",
    creature: [s.details?.type?.value, s.details?.type?.subtype].filter(Boolean).join(" "), size: s.traits?.size || "",
    speed: Object.entries(s.attributes?.movement || {}).filter(([k, v]) => typeof v === "number" && v > 0).map(([k, v]) => `${k} ${v}`).join(", "),
    senses: Object.entries(s.attributes?.senses || {}).filter(([k, v]) => typeof v === "number" && v > 0).map(([k, v]) => `${k} ${v}`).join(", "),
    abilities: abil, items, bio: plain(s.details?.biography?.value || "").slice(0, 800),
  };
}

function inventory() {
  const folderName = (d) => d.folder?.name || "";
  return {
    tables: game.tables.contents.map((t) => ({ id: t.id, name: t.name, folder: folderName(t), formula: t.formula })),
    actors: game.actors.contents.map((a) => ({ id: a.id, name: a.name, type: a.type, folder: folderName(a), img: a.img,
      cr: a.system?.details?.cr ?? null })),
    scenes: game.scenes.contents.map((sc) => ({ id: sc.id, name: sc.navName || sc.name, active: sc.active, viewed: canvas?.scene?.id === sc.id,
      folder: folderName(sc), thumb: sc.thumb || "" })),
    playlists: game.playlists.contents.map((pl) => ({ id: pl.id, name: pl.name, playing: pl.playing,
      sounds: pl.sounds.contents.map((so) => ({ id: so.id, name: so.name, playing: so.playing })) })),
  };
}

let invTimer = null;
function sendInventory() {
  clearTimeout(invTimer);
  invTimer = setTimeout(() => { if (active()) call("/foundry/inventory", inventory()).catch(() => {}); }, 400);
}

// where a character's maximum hit points come from (dnd5e): each class level's roll, Constitution, bonuses, override
function hpDetail(actor) {
  const src = actor._source?.system?.attributes?.hp || {};
  const classes = Object.values(actor.classes || {}).map((c) => {
    const adv = c._source?.system?.advancement ?? c.system?.advancement ?? [];
    const hpAdv = (Array.isArray(adv) ? adv : Object.values(adv)).find((x) => x.type === "HitPoints");
    const denom = c.system?.hd?.denomination || c.system?.hitDice || "d8";
    return { id: c.id, name: c.name, levels: c.system?.levels ?? 0, die: Number(String(denom).replace(/\D/g, "")) || 8,
      first: !!c.system?.isOriginalClass, rolls: hpAdv?.value || {} };
  });
  return { value: num(actor.system?.attributes?.hp?.value), max: num(actor.system?.attributes?.hp?.max), override: src.max ?? null,
    bonus_overall: src.bonuses?.overall ?? "", bonus_level: src.bonuses?.level ?? "", con: num(actor.system?.abilities?.con?.mod),
    level: num(actor.system?.details?.level), classes };
}

const handlers = {
  async roll_table(a) {
    const t = game.tables.get(a.id) || game.tables.getName(a.name);
    if (!t) throw new Error("That roll table isn't in this world.");
    const draw = await t.draw({ displayChat: a.chat !== false, rollMode: a.private ? "gmroll" : undefined });
    return { table: t.name, total: draw.roll?.total, results: draw.results.map((r) => plain(r.description || r.text || r.name || (r.getChatText?.() ?? ""))) };
  },
  async actor(a) {
    const actor = game.actors.get(a.id) || game.actors.getName(a.name);
    if (!actor) throw new Error("That actor isn't in this world.");
    return actorSummary(actor);
  },
  async open_sheet(a) {
    const actor = game.actors.get(a.id);
    if (!actor) throw new Error("That actor isn't in this world.");
    actor.sheet.render(true);
    return true;
  },
  async place_actor(a) {
    const actor = game.actors.get(a.id);
    if (!actor) throw new Error("That actor isn't in this world.");
    if (!canvas?.scene) throw new Error("No scene is open in Foundry.");
    const grid = canvas.scene.grid?.size || 100;
    const cx = canvas.stage?.pivot?.x ?? canvas.dimensions.width / 2, cy = canvas.stage?.pivot?.y ?? canvas.dimensions.height / 2;
    const docs = [];
    const n = Math.max(1, Math.min(20, Number(a.count) || 1));
    for (let i = 0; i < n; i++) {
      const col = i % 5, row = Math.floor(i / 5);
      const td = await actor.getTokenDocument({ x: cx + (col - 2) * grid, y: cy + row * grid, hidden: !!a.hidden });
      docs.push(td.toObject());
    }
    await canvas.scene.createEmbeddedDocuments("Token", docs);
    return { placed: n, scene: canvas.scene.name };
  },
  async scene(a) {
    const sc = game.scenes.get(a.id);
    if (!sc) throw new Error("That scene isn't in this world.");
    if (a.mode === "activate") await sc.activate(); else await sc.view();
    return { name: sc.name };
  },
  async playlist(a) {
    const pl = game.playlists.get(a.id);
    if (!pl) throw new Error("That playlist isn't in this world.");
    if (a.sound) {
      const so = pl.sounds.get(a.sound);
      if (!so) throw new Error("That sound isn't in the playlist.");
      if (a.action === "stop") await pl.stopSound(so); else await pl.playSound(so);
    } else if (a.action === "stop") await pl.stopAll();
    else await pl.playAll();
    return true;
  },
  async stop_all_sounds() {
    for (const pl of game.playlists.playing) await pl.stopAll();
    return true;
  },
  async inventory() { return inventory(); },

  // ---- party page: a player character's sheet, read live
  async character(a) {
    const actor = game.actors.get(a.id) || game.actors.getName(a.name);
    if (!actor) throw new Error("That character isn't in this world.");
    const s = actor.system || {};
    const classes = Object.values(actor.classes || {}).map((c) => `${c.name} ${c.system?.levels ?? ""}`.trim());
    const ab = {};
    for (const [k, v] of Object.entries(s.abilities || {})) ab[k] = { value: num(v.value), mod: num(v.mod) };
    const num2 = (v) => (typeof v === "number" ? v : null);
    return {
      id: actor.id, name: actor.name, type: actor.type, img: actor.img,
      level: num2(s.details?.level), classes: classes.join(" / "),
      race: actor.system?.details?.race?.name || s.details?.race || actor.items?.find?.((i) => i.type === "race")?.name || "",
      background: actor.items?.find?.((i) => i.type === "background")?.name || s.details?.background || "",
      hp: num(s.attributes?.hp?.value), hp_max: num(s.attributes?.hp?.max), ac: num(s.attributes?.ac?.value),
      speed: num2(s.attributes?.movement?.walk), passive: num2(s.skills?.prc?.passive), spell_dc: num2(s.attributes?.spell?.dc ?? s.attributes?.spelldc),
      abilities: ab, hp_detail: hpDetail(actor),
    };
  },
  // fix broken level-ups: correct each level's hit points, the bonuses, or set an exact maximum
  async character_fix(a) {
    const actor = game.actors.get(a.id);
    if (!actor) throw new Error("That character isn't in this world.");
    const upd = {};
    if ("override" in a) upd["system.attributes.hp.max"] = a.override === null || a.override === "" ? null : Number(a.override);
    if ("bonus_overall" in a) upd["system.attributes.hp.bonuses.overall"] = String(a.bonus_overall ?? "");
    if ("bonus_level" in a) upd["system.attributes.hp.bonuses.level"] = String(a.bonus_level ?? "");
    if ("value" in a && a.value !== null && a.value !== "") upd["system.attributes.hp.value"] = Number(a.value);
    if (Object.keys(upd).length) await actor.update(upd);
    for (const [itemId, levels] of Object.entries(a.class_hp || {})) {
      const item = actor.items.get(itemId);
      if (!item) continue;
      const adv = foundry.utils.deepClone(item._source?.system?.advancement ?? item.system.advancement ?? []);
      const list = Array.isArray(adv) ? adv : Object.values(adv);
      const hpAdv = list.find((x) => x.type === "HitPoints");
      if (!hpAdv) continue;
      hpAdv.value = { ...(hpAdv.value || {}), ...levels };
      await item.update({ "system.advancement": adv });
    }
    return handlers.character({ id: actor.id });
  },

  // ---- monster maker: read and write creatures
  async actor_data(a) {
    const actor = game.actors.get(a.id) || game.actors.getName(a.name);
    if (!actor) throw new Error("That actor isn't in this world.");
    return actor.toObject();
  },
  async actor_packs() {
    const out = [];
    for (const pack of game.packs.filter((p) => p.documentName === "Actor")) {
      const index = await pack.getIndex({ fields: ["system.details.cr", "type"] });
      out.push({ pack: pack.collection, title: pack.title, entries: index.contents
        .filter((e) => !e.type || e.type === "npc")
        .map((e) => ({ id: e._id, name: e.name, cr: e.system?.details?.cr ?? null })) });
    }
    return out;
  },
  async pack_actor(a) {
    const pack = game.packs.get(a.pack);
    if (!pack) throw new Error("That compendium isn't in this world.");
    const doc = await pack.getDocument(a.id);
    if (!doc) throw new Error("That creature isn't in the compendium.");
    return doc.toObject();
  },
  async actor_save(a) {
    const { items = [], ...data } = a.data || {};
    let actor = a.id ? game.actors.get(a.id) : null;
    if (!actor) {
      let folder = game.folders.find((f) => f.type === "Actor" && f.name === "Lore Studio");
      if (!folder) folder = await Folder.create({ name: "Lore Studio", type: "Actor", color: "#9381FF" });
      actor = await Actor.create({ ...data, items, folder: folder?.id });
      return { id: actor.id, name: actor.name, created: true };
    }
    await actor.update(data);
    // replace only the features Lore Studio made; anything added in Foundry stays
    const old = actor.items.filter((i) => i.getFlag?.(ID, "fromStudio")).map((i) => i.id);
    if (old.length) await actor.deleteEmbeddedDocuments("Item", old);
    if (items.length) await actor.createEmbeddedDocuments("Item", items);
    return { id: actor.id, name: actor.name, created: false };
  },
};

async function handle(a) {
  if (a.type === "journal") return applyJournal(a);
  if (a.type === "handout") return applyHandout(a);
  const fn = handlers[a.type];
  if (!fn) {
    if (a.rid) await call("/foundry/result", { rid: a.rid, ok: false, error: "This version of the Lore Studio Bridge module can't do that. Update it, then reload Foundry." }).catch(() => {});
    return;
  }
  try {
    const data = await fn(a);
    if (a.rid) await call("/foundry/result", { rid: a.rid, ok: true, data });
  } catch (e) {
    console.error("Lore Studio Bridge:", e);
    if (a.rid) await call("/foundry/result", { rid: a.rid, ok: false, error: String(e.message || e) }).catch(() => {});
  }
}

// Long polling: Lore Studio holds the request open until it has something for Foundry, so actions arrive at once.
async function pollLoop() {
  while (active()) {
    try {
      const r = await call("/foundry/outbox?wait=15");
      for (const a of r.actions || []) {
        try { await handle(a); } catch (e) { console.error("Lore Studio Bridge:", e); }
      }
    } catch {
      await new Promise((res) => setTimeout(res, 5000));    // flush() reports connection problems
    }
  }
}

Hooks.once("init", () => {
  game.settings.register(ID, "enabled", { name: "LORESTUDIO.enabled", hint: "LORESTUDIO.enabledHint", scope: "client", config: true, requiresReload: true, type: Boolean, default: false });
  game.settings.register(ID, "url", { name: "LORESTUDIO.url", hint: "LORESTUDIO.urlHint", scope: "client", config: true, requiresReload: true, type: String, default: "http://127.0.0.1:42012" });
  game.settings.register(ID, "token", { name: "LORESTUDIO.token", hint: "LORESTUDIO.tokenHint", scope: "client", config: true, requiresReload: true, type: String, default: "" });
});

Hooks.once("ready", async () => {
  if (!active()) return;
  try {
    await call("/foundry/hello", { world: game.world?.title, user: game.user?.name, foundry: game.version, system: `${game.system?.id} ${game.system?.version}`,
      module: game.modules?.get?.(ID)?.version || "", origin: window.location.origin });
    ui.notifications?.info("Lore Studio Bridge connected.");
  } catch {
    ui.notifications?.warn("Lore Studio Bridge: Lore Studio isn't reachable. Open it, then reload Foundry.");
  }
  setInterval(flush, 3000);
  pollLoop();
  sendInventory();
  if (canvas?.scene) push({ type: "scene", scene: canvas.scene.name });
});

Hooks.on("createChatMessage", (message) => {
  const speaker = message.alias || message.speaker?.alias || message.author?.name || "";
  const author = message.author?.name || "";
  const whisper = (message.whisper || []).length > 0;
  if (message.isRoll && message.rolls?.length) {
    push({ type: "roll", speaker, author, whisper, flavor: plain(message.flavor).slice(0, 200),
      rolls: message.rolls.map((r) => ({ formula: r.formula, total: r.total })) });
  } else {
    const text = plain(message.content);
    if (text) push({ type: "chat", speaker, author, whisper, text: text.slice(0, 600) });
  }
});

Hooks.on("combatStart", (combat) => push({ type: "combat", round: combat.round, turn: combat.turn, combatant: combat.combatant?.name || "Combat starts" }));
// combatRound / combatTurn fire before the update is applied, so read the new values from the update data.
function turnEvent(combat, update) {
  const round = update?.round ?? combat.round;
  const turn = update?.turn ?? combat.turn;
  push({ type: "combat", round, turn, combatant: combat.turns?.[turn]?.name || "" });
}
Hooks.on("combatRound", turnEvent);
Hooks.on("combatTurn", turnEvent);
Hooks.on("canvasReady", (c) => { if (c?.scene) push({ type: "scene", scene: c.scene.name }); });

// keep Lore Studio's list of tables, actors, scenes and playlists current
for (const doc of ["RollTable", "Actor", "Scene", "Playlist", "PlaylistSound"]) {
  for (const verb of ["create", "update", "delete"]) Hooks.on(`${verb}${doc}`, () => sendInventory());
}
Hooks.on("canvasReady", () => sendInventory());
