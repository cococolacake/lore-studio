// The Party: a profile for each player character, with their backstory, your plans for it,
// and their Foundry sheet (read live, with a fixer for hit points broken by level-ups).
import { api } from "../api.js";
import { h, btn, card, clear, empty, toast, toastError, modal, confirmBox } from "../dom.js";
import { icon } from "../icons.js";

const ABIL = ["str", "dex", "con", "int", "wis", "cha"];
const signed = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
const imgUrl = (origin, img) => (!img ? "" : /^(https?:|data:)/.test(img) ? img : origin ? `${origin.replace(/\/$/, "")}/${img.replace(/^\//, "")}` : "");
const ago = (t) => { if (!t) return ""; const m = Math.round((Date.now() / 1000 - t) / 60); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t * 1000).toLocaleDateString(); };

function portrait(p, origin, size = 56) {
  const src = imgUrl(origin, p.sheet?.img);
  const initials = (p.character || p.player || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return h("div.pc-portrait", { style: { width: size + "px", height: size + "px" } },
    src ? h("img", { src, alt: "", onerror: (e) => e.target.remove() }) : null, h("span", initials));
}

function sheetLine(p) {
  const s = p.sheet;
  if (!s) return p.level ? `Level ${p.level}` : "";
  return [s.classes || (s.level ? `Level ${s.level}` : ""), s.race, s.background].filter(Boolean).join(" · ");
}

// ---- hit point fixer -------------------------------------------------------------------------
async function fixHp(ctx, p) {
  let chk = p.hp_check;
  if (!chk) return toast("Read the sheet first", "Click Read sheet so Lore Studio can see how the hit points add up.", "warn", "alert");
  const choices = {};             // class id -> {level: value}
  let clearBonus = !!(p.sheet.hp_detail.bonus_overall || p.sheet.hp_detail.bonus_level);
  let clearOverride = p.sheet.hp_detail.override != null;
  const total = h("div.hp-total");
  const calc = () => {
    let sum = 0;
    for (const r of chk.rows) {
      const v = choices[r.class_id]?.[r.level] ?? r.value;
      const n = v === "max" ? r.die : v === "avg" ? Math.floor(r.die / 2) + 1 : Number(v) || 0;
      sum += n;
    }
    const expect = sum + chk.con_total + (clearBonus ? 0 : chk.bonus);
    clear(total, h("div.row.nowrap", h("span.grow", "Max HP after this"), h("b", String(expect))),
      h("div.tiny.faint", `${sum} from level-ups + ${chk.con_total} from Constitution (${signed(chk.con)} × ${chk.level})${!clearBonus && chk.bonus ? ` + ${chk.bonus} bonus` : ""}`),
      h("div.tiny.faint", `Foundry shows ${chk.foundry_max} now.`));
  };
  const rows = chk.rows.map((r) => {
    const cur = r.value;
    const sel = h("select.select", { onchange: (e) => { (choices[r.class_id] ??= {})[r.level] = e.target.value === "num" ? Number(num.value) || 1 : e.target.value; num.hidden = e.target.value !== "num"; calc(); } },
      h("option", { value: "", selected: cur == null, disabled: true }, "— missing —"),
      h("option", { value: "max", selected: cur === "max" }, `Max (${r.die})`),
      h("option", { value: "avg", selected: cur === "avg" }, `Average (${Math.floor(r.die / 2) + 1})`),
      h("option", { value: "num", selected: typeof cur === "number" || /^\d+$/.test(String(cur ?? "")) }, "Rolled…"));
    const num = h("input.input", { type: "number", min: 1, max: r.die, value: /^\d+$/.test(String(cur ?? "")) ? cur : "", hidden: !/^\d+$/.test(String(cur ?? "")), style: { width: "72px" },
      oninput: () => { (choices[r.class_id] ??= {})[r.level] = Math.min(r.die, Math.max(1, Number(num.value) || 1)); calc(); } });
    return h("div.hp-row", { class: r.hp == null ? "bad" : "" }, h("span.grow", `${r.class} ${r.level}`, h("span.faint", ` · d${r.die}`)), sel, num);
  });
  calc();
  const body = h("div.stack",
    chk.problems.length ? h("div.callout.warn", h("b", "What looks off"), h("ul", chk.problems.map((x) => h("li", x)))) : h("div.callout", "Nothing looks off: the level-ups add up to Foundry's max HP."),
    h("div.small.muted", "Hit points from each level-up. The first level of your first class is usually the full die."),
    h("div.hp-rows", rows),
    chk.bonus || p.sheet.hp_detail.bonus_overall || p.sheet.hp_detail.bonus_level
      ? h("label.check", h("input", { type: "checkbox", checked: clearBonus, onchange: (e) => { clearBonus = e.target.checked; calc(); } }), "Remove the hit point bonus that was added to cover it")
      : null,
    p.sheet.hp_detail.override != null
      ? h("label.check", h("input", { type: "checkbox", checked: clearOverride, onchange: (e) => { clearOverride = e.target.checked; } }), `Stop overriding max HP (set by hand to ${p.sheet.hp_detail.override})`)
      : null,
    total);
  const r = await modal(`Fix ${p.character || p.player}'s hit points`, body,
    [{ label: "Cancel", kind: "ghost", value: false }, { label: "Write to Foundry", kind: "primary", icon: "hive", value: true }], { wide: true });
  if (!r) return;
  const changes = {};
  if (Object.keys(choices).length) changes.class_hp = choices;
  if (clearBonus) { changes.bonus_overall = ""; changes.bonus_level = ""; }
  if (clearOverride) changes.override = null;
  if (!Object.keys(changes).length) return;
  try { await api.party_fix_hp(p.id, changes); toast("Fixed in Foundry", "The sheet was read again to check.", "good", "check"); ctx.reload(); } catch (e) { toastError(e); }
}

// ---- one character ----------------------------------------------------------------------------
async function profile(ctx, root, p, origin) {
  const status = h("span.small.faint", "Saved");
  let t;
  const changed = () => {
    status.textContent = "Saving…";
    clearTimeout(t); t = setTimeout(async () => {
      try { const r = await api.party_save(p); Object.assign(p, r); status.textContent = "Saved"; } catch (e) { status.textContent = "Not saved"; toastError(e); }
    }, 600);
  };
  ctx.onLeave(() => { if (status.textContent !== "Saved") api.party_save(p).catch(() => {}); });
  const text = (key, label, help, rows = 5, ph = "") => h("div.field", h("label", label),
    h("textarea.input", { rows, value: p[key] || "", placeholder: ph, oninput: (e) => { p[key] = e.target.value; changed(); } }), help ? h("div.help", help) : null);
  const line = (key, label, ph = "") => h("div.field", h("label", label), h("input.input", { value: p[key] || "", placeholder: ph, oninput: (e) => { p[key] = e.target.value; changed(); } }));

  // Foundry sheet
  const sheetBox = h("div.stack.sm");
  const inv = await api.foundry_inventory().catch(() => ({ connected: false, actors: [] }));
  const pcs = (inv.actors || []).filter((a) => a.type === "character");
  const drawSheet = () => {
    const s = p.sheet;
    const link = h("select.select", { onchange: async (e) => { p.foundry_id = e.target.value; await api.party_save(p).catch(toastError); if (p.foundry_id) read(); else { p.sheet = null; drawSheet(); } } },
      h("option", { value: "" }, inv.connected ? "Not linked" : "Not linked (Foundry isn't connected)"),
      ...pcs.map((a) => h("option", { value: a.id, selected: a.id === p.foundry_id }, a.name)),
      p.foundry_id && !pcs.some((a) => a.id === p.foundry_id) ? h("option", { value: p.foundry_id, selected: true }, s?.name || "Linked character") : null);
    const chk = p.hp_check;
    clear(sheetBox,
      h("div.field", h("label", "Foundry character"), h("div.row.nowrap", link, p.foundry_id ? btn("Read sheet", { icon: "refresh", size: "sm", onclick: read }) : null)),
      s ? h("div.stack.sm",
        h("div.pc-stats",
          stat("Level", s.level ?? "—"), stat("HP", s.hp_max != null ? `${s.hp ?? "?"} / ${s.hp_max}` : "—", chk?.problems?.length ? "warn" : ""),
          stat("AC", s.ac ?? "—"), stat("Speed", s.speed ? `${s.speed} ft.` : "—"), stat("Passive Perception", s.passive ?? "—"), s.spell_dc ? stat("Spell save DC", s.spell_dc) : null),
        h("div.pc-abil", ABIL.map((a) => h("div", h("span.tiny.faint", a.toUpperCase()), h("b", s.abilities?.[a]?.value ?? "—"), h("span.tiny", s.abilities?.[a] ? signed(s.abilities[a].mod) : "")))),
        chk ? h("div.row.nowrap", { style: { gap: "8px" } },
          chk.problems.length ? h("span.chip.warn", icon("alert"), `Hit points: ${chk.problems.length} thing${chk.problems.length === 1 ? "" : "s"} to check`) : h("span.chip.good", icon("check"), "Hit points add up"),
          h("div.spacer"), btn("Fix hit points…", { icon: "heart", size: "sm", kind: chk.problems.length ? "primary" : "ghost", onclick: () => fixHp(ctx, p) })) : null,
        h("div.tiny.faint", `Read from Foundry ${ago(s.read)}.`))
        : h("p.small.muted", { style: { margin: 0 } }, p.foundry_id ? "Click Read sheet to bring in their class, level, HP, AC and abilities." : "Link their Foundry character to see their sheet here."));
  };
  const stat = (l, v, cls = "") => h("div.pc-stat", { class: cls }, h("span.tiny.faint", l), h("b", String(v)));
  async function read() {
    try { const r = await api.party_sync(p.id); Object.assign(p, r); const all = await api.party(); Object.assign(p, all.party.find((x) => x.id === p.id) || {}); drawSheet(); }
    catch (e) { toastError(e); }
  }
  drawSheet();

  const lorePage = (await api.page_titles().catch(() => [])).find((x) => x.title.toLowerCase() === (p.character || "").toLowerCase());
  root.append(
    h("div.page-head.row", portrait(p, origin, 64),
      h("div.grow", h("h1.page-title", { style: { margin: 0 } }, p.character || "Unnamed"), h("div.small.muted", [p.player ? `Played by ${p.player}` : "", sheetLine(p)].filter(Boolean).join(" · "))),
      status),
    h("div.row", { style: { gap: "8px", margin: "-4px 0 16px" } },
      lorePage ? btn("Lore page", { icon: "book", kind: "ghost", onclick: () => ctx.go("lore", { id: lorePage.id }) }) : null,
      p.foundry_id && inv.connected ? btn("Open in Foundry", { icon: "hive", kind: "ghost", onclick: () => api.foundry_open_sheet(p.foundry_id).catch(toastError) }) : null,
      btn("Remove from party", { icon: "trash", kind: "ghost", onclick: async () => { if (await confirmBox(`Remove ${p.character || p.player}?`, "Their profile is deleted from Lore Studio. Their Foundry sheet isn't touched.", "Remove", true)) { await api.party_delete(p.id); ctx.go("party"); } } })),
    h("div.party-grid",
      h("div.stack",
        card("Character", h("div.mf-grid", line("character", "Character", "Jane Roe"), line("player", "Player", "Alex"), line("pronouns", "Pronouns", "she/her"),
          line("level", "Level", "if no Foundry sheet"), line("speaker", "Transcript label", "e.g. Players 01"))),
        card("About the player", text("about", "", "What they enjoy at the table, what they'd rather avoid, how they like to be involved.", 4, "Loves puzzles and NPC banter; not into long combats…")),
        card("Backstory", text("backstory", "", "A short synopsis of their backstory.", 7)),
        card({ title: "Your plans", actions: h("span.chip.warn", icon("lock"), "GM only") },
          text("plans", "", "What you plan to do with their story. Never shown to players, never in the player lore book or player recaps.", 6),
          text("hooks", "Threads to pull", "", 3, "Her mentor's letter · the stolen ring · …"))),
      h("div.stack", card("Character sheet", sheetBox))));
}

export default {
  id: "party", label: "Party", icon: "users",

  async mount(ctx, params, root) {
    const { party: all, foundry_origin: origin } = await api.party();
    const add = async () => {
      try { const p = await api.party_save({ character: "New character" }); ctx.go("party", { id: p.id }); } catch (e) { toastError(e); }
    };
    ctx.side(h("h2", "Party"),
      ...all.map((p) => h("button.side-item", { class: p.id === params.id ? "active" : "", onclick: () => ctx.go("party", { id: p.id }) },
        portrait(p, origin, 26), h("span.grow", h("span", p.character || p.player), h("span.sub", sheetLine(p) || p.player || "")))),
      h("div", { style: { padding: "14px 6px" } }, btn("Add a character", { icon: "plus", size: "sm", kind: "primary", onclick: add })));
    if (params.id) {
      const p = all.find((x) => x.id === params.id);
      if (!p) return ctx.go("party");
      return profile(ctx, root, p, origin);
    }
    root.append(ctx.header({ title: "Party", subtitle: "Your players and their characters: who they are, where they come from, and what you have in store.", icon: "users",
      actions: [btn("Add a character", { icon: "plus", kind: "primary", onclick: add })] }));
    if (!all.length) {
      root.append(card(null, empty("users", "No one in the party yet", "Add each player character: their backstory, your plans for it, and their Foundry sheet.",
        btn("Add a character", { icon: "plus", kind: "primary", onclick: add }))));
      return;
    }
    root.append(h("div.pc-cards", all.map((p) => h("button.pc-card", { onclick: () => ctx.go("party", { id: p.id }) },
      h("div.row.nowrap", portrait(p, origin), h("div.grow", h("b", p.character || "Unnamed"), h("div.small.muted", p.player ? `Played by ${p.player}` : ""), h("div.tiny.faint", sheetLine(p)))),
      p.sheet ? h("div.pc-mini", h("span", `HP ${p.sheet.hp ?? "?"}/${p.sheet.hp_max ?? "?"}`), h("span", `AC ${p.sheet.ac ?? "?"}`),
        p.hp_check?.problems?.length ? h("span.chip.warn", icon("alert"), "HP") : null) : null,
      p.backstory ? h("p.small.muted.clamp3", p.backstory) : null))));
  },
};
