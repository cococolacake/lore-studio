// Live mode helpers: NPC cards for the people in the current scene, and Lore Studio's own random tables.
import { api } from "./api.js";
import { h, btn, card, clear, modal, toast, toastError } from "./dom.js";
import { icon } from "./icons.js";

const FIELDS = [["look", "Look", "Tall, grey braid, ink-stained fingers"], ["voice", "Voice", "Slow, never finishes a sentence"],
  ["wants", "Wants", "To get the bridge rebuilt before winter"], ["secret", "Secret", "Only the GM sees this"]];
const isNpc = (c) => c.tags.some((t) => ["npc", "character", "villain", "monster"].includes(String(t).toLowerCase())) && !c.tags.map((t) => String(t).toLowerCase()).includes("pc");

/**
 * NPC cards: the NPCs the current scene mentions, plus any you pin. Each shows look, voice, wants and secret
 * (saved on the NPC's page), or the page's opening lines until you fill them in.
 */
export function npcCards(ctx, { sid, live, names, open, save }) {
  const box = h("div");
  let sceneIds = [], cards = new Map();
  const pinned = () => live().pinned || [];

  async function setScene(text) {
    const low = (text || "").toLowerCase();
    const ids = [];
    for (const [name, pid] of names) {
      if (name.length < 3 || ids.includes(pid)) continue;
      const rx = new RegExp(`(^|[^\\p{L}\\p{N}])${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u");
      if (rx.test(low)) ids.push(pid);
    }
    sceneIds = ids;
    await load();
  }

  async function load() {
    const want = [...new Set([...pinned(), ...sceneIds])].filter((id) => !cards.has(id));
    if (want.length) for (const c of await api.npc_cards(want).catch(() => [])) cards.set(c.id, c);
    draw();
  }

  async function setPinned(list) {
    try { await save({ pinned: list }); } catch (e) { toastError(e); }
    load();
  }

  async function edit(c) {
    const inputs = Object.fromEntries(FIELDS.map(([k, , ph]) => [k, h("input.input", { value: c[k] || "", placeholder: ph })]));
    const ok = await modal(`${c.title}: card`, h("div.stack",
      FIELDS.map(([k, label]) => h("div.field", h("label", label), inputs[k])),
      h("p.tiny.faint", { style: { margin: 0 } }, "Saved on the NPC's page. The secret stays GM-only: it's never in player recaps or the lore book.")),
    [{ label: "Cancel", kind: "ghost", value: false }, { label: "Save", kind: "primary", icon: "check", value: true }]);
    if (!ok) return;
    try {
      cards.set(c.id, await api.save_npc_card(c.id, Object.fromEntries(FIELDS.map(([k]) => [k, inputs[k].value]))));
      draw();
    } catch (e) { toastError(e); }
  }

  const pinIn = h("input.input.sm", { placeholder: "Pin someone…", oninput: () => { clearTimeout(pinIn._t); pinIn._t = setTimeout(findPin, 200); } });
  const pinHits = h("div.live-look");
  async function findPin() {
    const q = pinIn.value.trim();
    if (!q) return clear(pinHits);
    const hits = (await api.search(q).catch(() => [])).filter((x) => x.kind === "page").slice(0, 5);
    clear(pinHits, hits.map((x) => h("button.linkrow", { onclick: () => { pinIn.value = ""; clear(pinHits); if (!pinned().includes(x.id)) setPinned([...pinned(), x.id]); } }, icon("plus"), h("span", x.title))));
  }

  function draw() {
    const pins = pinned();
    const list = [...pins, ...sceneIds.filter((id) => !pins.includes(id))].map((id) => cards.get(id))
      .filter((c) => c && (pins.includes(c.id) || isNpc(c)));
    clear(box, card({ title: "People here", actions: h("span.small.faint", list.length ? "In this scene, and pinned" : "") }, h("div.stack.sm",
      list.length ? list.map((c) => npcCard(c, pins.includes(c.id))) : h("p.small.faint", { style: { margin: 0 } }, "NPCs this scene mentions show here as cards. Pin anyone else below."),
      pinIn, pinHits)));
  }

  function npcCard(c, isPinned) {
    const filled = FIELDS.filter(([k]) => c[k]);
    return h("div.npc-card",
      h("div.row.nowrap",
        h("button.linkish.npc-name.grow", { onclick: () => open(c.id), title: "Open the page" }, c.title),
        btn("", { icon: "edit", size: "sm", kind: "ghost", title: "Edit the card", onclick: () => edit(c) }),
        btn("", { icon: "star", size: "sm", kind: isPinned ? "primary" : "ghost", title: isPinned ? "Unpin" : "Pin for this session",
          onclick: () => setPinned(isPinned ? pinned().filter((x) => x !== c.id) : [...pinned(), c.id]) })),
      filled.length
        ? h("dl.npc-fields", filled.map(([k, label]) => [h("dt", label), h("dd", { class: k === "secret" ? "secret" : "" }, c[k])]))
        : h("p.small.faint.npc-summary", c.summary || "No details yet.", " ", h("button.linkish.small", { onclick: () => edit(c) }, "Add look, voice…")));
  }

  draw();
  return { el: box, setScene, refresh: load };
}

// ---- random tables ---------------------------------------------------------------------------

/** "2d6+1 gold" -> "9 gold". Each dice roll is replaced by its total. */
export function rollDice(text) {
  return text.replace(/\b(\d{0,2})d(\d{1,3})(?:\s*([+-])\s*(\d+))?\b/gi, (m, n, sides, sign, add) => {
    const count = Math.min(50, Number(n || 1)), s = Number(sides);
    if (!s) return m;
    let total = 0;
    for (let i = 0; i < count; i++) total += 1 + Math.floor(Math.random() * s);
    if (sign) total += (sign === "-" ? -1 : 1) * Number(add);
    return String(total);
  });
}

/** One result from a table, with dice rolled and any [[Other table]] it names rolled too (one level deep). */
export function rollTable(table, all, depth = 0) {
  const pick = table.entries[Math.floor(Math.random() * table.entries.length)];
  const text = pick.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, target, label) => {
    const inner = depth < 2 && all.find((t) => t.title.toLowerCase() === target.trim().toLowerCase() || t.id === target.trim());
    return inner ? rollTable(inner, all, depth + 1) : label || target;
  });
  return rollDice(text).replace(/\*\*|__/g, "");
}

export function tablesCard(ctx, { live, save, note }) {
  const box = h("div");
  let tables = [];
  const filterIn = h("input.input.sm", { placeholder: "Find a table…", oninput: () => draw() });

  async function roll(t) {
    const result = rollTable(t, tables);
    const rolls = [{ table: t.title, result, at: Date.now() }, ...(live().rolls || [])].slice(0, 20);
    try { await save({ rolls }); } catch (e) { toastError(e); }
    draw();
  }

  function draw() {
    const q = filterIn.value.trim().toLowerCase();
    const shown = tables.filter((t) => !q || t.title.toLowerCase().includes(q));
    const rolls = live().rolls || [];
    clear(box, card({ title: "Random tables" }, tables.length ? h("div.stack.sm",
      tables.length > 6 ? filterIn : null,
      h("div.table-list", shown.slice(0, 12).map((t) => h("div.row.nowrap.table-row",
        h("button.linkish.grow", { style: { textAlign: "left" }, title: `${t.entries.length} results. Open the page`, onclick: () => ctx.go("lore", { id: t.id }) }, t.title),
        btn("Roll", { icon: "dice", size: "sm", onclick: () => roll(t) })))),
      rolls.length ? h("div.roll-log", rolls.slice(0, 5).map((r, i) => h("div.roll", { class: i === 0 ? "latest" : "" },
        h("div.tiny.faint", r.table),
        h("div.row.nowrap", h("span.grow", r.result),
          btn("", { icon: "feather", size: "sm", kind: "ghost", title: "Add to the scratchpad", onclick: async () => { await note(`${r.table}: ${r.result}`); toast("Noted", r.result, "good", "check", 2500); } }))))) : null)
      : h("p.small.faint", { style: { margin: 0 } }, "Tag a lore page ", h("b", "#table"), " and write one result per list item. Dice like 2d6 are rolled, and [[Another table]] rolls that table too.")));
  }

  /** A plan's {table:Name} link: roll Lore Studio's own table with that name, if there is one. */
  function rollByName(name) {
    const n = (name || "").trim().toLowerCase();
    const t = tables.find((x) => x.title.toLowerCase() === n) || tables.find((x) => x.title.toLowerCase().startsWith(n + " "));
    if (!t) return false;
    roll(t);
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return true;
  }

  api.random_tables().then((t) => { tables = t; draw(); }).catch(() => draw());
  draw();
  return { el: box, rollByName };
}
