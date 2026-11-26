// Live mode's Foundry panel: roll tables, monsters (stat blocks, tokens), scenes and sounds, one click each.
// Works through the Lore Studio Bridge module, so the GM's Foundry does the actual rolling and placing.
import { api } from "./api.js";
import { h, btn, card, clear, toast, toastError, modal } from "./dom.js";
import { icon } from "./icons.js";
import { switchEl, rangeEl } from "./components.js";
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
    const toggle = (pl, so) => api.foundry_playlist(pl.id, so ? so.id : null, (so || pl).playing ? "stop" : "play").then(apply);
    for (const pl of inv.playlists) {
      if (norm(pl.name) === norm(name)) return toggle(pl);
      const so = findByName(pl.sounds, name);
      if (so && norm(so.name).includes(norm(name))) return toggle(pl, so);
    }
    const pl = findByName(inv.playlists, name);
    if (pl) return toggle(pl);
    toast(`No sound called “${name}” in Foundry`, "", "warn", "alert");
  };

  // ---- music ---------------------------------------------------------------------------------------------------
  // Sound actions answer with the playlists as they are now (older bridge modules answer true: ask Foundry instead).
  let musicKey = "";
  const apply = async (r) => {
    if (r && Array.isArray(r.playlists)) inv.playlists = r.playlists;
    else { try { inv = await api.foundry_refresh(); } catch {} }
    musicKey = JSON.stringify(inv.playlists);
    drawMusic(); drawList();
  };
  const run = (fn) => async (e) => { e?.preventDefault?.(); e?.stopPropagation?.(); try { await apply(await fn()); } catch (err) { toastError(err); } };
  const MODES = [[0, "In order"], [1, "Shuffle"], [-1, "Soundboard"], [2, "All at once"]];
  const openPl = new Set();   // playlists you opened in the list stay open while it redraws

  // previews play in Lore Studio's own window when Foundry's file can be reached, else in your Foundry tab only
  const previewAudio = new Audio();
  previewAudio.preload = "auto";
  let previewing = null;   // { pl, so, where: "here" | "foundry" }
  const sliderToGain = (v) => Math.pow(Math.max(0, Math.min(1, v)), 1.5);
  const stopPreview = async () => {
    const was = previewing;
    previewing = null;
    previewAudio.pause();
    previewAudio.removeAttribute("src");
    if (was?.where === "foundry") { try { await api.foundry_preview_sound(null, null, null, true); } catch {} }
    drawMusic(); drawList();
  };
  const previewInFoundry = async (pl, so) => {
    try {
      await api.foundry_preview_sound(pl.id, so.id, so.volume);
      previewing = { pl, so, where: "foundry" };
      toast("Previewing in your Foundry tab", "Only you hear it there. The players don't.", "info", "headphones", 3500);
    } catch (e) { previewing = null; toastError(e); }
    drawMusic(); drawList();
  };
  const preview = async (pl, so) => {
    if (previewing?.so.id === so.id) return stopPreview();
    await stopPreview();
    if (!so.path) return toast("That track has no file", "Pick its file in Foundry's playlist first.", "warn", "alert");
    let origin = "";
    try { origin = (await api.foundry_status()).origin || ""; } catch {}
    let url = "";
    try { url = /^(https?:|blob:|data:)/.test(so.path) ? so.path : origin ? new URL(so.path.replace(/^\//, ""), origin + "/").href : ""; } catch {}
    if (!url) return previewInFoundry(pl, so);
    previewing = { pl, so, where: "here" };
    previewAudio.src = url;
    previewAudio.volume = sliderToGain(so.volume ?? 0.5);
    try { await previewAudio.play(); }
    catch (e) { if (previewing?.so.id === so.id) return previewInFoundry(pl, so); }
    drawMusic(); drawList();
  };
  previewAudio.addEventListener("ended", () => { if (previewing?.where === "here") stopPreview(); });
  previewAudio.addEventListener("error", () => { if (previewing?.where === "here" && previewAudio.getAttribute("src")) previewInFoundry(previewing.pl, previewing.so); });

  const fmt = (t) => (Number.isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}` : "–:––");
  const previewBar = () => {
    if (!previewing) return null;
    const { so, where } = previewing;
    const kids = [icon("headphones"), h("div.grow.ellipsis.small", { title: where === "foundry" ? "Previewing in your Foundry tab (only you hear it)." : "Playing in Lore Studio. Only you hear it." },
      h("b", "Preview "), so.name, h("span.tiny.faint", where === "foundry" ? "  in Foundry, just you" : "  just you"))];
    if (where === "here") {
      const time = h("span.tiny.faint.mono", `${fmt(previewAudio.currentTime)} / ${fmt(previewAudio.duration)}`);
      const seek = rangeEl(0, 0, 1, 0.001, (v) => { if (Number.isFinite(previewAudio.duration)) previewAudio.currentTime = v * previewAudio.duration; });
      seek.classList.add("fl-seek");
      const tick = () => {
        if (!seek.isConnected) return previewAudio.removeEventListener("timeupdate", tick);
        const d = previewAudio.duration;
        if (Number.isFinite(d) && d > 0 && !seek.matches(":active")) { seek.value = previewAudio.currentTime / d; seek.style.setProperty("--fill", `${(previewAudio.currentTime / d) * 100}%`); }
        time.textContent = `${fmt(previewAudio.currentTime)} / ${fmt(d)}`;
      };
      previewAudio.addEventListener("timeupdate", tick);
      previewAudio.addEventListener("loadedmetadata", tick, { once: true });
      kids.push(btn("", { size: "sm", kind: "ghost", icon: previewAudio.paused ? "play" : "pause", title: previewAudio.paused ? "Resume the preview" : "Pause the preview",
        onclick: () => { if (previewAudio.paused) previewAudio.play().catch(() => {}); else previewAudio.pause(); drawMusic(); } }));
      return h("div.fl-preview", h("div.fl-np-row", ...kids, btn("", { size: "sm", kind: "ghost", icon: "x", title: "Stop the preview", onclick: stopPreview })),
        h("div.fl-np-row", seek, time));
    }
    return h("div.fl-preview", h("div.fl-np-row", ...kids, btn("", { size: "sm", kind: "ghost", icon: "x", title: "Stop the preview", onclick: stopPreview })));
  };

  // what the players hear: one row per playlist that's playing (or has a paused track)
  const nowPlaying = h("div.fl-np");
  const drawMusic = () => {
    if (!inv?.connected) return clear(nowPlaying);
    const active = (inv.playlists || []).filter((pl) => pl.playing || pl.sounds.some((so) => so.playing || so.paused));
    const rows = active.map((pl) => {
      const playing = pl.sounds.filter((so) => so.playing);
      const paused = !playing.length ? pl.sounds.filter((so) => so.paused) : [];
      const tracks = playing.length ? playing : paused;
      const main = tracks[0];
      return h("div.fl-np-item", { class: paused.length ? "paused" : "" },
        h("div.fl-np-row",
          icon(paused.length ? "pause" : "volume"),
          h("div.grow.ellipsis", { title: tracks.map((t) => t.name).join(", ") || pl.name },
            h("span.small", h("b", tracks.length ? tracks.map((t) => t.name).join(" + ") : "Starting…")), h("span.tiny.faint", `  ${pl.name}${paused.length ? ", paused" : ""}`)),
          btn("", { size: "sm", kind: "ghost", icon: "prev", title: "Previous track", onclick: run(() => api.foundry_playlist_step(pl.id, -1)) }),
          main ? btn("", { size: "sm", kind: "ghost", icon: playing.length ? "pause" : "play", title: playing.length ? "Pause" : "Resume",
            onclick: run(() => api.foundry_playlist(pl.id, main.id, playing.length ? "pause" : "play")) }) : null,
          btn("", { size: "sm", kind: "ghost", icon: "next", title: "Next track", onclick: run(() => api.foundry_playlist_step(pl.id, 1)) }),
          btn("", { size: "sm", kind: "ghost", icon: "stop", title: "Stop this playlist", onclick: run(() => api.foundry_playlist(pl.id, null, "stop")) })),
        main ? h("div.fl-np-row.fl-vol", h("span.tiny.faint", "Volume"), volumeSlider(pl, main)) : null);
    });
    clear(nowPlaying, rows.length ? h("div.fl-np-head", h("span.tiny.faint.grow", "Playing for everyone"),
      btn("Stop all", { size: "sm", kind: "ghost", icon: "stop", onclick: run(() => api.foundry_stop_sounds()) })) : null, ...rows, previewBar());
  };
  const volumeSlider = (pl, so) => {
    const r = rangeEl(so.volume ?? 0.5, 0, 1, 0.01, (v) => { if (previewing?.so.id === so.id && previewing.where === "here") previewAudio.volume = sliderToGain(v); });
    r.title = "Volume for everyone";
    r.addEventListener("change", run(() => api.foundry_sound_volume(pl.id, so.id, Number(r.value))));
    return r;
  };

  // keep "now playing" current while tracks end and Foundry moves on by itself (the list is cached in Lore Studio)
  let seen = false;
  const poll = setInterval(async () => {
    if (!box.isConnected) { if (seen) { clearInterval(poll); previewAudio.pause(); } return; }
    seen = true;
    if (!inv?.connected || document.querySelector(".fl-np input[type=range]:active, .fl-list input[type=range]:active")) return;
    try {
      const next = await api.foundry_inventory();
      const key = JSON.stringify(next.playlists);
      if (next.connected && key !== musicKey) { inv.playlists = next.playlists; musicKey = key; drawMusic(); if (tab === "sounds") drawList(); }
    } catch {}
  }, 3000);

  /** Run a {kind:name} link from the plan. */
  const act = async (kind, name) => {
    if (!inv?.connected) return toast("Foundry isn't connected", "Open your world as GM with Lore Studio Bridge on.", "warn", "dice", 6000);
    try {
      if (kind === "actor") { const a = findByName(inv.actors, name); return a ? statBlock(a) : toast(`No actor called “${name}” in Foundry`, "", "warn", "alert"); }
      if (kind === "table") { const t = findByName(inv.tables, name); return t ? rollTable(t) : toast(`No roll table called “${name}” in Foundry`, "", "warn", "alert"); }
      if (kind === "scene") {
        const sc = findByName(inv.scenes, name);
        if (!sc) return toast(`No scene called “${name}” in Foundry`, "", "warn", "alert");
        await (sc.scenery ? api.foundry_scenery(sc.id) : api.foundry_scene(sc.id, "activate"));
        toast(`Players moved to ${sc.name}`, "", "good", "check", 2500); return refresh();
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
    musicKey = JSON.stringify(inv.playlists);
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
        : h("p.small.faint", { style: { margin: 0 } }, "No links in this scene's plan. Add them like {actor:Goblin}, {table:Wild Magic}, {scene:The Cellar}, {sound:Rain} or {handout:Wanted poster}."));
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
      btn("Activate", { size: "sm", title: sc.scenery ? "Move the players there, crossfading into it" : "Move the players there",
        onclick: async () => { try { await (sc.scenery ? api.foundry_scenery(sc.id) : api.foundry_scene(sc.id, "activate")); refresh(); } catch (e) { toastError(e); } } }))));
    if (tab === "sounds") {
      const pls = inv.playlists.filter((pl) => match(pl) || pl.sounds.some(match));
      if (!pls.length) return clear(list, h("p.small.faint", { style: { margin: 0 } }, q ? "No playlist or track matches that." : "Your Foundry world has no playlists yet."));
      return clear(list, pls.map((pl) => {
        const d = h("details.fl-pl", { open: openPl.has(pl.id) || pl.playing || !!q, ontoggle: (e) => { if (e.target.open) openPl.add(pl.id); else openPl.delete(pl.id); } },
          h("summary", h("span.grow.ellipsis", pl.name),
            h("select.input.sm.fl-mode", { title: "How this playlist plays", onclick: (e) => e.stopPropagation(),
              onchange: (e) => run(() => api.foundry_playlist_mode(pl.id, Number(e.target.value)))() },
              MODES.map(([v, l]) => h("option", { value: v, selected: Number(pl.mode ?? 0) === v }, l))),
            btn("", { size: "sm", icon: pl.playing ? "stop" : "play", title: pl.playing ? "Stop" : "Play all",
              onclick: run(() => api.foundry_playlist(pl.id, null, pl.playing ? "stop" : "play")) })),
          pl.sounds.filter((so) => !q || match(so) || match(pl)).map((so) => {
            const prev = previewing?.so.id === so.id;
            return h("div.fl-row", { class: so.playing ? "on" : so.paused ? "paused" : "" },
              h("span.grow.ellipsis.small", so.name, so.paused ? h("span.tiny.faint", "  paused") : null),
              btn("", { size: "sm", kind: prev ? "" : "ghost", icon: prev ? "x" : "headphones", title: prev ? "Stop the preview" : "Preview it (only you hear it)", onclick: () => preview(pl, so) }),
              btn("", { size: "sm", kind: "ghost", icon: so.playing ? "stop" : "play", title: so.playing ? "Stop" : so.paused ? "Resume for everyone" : "Play for everyone",
                onclick: run(() => { if (prev) stopPreview(); return api.foundry_playlist(pl.id, so.id, so.playing ? "stop" : "play"); }) }));
          }));
        return d;
      }));
    }
  };
  const tabs = h("div.fl-tabs");
  const draw = () => {
    if (!inv.connected) {
      return clear(box, card({ title: "Foundry" }, h("p.small.muted", { style: { margin: 0 } },
        "Foundry isn't connected. ",
        h("button.linkish", { onclick: () => ctx.go("settings", { section: "foundry" }) }, "Set it up"))));
    }
    clear(tabs, [["here", "This scene"], ["tables", "Tables"], ["actors", "Monsters"], ["scenes", "Scenes"], ["sounds", "Sounds"]].map(([k, l]) =>
      h("button", { class: tab === k ? "on" : "", onclick: () => { tab = k; draw(); } }, l)));
    clear(box, card({ title: "Foundry", actions: btn("", { icon: "refresh", size: "sm", kind: "ghost", title: "Refresh from Foundry",
      onclick: async () => { try { inv = await api.foundry_refresh(); musicKey = JSON.stringify(inv.playlists); draw(); } catch (e) { toastError(e); } } }) },
      h("div.stack.sm", tabs, nowPlaying, tab === "here" ? null : search, list, resultsBox)));
    drawMusic();
    drawList();
  };
  refresh();
  return { el: box, act, refresh: () => { if (inv) drawList(); } };
}
