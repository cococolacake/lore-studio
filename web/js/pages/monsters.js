// Monster maker: build creatures, check their challenge rating, scale them to a CR or to your party,
// and send them to Foundry or into a session plan.
import { api } from "../api.js";
import { h, btn, card, clear, empty, toast, toastError, modal, confirmBox } from "../dom.js";
import { icon } from "../icons.js";
import { seg } from "../components.js";

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const SIZES = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"];
const SPEEDS = ["walk", "burrow", "climb", "fly", "swim"];
const SECTIONS = [["traits", "Traits"], ["actions", "Actions"], ["bonus_actions", "Bonus actions"], ["reactions", "Reactions"], ["legendary", "Legendary actions"]];
const CRS = [0, 0.125, 0.25, 0.5, ...Array.from({ length: 30 }, (_, i) => i + 1)];
export const crLabel = (c) => ({ 0.125: "1/8", 0.25: "1/4", 0.5: "1/2" })[c] || String(c ?? "?");
const signed = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

/** A small window of our own that content inside it can close (modal() only closes from its footer buttons). */
function sheet(title, body, { wide = false } = {}) {
  let done;
  const p = new Promise((r) => { done = r; });
  const close = (v) => { scrim.remove(); document.removeEventListener("keydown", onKey, true); done(v); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(null); } };
  const scrim = h("div.scrim", { onmousedown: (e) => e.target === scrim && close(null) },
    h("div.modal", { class: wide ? "wide" : "" },
      h("div.m-head", h("h3", title), h("div.spacer"), btn("", { icon: "x", kind: "ghost", size: "sm", onclick: () => close(null) })),
      h("div.m-body", typeof body === "function" ? body(close) : body)));
  document.addEventListener("keydown", onKey, true);
  document.body.append(scrim);
  return p;
}

// ---- the stat block preview --------------------------------------------------------------------
export function statBlock(m, d) {
  const line = (label, text) => (text ? h("div.sb-line", h("b", label + " "), text) : null);
  const speed = [m.speed?.walk ? `${m.speed.walk} ft.` : null,
    ...SPEEDS.slice(1).filter((k) => m.speed?.[k]).map((k) => `${k} ${m.speed[k]} ft.${k === "fly" && m.hover ? " (hover)" : ""}`)].filter(Boolean).join(", ") || "0 ft.";
  return h("div.statblock",
    h("div.sb-name", m.name || "Unnamed"),
    h("div.sb-kind", `${m.size} ${m.type}${m.subtype ? ` (${m.subtype})` : ""}${m.alignment ? `, ${m.alignment}` : ""}`),
    h("div.sb-rule"),
    line("Armor Class", `${m.ac}${m.ac_note ? ` (${m.ac_note})` : ""}`),
    line("Hit Points", `${m.hp}${m.hit_dice ? ` (${m.hit_dice})` : ""}`),
    line("Speed", speed),
    h("div.sb-rule"),
    h("div.sb-abilities", ABILITIES.map((a) => h("div", h("b", a.toUpperCase()), h("span", `${m.abilities[a]} (${signed(d.mods[a])})`)))),
    h("div.sb-rule"),
    line("Saving Throws", Object.entries(m.saves || {}).map(([a, v]) => `${a[0].toUpperCase()}${a.slice(1)} ${signed(v)}`).join(", ")),
    line("Skills", Object.entries(m.skills || {}).map(([k, v]) => `${k.replace(/\b\w/g, (c) => c.toUpperCase())} ${signed(v)}`).join(", ")),
    line("Damage Vulnerabilities", m.vulnerabilities), line("Damage Resistances", m.resistances),
    line("Damage Immunities", m.immunities), line("Condition Immunities", m.condition_immunities),
    line("Senses", [m.senses, `passive Perception ${d.passive}`].filter(Boolean).join(", ")),
    line("Languages", m.languages || "—"),
    h("div.sb-line", h("b", "Challenge "), `${d.cr_label} (${d.xp.toLocaleString()} XP)`, h("span.faint", ` · Proficiency ${signed(d.prof)}`)),
    ...SECTIONS.flatMap(([k, label]) => !m[k]?.length ? [] : [
      k === "traits" ? h("div.sb-rule") : h("div.sb-section", label),
      k === "legendary" ? h("p.sb-p", `The ${m.name.toLowerCase()} can take ${m.legendary_count || 3} legendary actions, choosing from the options below. Only one can be used at a time, at the end of another creature's turn.`) : null,
      ...m[k].map((a) => h("p.sb-p", a.name ? h("b.i", `${a.name}. `) : null, a.desc)),
    ]));
}

// ---- new monster ----------------------------------------------------------------------------
async function newMonster(ctx) {
  const how = await modal("New monster", h("div.stack.sm",
    h("p.small.muted", { style: { margin: 0 } }, "Start from scratch, or from a creature you already have and make it your own.")),
  [{ label: "Cancel", kind: "ghost", value: null }, { label: "5etools", icon: "upload", value: "5e" }, { label: "Foundry", icon: "hive", value: "foundry" },
    { label: "Free 5e rules", icon: "book", value: "srd" }, { label: "Blank", icon: "plus", kind: "primary", value: "blank" }]);
  try {
    if (how === "blank") return open(ctx, await api.monster_new("blank"));
    if (how === "srd") return pickSrd(ctx);
    if (how === "foundry") return pickFoundry(ctx);
    if (how === "5e") return import5e(ctx);
  } catch (e) { toastError(e); }
}
const open = (ctx, m) => ctx.go("monsters", { id: m.id });

function pickList(title, items, onPick, note) {
  return sheet(title, (close) => {
    const list = h("div.pick-list");
    const q = h("input.input", { placeholder: "Search by name, type or CR…", oninput: () => draw() });
    const draw = () => {
      const t = q.value.trim().toLowerCase();
      const hits = items.filter((x) => !t || `${x.name} ${x.sub || ""} cr ${crLabel(x.cr)}`.toLowerCase().includes(t)).slice(0, 250);
      clear(list, hits.length ? hits.map((x) => h("button.pick-row", { onclick: async () => { close(true); try { await onPick(x); } catch (e) { toastError(e); } } },
        h("span.grow", h("b", x.name), x.sub ? h("span.faint", ` · ${x.sub}`) : null), x.cr != null ? h("span.chip", `CR ${crLabel(x.cr)}`) : null))
        : h("p.small.muted", "Nothing matches."));
    };
    setTimeout(() => q.focus(), 30);
    draw();
    return h("div.stack.sm", q, list, note ? h("p.tiny.faint", { style: { margin: 0 } }, note) : null);
  }, { wide: true });
}

async function pickSrd(ctx) {
  const { monsters, credit } = await api.srd_monsters();
  return pickList("From the free 5e rules", monsters.map((m) => ({ ...m, sub: `${m.size} ${m.type}` })),
    async (x) => open(ctx, await api.monster_new("srd", x.index)), credit);
}

async function pickFoundry(ctx) {
  const inv = await api.foundry_inventory().catch(() => null);
  if (!inv?.connected) return toast("Foundry isn't connected", "Open your world as the GM with the Lore Studio Bridge module on.", "warn", "alert");
  const world = (inv.actors || []).filter((a) => a.type === "npc").map((a) => ({ name: a.name, cr: a.cr, sub: a.folder || "World", ref: a.id, src: "foundry" }));
  let packs = [];
  try { packs = await api.foundry_actor_packs(); } catch { /* compendiums are optional */ }
  const fromPacks = packs.flatMap((p) => p.entries.map((e) => ({ name: e.name, cr: e.cr, sub: p.title, ref: `${p.pack}|${e.id}`, src: "pack" })));
  return pickList("From Foundry", [...world, ...fromPacks], async (x) => open(ctx, await api.monster_new(x.src, x.ref)),
    "Creatures in your world and in your compendiums (including monster books you own in Foundry). You get a copy to edit; the original isn't changed.");
}

async function import5e(ctx) {
  let text = "";
  const area = h("textarea.input.mono", { rows: 8, placeholder: '{"monster": [ … ]}  or one creature\'s JSON', oninput: (e) => { text = e.target.value; } });
  const url = h("input.input", { placeholder: "https://raw.githubusercontent.com/…/homebrew.json" });
  const file = h("input", { type: "file", accept: ".json,application/json", style: { display: "none" }, onchange: async () => {
    const f = file.files[0]; if (!f) return;
    text = await f.text(); area.value = text.slice(0, 20000) + (text.length > 20000 ? "\n…" : "");
  } });
  const r = await modal("Import from 5etools", h("div.stack",
    h("p.small.muted", { style: { margin: 0 } }, "Lore Studio reads 5etools' creature format. Bring your own: a homebrew file, a link to one, or a creature's JSON you copied from 5etools. Every creature in it is added."),
    h("div.field", h("label", "Paste JSON"), area, h("div.row", btn("Choose a .json file", { icon: "folder", size: "sm", kind: "ghost", onclick: () => file.click() }), file)),
    h("div.field", h("label", "…or a link to a homebrew file"), url)),
  [{ label: "Cancel", kind: "ghost", value: false }, { label: "Import", kind: "primary", value: true }], { wide: true });
  if (!r) return;
  try {
    const ids = await api.monster_import(url.value.trim() ? null : text, url.value.trim() || null);
    toast(`Imported ${ids.length} creature${ids.length === 1 ? "" : "s"}`, "", "good", "check");
    ctx.go("monsters", { id: ids[0] });
  } catch (e) { toastError(e); }
}

// ---- scaling ----------------------------------------------------------------------------------
async function scaleDialog(ctx, m, onApply) {
  let mode = "party", target = m.cr, diff = "hard", count = 1, levels = null;
  const out = h("div.stack.sm");
  const levelsIn = h("input.input", { placeholder: "e.g. 5, 5, 5, 6", oninput: () => { levels = levelsIn.value.split(/[,\s]+/).map(Number).filter((n) => n >= 1 && n <= 20); recalc(); } });
  try { const p = await api.party(); const lv = p.party.map((x) => Number(x.sheet?.level || x.level)).filter((n) => n >= 1 && n <= 20); if (lv.length) { levels = lv; levelsIn.value = lv.join(", "); } } catch { /* no party yet */ }
  if (!levels?.length) mode = "cr";             // no party levels yet: start with picking a CR
  const crSel = h("select.select", { onchange: (e) => { target = Number(e.target.value); recalc(); } }, CRS.map((c) => h("option", { value: c, selected: c === m.cr }, `CR ${crLabel(c)}`)));
  const countIn = h("input.input", { type: "number", min: 1, max: 20, value: 1, style: { width: "80px" }, oninput: () => { count = Math.max(1, Number(countIn.value) || 1); recalc(); } });
  const partyBox = h("div.stack.sm",
    h("div.field", h("label", "Your party's levels"), levelsIn, h("div.help", "Read from the Party page. Change them here for this fight only.")),
    h("div.row", { style: { gap: "12px", alignItems: "flex-end" } },
      h("div.field", h("label", "How hard"), seg([["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"], ["deadly", "Deadly"]], diff, (v) => { diff = v; recalc(); })),
      h("div.field", h("label", `How many ${m.name}s`), countIn)),
    h("div.party-verdict"));
  const crBox = h("div.field", h("label", "New challenge rating"), crSel);
  const body = h("div.stack");
  const draw = () => clear(body, seg([["party", "For my party", "users"], ["cr", "To a challenge rating", "chart"]], mode, (v) => { mode = v; draw(); recalc(); }),
    mode === "party" ? partyBox : crBox, out);
  async function recalc() {
    try {
      if (mode === "party") {
        if (!levels?.length) { clear(partyBox.querySelector(".party-verdict"), h("p.small.muted", "Add your party's levels to work out the right challenge.")); return clear(out); }
        const t = await api.monster_party_target(diff, count, levels);
        target = t.cr;
        clear(partyBox.querySelector(".party-verdict"), h("div.callout",
          h("b", `CR ${crLabel(t.cr)}`), ` ${count > 1 ? "each" : ""} makes a ${t.difficulty} fight for a party of ${t.party.length} (levels ${t.party.join(", ")}). `,
          h("span.faint", `Encounter XP ${t.adjusted_xp.toLocaleString()} of a ${t.difficulty} budget of ${t.budget.toLocaleString()}${t.multiplier !== 1 ? ` (×${t.multiplier} for ${count} monsters)` : ""}.`)));
      }
      const r = await api.monster_scale(m, target);
      out._result = r;
      clear(out, h("div.small.muted", "What changes:"), h("ul.scale-changes", r.changes.map((c) => h("li", c))),
        h("div.tiny.faint", `Estimated CR after scaling: ${crLabel(r.monster.estimate.cr)}. Spells and special traits aren't counted in estimates, so check spellcasters by eye.`));
    } catch (e) { clear(out, h("p.small", { style: { color: "var(--bad)" } }, String(e.message || e))); }
  }
  draw(); recalc();
  const act = await modal(`Scale ${m.name}`, body, [{ label: "Cancel", kind: "ghost", value: null }, { label: "Save as a copy", icon: "dup", value: "copy" }, { label: "Change this one", kind: "primary", value: "this" }], { wide: true });
  if (!act) return;
  if (!out._result) return toast("Nothing to apply yet", mode === "party" ? "Add your party's levels first." : "Pick a challenge rating.", "warn", "alert");
  const nm = out._result.monster;
  if (act === "copy") { delete nm.id; delete nm.foundry_id; nm.name = `${m.name} (CR ${crLabel(nm.cr)})`; }
  try { const saved = await api.monster_save(nm); onApply(saved); toast(act === "copy" ? "Saved a scaled copy" : "Scaled", "", "good", "check", 2000); } catch (e) { toastError(e); }
}

// ---- the editor ------------------------------------------------------------------------------
function editor(ctx, root, m0) {
  let m = structuredClone(m0);
  ["id", "derived", "estimate", "stat_text"].forEach((k) => k !== "id" && delete m[k]);
  const status = h("span.small.faint", "Saved");
  const preview = h("div");
  const crPanel = h("div");
  let saveT, checkT;
  const changed = () => {
    status.textContent = "Saving…";
    clearTimeout(checkT); checkT = setTimeout(check, 250);
    clearTimeout(saveT); saveT = setTimeout(async () => {
      try { const r = await api.monster_save(m); m.updated = r.updated; status.textContent = "Saved"; drawSide(); } catch (e) { status.textContent = "Not saved"; toastError(e); }
    }, 700);
  };
  ctx.onLeave(() => { if (status.textContent !== "Saved") api.monster_save(m).catch(() => {}); });
  async function check() {
    try { const r = await api.monster_check(m); drawPreview(r); } catch { /* typing */ }
  }
  function drawPreview(r) {
    clear(preview, statBlock(m, r.derived));
    const e = r.estimate;
    const off = Math.abs(CRS.indexOf(e.cr) - CRS.indexOf(m.cr));
    clear(crPanel, h("div.stack.sm",
      h("div.row.nowrap", h("div.cr-big", h("span.tiny.faint", "Challenge"), h("b", crLabel(m.cr))),
        h("div.grow.small", h("div", "Estimated: ", h("b", `CR ${crLabel(e.cr)}`), off >= 2 ? h("span.chip.warn", { style: { marginLeft: "6px" } }, "check") : off ? null : h("span.chip.good", { style: { marginLeft: "6px" } }, "matches")),
          h("div.tiny.faint", `Defense ${crLabel(e.defensive)} · Offense ${crLabel(e.offensive)}`))),
      h("div.cr-facts", fact("Damage per round", e.dpr), fact("Attack bonus", e.attack != null ? signed(e.attack) : "—"),
        fact("Save DC", e.dc ?? "—"), fact("Effective HP", e.effective_hp)),
      h("div.row", { style: { gap: "6px" } },
        e.cr !== m.cr ? btn(`Use CR ${crLabel(e.cr)}`, { size: "sm", kind: "ghost", onclick: () => { m.cr = e.cr; crSel.value = e.cr; changed(); } }) : null),
      h("p.tiny.faint", { style: { margin: 0 } }, "Worked out the Dungeon Master's Guide way from hit points, AC, damage and attack bonus. Spells aren't counted.")));
  }
  const fact = (l, v) => h("div", h("span.tiny.faint", l), h("b", String(v)));

  // fields
  const inp = (key, attrs = {}) => h("input.input", { value: m[key] ?? "", ...attrs, oninput: (e) => { m[key] = attrs.type === "number" ? Number(e.target.value) : e.target.value; changed(); } });
  const field = (label, el, help) => h("div.field", h("label", label), el, help ? h("div.help", help) : null);
  const crSel = h("select.select", { onchange: (e) => { m.cr = Number(e.target.value); changed(); } }, CRS.map((c) => h("option", { value: c, selected: c === m.cr }, crLabel(c))));
  const basics = card("Basics", h("div.mf-grid",
    field("Name", inp("name", { oninput: (e) => { m.name = e.target.value; changed(); title.textContent = m.name || "Unnamed"; } })),
    field("Size", h("select.select", { onchange: (e) => { m.size = e.target.value; changed(); } }, SIZES.map((s) => h("option", { selected: s === m.size }, s)))),
    field("Type", inp("type", { placeholder: "beast, fiend, humanoid…" })),
    field("Subtype", inp("subtype", { placeholder: "optional" })),
    field("Alignment", inp("alignment")),
    field("Challenge", crSel)));
  const defense = card("Defense", h("div.mf-grid",
    field("Armor class", inp("ac", { type: "number", min: 0 })),
    field("Armor", inp("ac_note", { placeholder: "natural armor" })),
    field("Hit points", inp("hp", { type: "number", min: 1 })),
    field("Hit dice", inp("hit_dice", { placeholder: "8d10 + 16" })),
    ...SPEEDS.map((k) => field(k === "walk" ? "Speed (ft.)" : `${k[0].toUpperCase()}${k.slice(1)} (ft.)`, h("input.input", { type: "number", min: 0, value: m.speed?.[k] || "",
      oninput: (e) => { m.speed = { ...m.speed }; if (Number(e.target.value)) m.speed[k] = Number(e.target.value); else delete m.speed[k]; changed(); } }))),
    field("Hovers", h("label.check", h("input", { type: "checkbox", checked: !!m.hover, onchange: (e) => { m.hover = e.target.checked; changed(); } }), "Can hover while flying"))),
  h("div.mf-grid", { style: { marginTop: "10px" } },
    field("Vulnerabilities", inp("vulnerabilities")), field("Resistances", inp("resistances", { placeholder: "cold; bludgeoning, piercing, slashing from nonmagical attacks" })),
    field("Immunities", inp("immunities")), field("Condition immunities", inp("condition_immunities"))));
  const abil = card("Abilities", h("div.mf-abilities", ABILITIES.map((a) => {
    const save = h("input.input.mono", { placeholder: "save", value: m.saves?.[a] ?? "", title: "Saving throw bonus, if proficient (e.g. 5)",
      oninput: (e) => { m.saves = { ...m.saves }; if (e.target.value.trim() === "") delete m.saves[a]; else m.saves[a] = Number(e.target.value); changed(); } });
    return h("div.mf-ability", h("label", a.toUpperCase()),
      h("input.input", { type: "number", min: 1, max: 30, value: m.abilities[a], oninput: (e) => { m.abilities = { ...m.abilities, [a]: Number(e.target.value) || 10 }; changed(); } }), save);
  })), field("Skills", h("input.input", { value: Object.entries(m.skills || {}).map(([k, v]) => `${k} ${signed(v).replace("−", "-")}`).join(", "), placeholder: "perception +5, stealth +6",
    oninput: (e) => { const sk = {}; for (const part of e.target.value.split(",")) { const x = part.trim().match(/^(.+?)\s*([+\-−]?\d+)$/); if (x) sk[x[1].toLowerCase()] = Number(x[2].replace("−", "-")); } m.skills = sk; changed(); } })),
  h("div.mf-grid", field("Senses", inp("senses", { placeholder: "darkvision 60 ft." })), field("Languages", inp("languages"))));

  const sectionCard = ([key, label]) => {
    const list = h("div.stack.sm");
    const draw = () => clear(list, (m[key] || []).map((a, i) => h("div.mf-action",
      h("div.row.nowrap", h("input.input.grow", { value: a.name, placeholder: "Name", oninput: (e) => { a.name = e.target.value; changed(); } }),
        btn("", { icon: "up", size: "sm", kind: "ghost", disabled: i === 0, onclick: () => { [m[key][i - 1], m[key][i]] = [m[key][i], m[key][i - 1]]; draw(); changed(); } }),
        btn("", { icon: "trash", size: "sm", kind: "ghost", onclick: () => { m[key].splice(i, 1); draw(); changed(); } })),
      h("textarea.input", { rows: 2, value: a.desc, placeholder: key === "actions" ? "Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 10 (2d6 + 3) slashing damage." : "",
        oninput: (e) => { a.desc = e.target.value; e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + 2 + "px"; changed(); } }))),
      btn(`Add ${label.toLowerCase().replace(/s$/, "")}`, { icon: "plus", size: "sm", kind: "ghost", onclick: () => { m[key] = [...(m[key] || []), { name: "", desc: "" }]; draw(); changed(); } }));
    draw();
    return card({ title: label, actions: key === "legendary" ? h("label.small.row.nowrap", "Per round ", h("input.input", { type: "number", min: 1, max: 5, value: m.legendary_count || 3, style: { width: "64px" },
      oninput: (e) => { m.legendary_count = Number(e.target.value) || 3; changed(); } })) : null }, list);
  };
  const notes = card("Notes", h("textarea.input", { rows: 4, value: m.notes || "", placeholder: "Tactics, lair, where it lives… (sent to Foundry as its biography)", oninput: (e) => { m.notes = e.target.value; changed(); } }));

  const title = h("span", m.name);
  const toFoundry = async () => {
    try { await api.monster_save(m); const r = await api.monster_to_foundry(m.id); m.foundry_id = r.id; toast(r.created ? "Added to Foundry" : "Updated in Foundry", r.created ? "It's in the Lore Studio folder of your actors." : "Your Foundry copy now matches.", "good", "hive"); }
    catch (e) { toastError(e); }
  };
  const copyPlan = async () => {
    const r = await api.monster_check(m);
    try { await navigator.clipboard.writeText(r.stat_text); toast("Copied", "Paste it into a session plan. It shows as a stat block.", "good", "copy", 3000); }
    catch { modal("Copy this into a plan", h("textarea.input.mono", { rows: 14, value: r.stat_text, readonly: true }), [{ label: "Done", kind: "primary" }], { wide: true }); }
  };
  root.append(
    h("div.page-head.row", h("h1.page-title.grow", title), status),
    h("div.row.wrap", { style: { gap: "8px", margin: "-6px 0 16px" } },
      btn("Scale…", { icon: "sliders", kind: "primary", onclick: () => scaleDialog(ctx, m, (saved) => ctx.go("monsters", { id: saved.id })) }),
      btn(m.foundry_id ? "Update in Foundry" : "Send to Foundry", { icon: "hive", onclick: toFoundry }),
      btn("Copy for a plan", { icon: "copy", kind: "ghost", onclick: copyPlan }),
      btn("Duplicate", { icon: "dup", kind: "ghost", onclick: async () => { const c = structuredClone(m); delete c.id; delete c.foundry_id; c.name += " (copy)"; open(ctx, await api.monster_save(c)); } }),
      btn("Delete", { icon: "trash", kind: "ghost", onclick: async () => { if (await confirmBox(`Delete ${m.name}?`, "It's removed from Lore Studio. A copy you sent to Foundry stays there.", "Delete", true)) { await api.monster_delete(m.id); ctx.go("monsters"); } } })),
    h("div.monster-grid",
      h("div.stack", basics, defense, abil, ...SECTIONS.map(sectionCard), notes),
      h("div.monster-aside", card("Challenge", crPanel), card(null, preview), m.source ? h("p.tiny.faint", `From: ${m.source}`) : null)));
  drawPreview(m0);
  let drawSide = () => {};
  return (fn) => { drawSide = fn; };
}

// ---- the encounter builder -----------------------------------------------------------------------
const DIFF = [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"], ["deadly", "Deadly"]];

function meter(ev) {
  if (!ev.thresholds?.deadly) return h("p.small.muted", { style: { margin: 0 } }, "Add your party's levels to see how hard this is.");
  // evenly spaced marks: 0, easy, medium, hard and deadly at 0/20/40/60/80%, twice deadly at the end
  const th = ev.thresholds;
  const stops = [[0, 0], [th.easy, 20], [th.medium, 40], [th.hard, 60], [th.deadly, 80], [th.deadly * 2, 100]];
  const pct = (x) => {
    for (let i = 1; i < stops.length; i++) {
      const [x0, p0] = stops[i - 1], [x1, p1] = stops[i];
      if (x <= x1) return `${p0 + ((x - x0) / Math.max(1, x1 - x0)) * (p1 - p0)}%`;
    }
    return "100%";
  };
  return h("div.enc-meter",
    h("div.enc-bar", h("div.enc-fill", { class: ev.difficulty || "trivial", style: { width: pct(ev.adjusted_xp) } }),
      ...DIFF.map(([k, l]) => h("div.enc-tick", { style: { left: pct(th[k]) }, title: `${l}: ${th[k].toLocaleString()} XP` }, h("span", l)))),
    h("div.row.nowrap", { style: { marginTop: "22px", alignItems: "baseline" } },
      h("b.enc-verdict", { class: ev.difficulty || "trivial" }, (ev.difficulty || "trivial").replace(/^./, (c) => c.toUpperCase())),
      h("span.grow.small.muted", ` · ${ev.adjusted_xp.toLocaleString()} adjusted XP`),
      ev.deadly_ratio >= 1.5 ? h("span.chip.bad", "Beyond deadly") : null));
}

async function encounterView(ctx, root, eid, onListChange) {
  let { encounter: e, eval: ev, levels } = await api.encounter(eid);
  let customLevels = null;
  const status = h("span.small.faint", "Saved");
  const meterBox = h("div"), facts = h("div.cr-facts"), groupsBox = h("div.stack.sm");
  let saveT;
  const changed = async () => {
    status.textContent = "Saving…";
    try { ({ encounter: e, eval: ev } = await api.encounter_check(e, customLevels)); } catch (err) { toastError(err); }
    drawGroups(); drawEval();
    clearTimeout(saveT); saveT = setTimeout(async () => {
      try { const r = await api.encounter_save(e); e.updated = r.updated; status.textContent = "Saved"; onListChange(); } catch (err) { status.textContent = "Not saved"; toastError(err); }
    }, 500);
  };
  ctx.onLeave(() => { if (status.textContent !== "Saved") api.encounter_save(e).catch(() => {}); });
  const fact = (l, v) => h("div", h("span.tiny.faint", l), h("b", String(v)));
  function drawEval() {
    clear(meterBox, meter(ev));
    clear(facts, fact("XP to share", ev.xp.toLocaleString()), fact("Per character", ev.xp_per_character != null ? ev.xp_per_character.toLocaleString() : "—"),
      fact("Monsters", ev.monsters), fact("Multiplier", `×${ev.multiplier}${ev.counted !== ev.monsters ? ` (${ev.monsters - ev.counted} too weak to count)` : ""}`));
  }
  function drawGroups() {
    clear(groupsBox, e.groups.length ? e.groups.map((g, i) => h("div.enc-row",
      h("div.grow", g.kind === "monster" ? h("button.linkish", { onclick: () => ctx.go("monsters", { id: g.ref }) }, h("b", g.name)) : h("b", g.name),
        h("div.tiny.faint", `CR ${g.cr_label} · ${g.xp.toLocaleString()} XP each${g.kind === "srd" ? " · free 5e rules" : ""}${g.foundry_id ? " · in Foundry" : ""}`)),
      h("div.stepper", btn("", { icon: "minus", size: "sm", kind: "ghost", onclick: () => { if (g.count > 1) { g.count--; changed(); } } }),
        h("b", String(g.count)), btn("", { icon: "plus", size: "sm", kind: "ghost", onclick: () => { g.count++; changed(); } })),
      btn("", { icon: "trash", size: "sm", kind: "ghost", title: "Remove", onclick: () => { e.groups.splice(i, 1); changed(); } })))
      : h("p.small.muted", { style: { margin: 0 } }, "Add monsters from the list below."));
  }

  // picking monsters: yours and the free 5e rules
  const mine = await api.monsters();
  const { monsters: srd } = await api.srd_monsters();
  let src = mine.length ? "mine" : "srd";
  const q = h("input.input", { placeholder: "Search by name, type or CR…", oninput: () => drawPick() });
  const pick = h("div.pick-list", { style: { maxHeight: "340px" } });
  const add = (kind, ref) => {
    const g = e.groups.find((x) => x.kind === kind && x.ref === ref);
    if (g) g.count++; else e.groups.push({ kind, ref, count: 1 });
    changed();
  };
  function drawPick() {
    const t = q.value.trim().toLowerCase();
    const items = src === "mine" ? mine.map((m) => ({ kind: "monster", ref: m.id, name: m.name, cr: m.cr, sub: `${m.size} ${m.type}` }))
      : srd.map((m) => ({ kind: "srd", ref: m.index, name: m.name, cr: m.cr, sub: `${m.size} ${m.type}` }));
    const hits = items.filter((x) => !t || `${x.name} ${x.sub} cr ${crLabel(x.cr)}`.toLowerCase().includes(t)).slice(0, 150);
    clear(pick, hits.length ? hits.map((x) => h("button.pick-row", { onclick: () => add(x.kind, x.ref) },
      icon("plus"), h("span.grow", h("b", x.name), h("span.faint", ` · ${x.sub}`)), h("span.chip", `CR ${crLabel(x.cr)}`)))
      : h("p.small.muted", src === "mine" && !mine.length ? "You haven't made any monsters yet. Try the free 5e rules." : "Nothing matches."));
  }
  drawPick();

  const levelsIn = h("input.input", { value: levels.join(", "), placeholder: "e.g. 5, 5, 5, 6",
    oninput: () => { const lv = levelsIn.value.split(/[,\s]+/).map(Number).filter((n) => n >= 1 && n <= 20); customLevels = lv.length ? lv : null; changed(); } });
  const sessions = await api.sessions().catch(() => []);

  const copyPlan = async () => {
    const text = await api.encounter_text(e, customLevels);
    try { await navigator.clipboard.writeText(text); toast("Copied", "Paste it into a session plan: the summary, one-click Foundry links and every stat block.", "good", "copy", 3500); }
    catch { modal("Copy this into a plan", h("textarea.input.mono", { rows: 16, value: text, readonly: true }), [{ label: "Done", kind: "primary" }], { wide: true }); }
  };
  const sendAll = async () => {
    try { await api.encounter_save(e); const r = await api.encounter_to_foundry(e.id); toast("Sent to Foundry", r.map((x) => x.name).join(", "), "good", "hive"); ctx.reload(); }
    catch (err) { toastError(err); }
  };
  const place = async () => {
    try { await api.encounter_save(e); const r = await api.encounter_place(e.id, true); toast(`Placed ${r.placed} token${r.placed === 1 ? "" : "s"}`, "Hidden on the scene open in Foundry. Reveal them when the fight starts.", "good", "hive"); }
    catch (err) { toastError(err); }
  };
  const nameIn = h("input.input.enc-name", { value: e.name, oninput: () => { e.name = nameIn.value; changed(); } });
  root.append(
    h("div.page-head.row", nameIn, status),
    h("div.row.wrap", { style: { gap: "8px", margin: "-6px 0 16px" } },
      btn("Copy for a plan", { icon: "copy", kind: "primary", onclick: copyPlan }),
      btn("Send all to Foundry", { icon: "hive", onclick: sendAll }),
      btn("Place on scene", { icon: "play", kind: "ghost", title: "Put every monster's tokens, hidden, on the scene that's open in Foundry", onclick: place }),
      btn("Delete", { icon: "trash", kind: "ghost", onclick: async () => { if (await confirmBox(`Delete ${e.name}?`, "The monsters themselves stay.", "Delete", true)) { await api.encounter_delete(e.id); onListChange(); ctx.go("monsters", { view: "encounters" }); } } })),
    h("div.monster-grid",
      h("div.stack",
        card("The fight", groupsBox),
        card({ title: "Add monsters", actions: seg([["mine", "Mine"], ["srd", "Free 5e rules"]], src, (v) => { src = v; drawPick(); }) }, h("div.stack.sm", q, pick)),
        card("Notes", h("div.stack.sm",
          h("textarea.input", { rows: 4, value: e.notes || "", placeholder: "Terrain, tactics, what happens if they flee…", oninput: (ev2) => { e.notes = ev2.target.value; changed(); } }),
          h("div.field", h("label", "For session"), h("select.select", { onchange: (ev2) => { e.session = ev2.target.value; changed(); } },
            h("option", { value: "" }, "Not tied to a session"),
            ...sessions.slice().reverse().map((x) => h("option", { value: x.id, selected: x.id === e.session }, `${x.number ? x.number + ". " : ""}${x.title}`))))))),
      h("div.monster-aside",
        card("How hard is it?", h("div.stack.sm",
          h("div.field", h("label", "Party levels"), levelsIn, h("div.help", "From the Party page. Change them here to try another group.")),
          meterBox, facts,
          h("p.tiny.faint", { style: { margin: 0 } }, "The Dungeon Master's Guide way: monster XP, times a multiplier for how many there are (much weaker monsters don't count towards it), against your party's thresholds."))))));
  drawGroups(); drawEval();
}

async function newEncounter(ctx) {
  try { const e = await api.encounter_save({ name: "New encounter", groups: [] }); ctx.go("monsters", { enc: e.id }); } catch (err) { toastError(err); }
}

export default {
  id: "monsters", label: "Monsters", icon: "claw",

  async mount(ctx, params, root) {
    const all = await api.monsters();
    const q = h("input.input", { placeholder: "Search…", oninput: () => drawList() });
    const listBox = h("div.stack.xs");
    const drawList = () => {
      const t = q.value.trim().toLowerCase();
      clear(listBox, all.filter((x) => !t || `${x.name} ${x.type}`.toLowerCase().includes(t)).map((x) =>
        h("button.side-item", { class: x.id === params.id ? "active" : "", onclick: () => ctx.go("monsters", { id: x.id }) },
          icon("claw"), h("span.grow", h("span", x.name), h("span.sub", `CR ${x.cr_label} · ${x.type}`)))));
    };
    const encs = await api.encounters();
    const encBox = h("div.stack.xs");
    const drawEnc = (list) => clear(encBox, list.map((x) => h("button.side-item", { class: x.id === params.enc ? "active" : "", onclick: () => ctx.go("monsters", { enc: x.id }) },
      icon("dice"), h("span.grow", h("span", x.name), h("span.sub", `${x.monsters} monster${x.monsters === 1 ? "" : "s"}`)))));
    ctx.side(h("h2", "Monsters"),
      h("div.row", { style: { padding: "0 6px 10px", gap: "6px" } },
        btn("New monster", { icon: "plus", size: "sm", kind: "primary", onclick: () => newMonster(ctx) }),
        btn("Encounter", { icon: "plus", size: "sm", title: "Build an encounter", onclick: () => newEncounter(ctx) })),
      all.length > 8 ? h("div", { style: { padding: "0 6px 8px" } }, q) : null,
      h("div.group-label", "Encounters"), encBox,
      h("div.group-label", "Your monsters"), listBox);
    drawList(); drawEnc(encs);

    if (params.enc) return encounterView(ctx, root, params.enc, async () => drawEnc(await api.encounters()));

    if (params.id) {
      let m;
      try { m = await api.monster(params.id); } catch (e) { toastError(e); return ctx.go("monsters"); }
      const hook = editor(ctx, root, m);
      hook(async () => { const fresh = await api.monsters(); all.splice(0, all.length, ...fresh); drawList(); });
      return;
    }
    root.append(ctx.header({ title: "Monsters", subtitle: "Make creatures, check their challenge, scale them to your party, and send them to Foundry.", icon: "claw",
      actions: [btn("New monster", { icon: "plus", kind: "primary", onclick: () => newMonster(ctx) })] }));
    if (!all.length) {
      root.append(card(null, empty("claw", "No monsters yet",
        "Start from a blank sheet, any monster in the free 5e rules, a creature in your Foundry world or compendiums, or a 5etools homebrew file.",
        h("div.row", { style: { justifyContent: "center", gap: "8px" } },
          btn("Free 5e rules", { icon: "book", onclick: () => pickSrd(ctx).catch(toastError) }),
          btn("From Foundry", { icon: "hive", onclick: () => pickFoundry(ctx).catch(toastError) }),
          btn("Import 5etools", { icon: "upload", onclick: () => import5e(ctx) }),
          btn("Blank", { icon: "plus", kind: "primary", onclick: async () => open(ctx, await api.monster_new("blank")) })))));
      return;
    }
    root.append(h("div.monster-cards", all.map((x) => h("button.monster-card", { onclick: () => ctx.go("monsters", { id: x.id }) },
      h("div.row.nowrap", h("b.grow", x.name), h("span.chip", `CR ${x.cr_label}`)),
      h("div.small.muted", `${x.size} ${x.type}`), h("div.tiny.faint", [x.source, x.foundry_id ? "in Foundry" : ""].filter(Boolean).join(" · "))))));
  },
};
