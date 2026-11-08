// Lore Studio Bridge for Foundry VTT v13-v14. Plain browser APIs only (no jQuery).
// Sends chat, rolls, combat turns and scene changes to Lore Studio, and creates or updates journal
// entries that Lore Studio queues (lore pages, player recaps). Runs only in one GM browser that opts in.
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

async function poll() {
  if (!active()) return;
  try {
    const r = await call("/foundry/outbox");
    for (const a of r.actions || []) {
      try {
        if (a.type === "journal") await applyJournal(a);
      } catch (e) { console.error("Lore Studio Bridge:", e); }
    }
  } catch { /* flush() reports connection problems */ }
}

Hooks.once("init", () => {
  game.settings.register(ID, "enabled", { name: "LORESTUDIO.enabled", hint: "LORESTUDIO.enabledHint", scope: "client", config: true, requiresReload: true, type: Boolean, default: false });
  game.settings.register(ID, "url", { name: "LORESTUDIO.url", hint: "LORESTUDIO.urlHint", scope: "client", config: true, requiresReload: true, type: String, default: "http://127.0.0.1:42012" });
  game.settings.register(ID, "token", { name: "LORESTUDIO.token", hint: "LORESTUDIO.tokenHint", scope: "client", config: true, requiresReload: true, type: String, default: "" });
});

Hooks.once("ready", async () => {
  if (!active()) return;
  try {
    await call("/foundry/hello", { world: game.world?.title, user: game.user?.name, foundry: game.version, system: `${game.system?.id} ${game.system?.version}` });
    ui.notifications?.info("Lore Studio Bridge connected.");
  } catch {
    ui.notifications?.warn("Lore Studio Bridge: Lore Studio isn't reachable. Open it, then reload Foundry.");
  }
  setInterval(flush, 3000);
  setInterval(poll, 5000);
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
