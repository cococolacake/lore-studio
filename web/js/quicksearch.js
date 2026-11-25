// Quick search (Ctrl+K / Cmd+K): jump to any page, session, thread, monster, or part of the app from anywhere.
import { api } from "./api.js";
import { h, clear } from "./dom.js";
import { icon } from "./icons.js";

const SETTINGS = [["campaign", "Campaign settings"], ["claude", "AI settings"], ["transcription", "Transcription settings"], ["obs", "OBS settings"],
  ["foundry", "Foundry settings"], ["discord", "Discord settings"], ["appearance", "Appearance and themes"], ["reading", "Reading settings"],
  ["playersite", "Player lore book"], ["about", "About and updates"]];

let open = false;

/** A search snippet as plain text: [[Page|label]] -> label, no ::: block markers, **bold** or {t:…} stamps. */
const plain = (s) => String(s || "")
  .replace(/^(…?)[^\[\]]*?\|([^\[\]]*)\]\]/, "$1$2").replace(/^(…?)([^\[\]]*?)\]\]/, "$1$2").replace(/\[\[[^\]]*$/, "…")
  .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2").replace(/\[\[([^\]]+)\]\]/g, "$1")
  .replace(/:::\s*\w*/g, " ").replace(/\{t:[^}]*\}/g, "").replace(/[*_#>`]/g, "").replace(/\s+/g, " ").trim();

export function quickSearch(ctx, pages) {
  if (open || !ctx.boot?.campaign) return;
  open = true;
  const input = h("input.qs-input", { placeholder: "Jump to a page, session, thread, monster…", autocomplete: "off", spellcheck: false });
  const list = h("div.qs-list");
  const scrim = h("div.qs-scrim", { onmousedown: (e) => { if (e.target === scrim) close(); } },
    h("div.qs-box", { role: "dialog", "aria-label": "Quick search" },
      h("div.qs-head", icon("search"), input, h("kbd", "Esc")), list,
      h("div.qs-foot.tiny.faint", h("span", h("kbd", "↑"), h("kbd", "↓"), " to move"), h("span", h("kbd", "Enter"), " to open"), h("span", "#tag finds tagged pages"))));
  document.body.append(scrim);
  setTimeout(() => input.focus(), 10);

  let items = [], sel = 0, seq = 0, extra = null;
  // threads and monsters are fetched once per open; pages and sessions are searched as you type
  Promise.all([api.threads().catch(() => []), api.monsters().catch(() => [])]).then(([threads, monsters]) => { extra = { threads, monsters }; run(); });

  const appItems = () => [
    ...pages.filter((p) => p.label).map((p) => ({ kind: "Go to", title: p.label, icon: p.icon || "right", go: () => ctx.go(p.id) })),
    ...SETTINGS.map(([id, label]) => ({ kind: "Settings", title: label, icon: "gear", go: () => ctx.go("settings", { section: id }) })),
  ];

  async function run() {
    const q = input.value.trim();
    const my = ++seq;
    const low = q.toLowerCase();
    const found = [];
    if (q) {
      const hits = await api.search(q).catch(() => []);
      if (my !== seq) return;
      for (const x of hits.slice(0, 12)) {
        found.push(x.kind === "session"
          ? { kind: "Session", title: x.title, sub: plain(x.snippet), icon: "scroll", go: () => ctx.go("sessions", { id: x.id }) }
          : { kind: "Page", title: x.title, sub: plain(x.snippet) || (x.tags || []).map((t) => "#" + t).join(" "), icon: "book", go: () => ctx.go("lore", { id: x.id }) });
      }
      if (extra && !q.startsWith("#")) {
        for (const t of extra.threads.filter((t) => t.title.toLowerCase().includes(low) && t.status !== "dismissed").slice(0, 5))
          found.push({ kind: "Thread", title: t.title, sub: t.status === "resolved" ? "Resolved" : t.detail, icon: "link", go: () => ctx.go("threads", t.status === "resolved" ? { view: "resolved" } : {}) });
        for (const m of extra.monsters.filter((m) => m.name.toLowerCase().includes(low)).slice(0, 5))
          found.push({ kind: "Monster", title: m.name, sub: `CR ${m.cr_label}${m.type ? " · " + m.type : ""}`, icon: "claw", go: () => ctx.go("monsters", { id: m.id }) });
      }
      for (const a of appItems().filter((a) => a.title.toLowerCase().includes(low))) found.push(a);
    } else {
      found.push(...appItems().slice(0, 10));
    }
    items = found.slice(0, 24);
    sel = 0;
    draw();
  }

  function draw() {
    clear(list, items.length ? items.map((it, i) => h("button.qs-item", { class: i === sel ? "on" : "", onmousemove: () => { if (sel !== i) { sel = i; mark(); } }, onclick: () => choose(i) },
      icon(it.icon), h("span.qs-text", h("span.qs-title", it.title), it.sub ? h("span.qs-sub", it.sub) : null), h("span.qs-kind", it.kind)))
      : h("div.qs-empty.small.faint", input.value.trim() ? "Nothing matches that." : ""));
  }
  const mark = () => list.querySelectorAll(".qs-item").forEach((el, i) => el.classList.toggle("on", i === sel));

  function choose(i) {
    const it = items[i];
    if (!it) return;
    close();
    it.go();
  }
  function close() {
    open = false;
    scrim.remove();
    document.removeEventListener("keydown", keys, true);
  }
  function keys(e) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); mark(); list.children[sel]?.scrollIntoView({ block: "nearest" }); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); list.children[sel]?.scrollIntoView({ block: "nearest" }); }
    else if (e.key === "Enter") { e.preventDefault(); choose(sel); }
  }
  document.addEventListener("keydown", keys, true);
  input.addEventListener("input", () => { clearTimeout(input._t); input._t = setTimeout(run, 120); });
  run();
}

/** Ctrl+K (Cmd+K on a Mac) opens quick search anywhere. */
export function installQuickSearch(ctx, pages) {
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      quickSearch(ctx, pages);
    }
  });
}
