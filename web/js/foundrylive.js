// Live mode's Foundry panel: roll tables, monsters (stat blocks, tokens), scenes and sounds, one click each.
// Works through the Lore Studio Bridge module, so the GM's Foundry does the actual rolling and placing.
import { api } from "./api.js";
import { h, btn, card, clear, toast, toastError, modal } from "./dom.js";
import { icon } from "./icons.js";
import { switchEl } from "./components.js";
import { showInFoundry } from "./pages/handouts.js";

const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function findByName(list, name) {
  const n = norm(name);
  return list.find((x) => norm(x.name) === n) || list.find((x) => norm(x.name).startsWith(n)) || list.find((x) => norm(x.name).includes(n));
}
const mod = (m) => (m == null ? "" : m >= 0 ? `+${m}` : `${m}`);

export async function statBlock(a) {
  let s, origin = "";
  try { s = await api.foundry_actor(a.id); origin = (await api.foundry_status()).origin || ""; } catch (e) { return toastError(e); }
  const imgUrl = !s.img ? "" : /^(https?:|data:)/.test(s.img) ? s.img : origin ? `${origin}/${s.img.replace(/^\//, "")}` : "";
  let count = 1, hidden = false;
  const countIn = h("input.input", { type: "number", min: 1, max: 20, value: 1, style: { width: "70px" }, oninput: (e) => { count = Number(e.target.value) || 1; } });
  const abil = Object.entries(s.abilities || {});
  const actions = (s.items || []).filter((i) => ["weapon", "feat", "spell"].includes(i.type));
  const res = await modal(s.name, h("div.stack.statblock",
    h("div.row", { style: { gap: "14px", alignItems: "flex-start" } },
      imgUrl ? h("img.sb-img", { src: imgUrl, alt: "", onerror: (e) => e.target.remove() }) : null,
      h("div.grow",
        h("div.small.muted", [s.size, s.creature, s.alignment].filter(Boolean).join(", ")),
        h("div.sb-stats",
          s.ac != null ? h("span", h("b", "AC "), s.ac) : null,
          s.hp != null ? h("span", h("b", "HP "), s.hp_max != null ? `${s.hp}/${s.hp_max}` : s.hp) : null,
          s.cr != null ? h("span", h("b", "CR "), s.cr) : null,
          s.speed ? h("span", h("b", "Speed "), s.speed) : null),
        s.senses ? h("div.small", h("b", "Senses "), s.senses) : null)),
    abil.length ? h("div.sb-abil", abil.map(([k, v]) => h("div", h("b", k.toUpperCase()), h("span", `${v.value ?? "–"} (${mod(v.mod)})`)))) : null,
    actions.length ? h("div.stack.sm", actions.slice(0, 20).map((i) => h("details.sb-item", h("summary", h("b", i.name), i.activation ? h("span.tiny.faint", ` ${i.activation}`) : null),
      i.desc ? h("div.small.muted", i.desc) : null))) : null,
    s.bio ? h("details", h("summary.small", "Description"), h("div.small.muted", s.bio)) : null,
    h("div.row", { style: { gap: "10px", alignItems: "center" } }, h("span.small", "Place"), countIn, h("span.small", "on the current scene"),
      switchEl(false, (v) => { hidden = v; }, "Hidden"))),
  [{ label: "Open sheet in Foundry", kind: "ghost", value: "sheet" }, { label: "Close", kind: "ghost", value: false }, { label: "Place tokens", kind: "primary", icon: "plus", value: "place" }], { wide: true });
  try {
    if (res === "sheet") await api.foundry_open_sheet(a.id);
    if (res === "place") { const r = await api.foundry_place(a.id, count, hidden); toast(`Placed ${r.placed} ${s.name}`, `On ${r.scene}`, "good", "check", 3000); }
  } catch (e) { toastError(e); }
}

export function foundryPanel(ctx, { sceneLinks = () => [], sessionId = null } = {}) {
  const box = h("div");
  let inv = null, tab = "here", q = "";
  const results = [];
  const resultsBox = h("div.fl-results");
  const drawResults = () => clear(resultsBox, results.slice(0, 4).map((r) => h("div.fl-result", h("div.tiny.faint", r.title), r.lines.map((l) => h("div.small", l)))));

  const rollTable = async (t) => {
    try {
      const r = await api.foundry_roll_table(t.id);
      results.unshift({ title: `${r.table}${r.total != null ? ` (rolled ${r.total})` : ""}`, lines: r.results.length ? r.results : ["(no result)"] });
      drawResults();
    } catch (e) { toastError(e); }
  };
  const playSound = async (name) => {
    for (const pl of inv.playlists) {
      if (norm(pl.name) === norm(name)) return api.foundry_playlist(pl.id, null, pl.playing ? "stop" : "play").then(refresh);
      const so = findByName(pl.sounds, name);
      if (so && norm(so.name).includes(norm(name))) return api.foundry_playlist(pl.id, so.id, so.playing ? "stop" : "play").then(refresh);
    }
    const pl = findByName(inv.playlists, name);
    if (pl) return api.foundry_playlist(pl.id, null, pl.playing ? "stop" : "play").then(refresh);
    toast(`No sound called “${name}” in Foundry`, "", "warn", "alert");
  };

  /** Run a {kind:name} link from the plan. */
  const act = async (kind, name) => {
    if (!inv?.connected) return toast("Foundry isn't connected", "Open your world as the GM with the Lore Studio Bridge enabled (Settings → Foundry).", "warn", "dice", 6000);
    try {
      if (kind === "actor") { const a = findByName(inv.actors, name); return a ? statBlock(a) : toast(`No actor called “${name}” in Foundry`, "", "warn", "alert"); }
      if (kind === "table") { const t = findByName(inv.tables, name); return t ? rollTable(t) : toast(`No roll table called “${name}” in Foundry`, "", "warn", "alert"); }
      if (kind === "scene") {
        const sc = findByName(inv.scenes, name);
        if (!sc) return toast(`No scene called “${name}” in Foundry`, "", "warn", "alert");
        await api.foundry_scene(sc.id, "activate"); toast(`Players moved to ${sc.name}`, "", "good", "check", 2500); return refresh();
      }
      if (kind === "sound") return playSound(name);
      if (kind === "handout") {
        const all = await api.handouts();
        const x = findByName(all.map((y) => ({ ...y, name: y.title })), name);
        return x ? showInFoundry(x) : toast(`No handout called “${name}”`, "Make it on the Handouts page.", "warn", "alert");
      }
    } catch (e) { toastError(e); }
  };

  const refresh = async () => {
    try { inv = await api.foundry_inventory(); } catch { inv = { connected: false, tables: [], actors: [], scenes: [], playlists: [] }; }
    draw();
  };

  const search = h("input.input.sm", { placeholder: "Search…", oninput: (e) => { q = norm(e.target.value); drawList(); } });
  const list = h("div.fl-list");
  const match = (x) => !q || norm(x.name).includes(q) || norm(x.folder).includes(q);
  const drawList = () => {
    if (!inv) return;
    if (tab === "here") {
      const links = sceneLinks();
      return clear(list, links.length ? links.map((l) => h("button.linkrow", { onclick: () => act(l.kind, l.name) },
        icon({ actor: "zap", table: "dice", scene: "map", sound: "play", handout: "scroll2" }[l.kind] || "link"), h("span.grow", l.name), h("span.tiny.faint", l.kind)))
        : h("p.small.faint", { style: { margin: 0 } }, "Links in this scene's plan show here. Write {actor:Goblin}, {table:Wild Magic}, {scene:The Cellar}, {sound:Rain} or {handout:Wanted poster} in the plan."));
    }
    if (tab === "tables") return clear(list, inv.tables.filter(match).slice(0, 80).map((t) => h("div.fl-row", h("span.grow.ellipsis", t.name, t.folder ? h("span.tiny.faint", ` ${t.folder}`) : null),
      btn("Roll", { size: "sm", icon: "dice", onclick: () => rollTable(t) }))));
    if (tab === "actors") {
      const npcs = inv.actors.filter(match).sort((a, b) => (a.type === "npc" ? 0 : 1) - (b.type === "npc" ? 0 : 1) || a.name.localeCompare(b.name));
      return clear(list, npcs.slice(0, 120).map((a) => h("button.linkrow", { onclick: () => statBlock(a) }, icon(a.type === "character" ? "heart" : "zap"),
        h("span.grow.ellipsis", a.name), a.cr != null ? h("span.tiny.faint", `CR ${a.cr}`) : h("span.tiny.faint", a.type))));
    }
    if (tab === "scenes") return clear(list, inv.scenes.filter(match).map((sc) => h("div.fl-row", { class: sc.active ? "on" : "" },
      h("span.grow.ellipsis", sc.name, sc.active ? h("span.chip.good", { style: { marginLeft: "6px" } }, "players") : null, sc.viewed && !sc.active ? h("span.chip", { style: { marginLeft: "6px" } }, "you") : null),
      btn("", { size: "sm", icon: "eye", title: "View it yourself", onclick: async () => { try { await api.foundry_scene(sc.id, "view"); refresh(); } catch (e) { toastError(e); } } }),
      btn("Activate", { size: "sm", title: "Move the players there", onclick: async () => { try { await api.foundry_scene(sc.id, "activate"); refresh(); } catch (e) { toastError(e); } } }))));
    if (tab === "sounds") return clear(list,
      h("div", btn("Stop all", { size: "sm", icon: "stop", onclick: async () => { try { await api.foundry_stop_sounds(); refresh(); } catch (e) { toastError(e); } } })),
      inv.playlists.filter((pl) => match(pl) || pl.sounds.some(match)).map((pl) => h("details.fl-pl", { open: pl.playing || !!q },
        h("summary", h("span.grow", pl.name), btn("", { size: "sm", icon: pl.playing ? "stop" : "play", title: pl.playing ? "Stop" : "Play all",
          onclick: async (e) => { e.preventDefault(); try { await api.foundry_playlist(pl.id, null, pl.playing ? "stop" : "play"); refresh(); } catch (err) { toastError(err); } } })),
        pl.sounds.filter((so) => !q || match(so) || match(pl)).map((so) => h("div.fl-row", { class: so.playing ? "on" : "" }, h("span.grow.ellipsis.small", so.name),
          btn("", { size: "sm", kind: "ghost", icon: so.playing ? "stop" : "play", onclick: async () => { try { await api.foundry_playlist(pl.id, so.id, so.playing ? "stop" : "play"); refresh(); } catch (e) { toastError(e); } } }))))));
  };
  const tabs = h("div.fl-tabs");
  const draw = () => {
    if (!inv.connected) {
      return clear(box, card({ title: "Foundry" }, h("p.small.muted", { style: { margin: 0 } },
        "Connect Foundry to roll its tables, look up monsters and place tokens, switch scenes and play sounds from here. ",
        h("button.linkish", { onclick: () => ctx.go("settings", { section: "foundry" }) }, "Set it up"))));
    }
    clear(tabs, [["here", "This scene"], ["tables", "Tables"], ["actors", "Monsters"], ["scenes", "Scenes"], ["sounds", "Sounds"]].map(([k, l]) =>
      h("button", { class: tab === k ? "on" : "", onclick: () => { tab = k; draw(); } }, l)));
    clear(box, card({ title: "Foundry", actions: btn("", { icon: "refresh", size: "sm", kind: "ghost", title: "Refresh from Foundry",
      onclick: async () => { try { inv = await api.foundry_refresh(); draw(); } catch (e) { toastError(e); } } }) },
      h("div.stack.sm", tabs, tab === "here" ? null : search, list, resultsBox)));
    drawList();
  };
  refresh();
  return { el: box, act, refresh: () => { if (inv) drawList(); } };
}
