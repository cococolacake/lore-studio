// App shell: rail navigation, side panel, header banner, routing, background polling.
import { api } from "./api.js";
import { h, clear, toast, toastError, store, confirmBox } from "./dom.js";
import { icon, logo } from "./icons.js";
import { applyTheme, paintBanner } from "./theme.js";
import { setNative } from "./components.js";

import home from "./pages/home.js";
import sessions from "./pages/sessions.js";
import lore from "./pages/lore.js";
import graph from "./pages/graph.js";
import threads from "./pages/threads.js";
import maps from "./pages/maps.js";
import live from "./pages/live.js";
import chat from "./pages/chat.js";
import monsters from "./pages/monsters.js";
import party from "./pages/party.js";
import { aiOff } from "./ai.js";
import calendar from "./pages/calendar.js";
import clocks from "./pages/clocks.js";
import handouts from "./pages/handouts.js";
import timeline from "./pages/timeline.js";
import boards from "./pages/boards.js";
import welcome from "./pages/welcome.js";
import settingsPage from "./pages/settings.js";

const PAGES = [home, live, sessions, party, lore, maps, calendar, timeline, monsters, boards, threads, clocks, handouts, graph, chat];
const ALL = [...PAGES, settingsPage, welcome];

const $rail = document.getElementById("rail");
const $side = document.getElementById("side");
const $main = document.getElementById("main");

const ctx = {
  boot: null,          // settings, campaign info...
  state: null,         // background jobs (polled)
  page: null,
  params: {},
  links: null,         // [[name, page id]] for auto-linking, cached per campaign
  _stateFns: [],
  _cleanup: [],

  go(id, params = {}, { quiet = false } = {}) {
    if (!ctx.boot?.campaign && id !== "settings") id = "welcome";
    let page = ALL.find((p) => p.id === id) || home;
    if (page === chat && aiOff()) page = home;
    ctx._stateFns = [];
    ctx._guards = [];
    ctx._cleanup.forEach((f) => { try { f(); } catch { /* ignore */ } });
    ctx._cleanup = [];
    ctx.page = page;
    ctx.params = params;
    if (page.id !== "welcome") store.set("page", { id: page.id, params });
    renderRail();
    if (quiet) {
      // Background refresh: build the new page off-screen and swap it in when it's ready, so nothing blinks.
      const top = $main.scrollTop;
      const inner = h("div.main-inner");
      let out;
      try { out = page.mount(ctx, params, inner); } catch (e) { console.error(e); return; }
      Promise.resolve(out).then(() => {
        if (ctx.page !== page || ctx.params !== params) return;     // the user moved on meanwhile
        clear($main, inner);
        $main.scrollTop = top;
      }).catch(toastError);
      return;
    }
    clear($side);
    const inner = h("div.main-inner.page");
    clear($main, inner);
    $main.scrollTop = 0;
    try {
      const out = page.mount(ctx, params, inner);
      if (out instanceof Promise) out.catch(toastError);
    } catch (e) { toastError(e); console.error(e); }
  },

  /** Re-render the current page without blinking or losing the scroll position (for background updates). */
  reload() {
    ctx.go(ctx.page.id, ctx.params, { quiet: true });
  },

  /** Draw the header banner at the top of a page. */
  header({ title, subtitle = "", icon: ic = "sparkle", actions = [] }) {
    const banner = h("header.banner", h("div.art"),
      h("div.sticker", h("div.chip-icon", icon(ic)), h("div", h("h1", title), subtitle ? h("p", subtitle) : null)),
      actions.length ? h("div.banner-actions", actions) : null);
    paintBanner(banner);
    return banner;
  },

  side(...kids) { clear($side, kids); },

  onState(fn) { ctx._stateFns.push(fn); if (ctx.state) fn(ctx.state); },
  onLeave(fn) { ctx._cleanup.push(fn); },

  /** Pages with an editor register () => hasUnsavedEdits, so a refresh can ask before throwing edits away. */
  guard(fn) { (ctx._guards ||= []).push(fn); },
  dirty() { return (ctx._guards || []).some((fn) => { try { return fn(); } catch { return false; } }); },

  /** Redraw the current page from the files on disk (after another app changed them). */
  async refresh() {
    if (ctx.dirty() && !await confirmBox("Refresh and lose your edits?", "You have unsaved changes on this page. Refreshing reloads it from the file on disk.", "Refresh anyway", true)) return false;
    ctx._discard = true;
    try { ctx.reload(); } finally { ctx._discard = false; }
    fileDot = false; renderRail();
    return true;
  },

  async refreshBoot() {
    ctx.boot = await api.bootstrap();
    ctx.links = null;
    document.documentElement.dataset.platform = ctx.boot.platform || "windows";
    setNative(ctx.boot.native);
    applyTheme(ctx.boot.settings.theme);
    syncTitlebar();
    return ctx.boot;
  },

  async linkNames(force = false) {
    if (!ctx.links || force) ctx.links = await api.link_names();
    return ctx.links;
  },

  async saveSettings(patch) {
    const s = await api.save_settings(patch);
    ctx.boot.settings = s;
    if (patch.theme) { applyTheme(s.theme); syncTitlebar(); }
    return s;
  },
};
window.ctx = ctx; // handy in the dev tools console

// In the app window on Windows, tint the title bar to match the theme's background.
function syncTitlebar() {
  if (!ctx.boot?.native) return;
  const cs = getComputedStyle(document.documentElement);
  const bg = cs.getPropertyValue("--bg").trim(), text = cs.getPropertyValue("--text").trim();
  api.set_titlebar(bg, text, document.documentElement.dataset.base === "dark").catch(() => { /* not Windows */ });
}

// The rail: Play, World and Tools, each a labelled group. On short windows the list scrolls.
const GROUPS = [
  ["Play", [home, live, sessions, party]],
  ["World", [lore, maps, calendar, timeline]],
  ["Tools", [monsters, boards, threads, clocks, handouts, graph, chat]],
];

function renderRail() {
  const item = (p) => h("button.rail-btn", { onclick: () => ctx.go(p.id), class: ctx.page?.id === p.id ? "active" : "", "aria-label": p.label },
    icon(p.icon), h("span.lbl", p.label), h("span.tip", p.label));
  const base = ctx.boot?.settings?.theme?.base || "light";
  const nav = ctx.boot?.campaign ? GROUPS.map(([name, pages]) => [
    h("div.rail-div"),
    h("div.rail-group", { role: "group", "aria-label": name }, h("span.rail-glbl", name), pages.filter((p) => !(p === chat && aiOff())).map(item)),
  ]) : null;
  clear($rail,
    h("div.logo", { title: "Lore Studio" }, logo()),
    h("div.nav", nav),
    h("div.bottom",
      h("div.rail-div"),
      ctx.state?.tasks?.length ? h("button.rail-btn", { title: ctx.state.tasks[0].title, "aria-label": ctx.state.tasks[0].title }, icon("refresh", "spin"), h("span.badge-dot"), h("span.lbl", "Working"), h("span.tip", ctx.state.tasks[0].title)) : null,
      ctx.boot?.campaign ? h("button.rail-btn", { onclick: () => ctx.refresh(), "aria-label": "Refresh" }, icon("refresh"), fileDot ? h("span.badge-dot") : null, h("span.lbl", "Refresh"),
        h("span.tip", fileDot ? "Files changed outside Lore Studio: refresh" : "Refresh from the files on disk")) : null,
      h("button.rail-btn", {
        "aria-label": base === "dark" ? "Light mode" : "Dark mode",
        onclick: async () => {
          const t = { ...ctx.boot.settings.theme, base: base === "dark" ? "light" : "dark" };
          await ctx.saveSettings({ theme: t });
          renderRail();
        },
      }, icon(base === "dark" ? "sun" : "moon"), h("span.lbl", base === "dark" ? "Light" : "Dark"), h("span.tip", base === "dark" ? "Light mode" : "Dark mode")),
      item(settingsPage)));
  // keep the open page's button in view when the rail scrolls
  $rail.querySelector(".nav .rail-btn.active")?.scrollIntoView({ block: "center" });
}

const toasted = new Set();
let fileSeq = null, fileDot = false;

// Something other than Lore Studio (the Claude app, an editor) changed campaign files: say what, and offer to refresh.
function filesChanged(f) {
  if (!f) return;
  if (fileSeq === null || f.seq < fileSeq) { fileSeq = f.seq; return; }      // first look, or a different campaign
  const evs = f.events.filter((e) => e.seq > fileSeq);
  fileSeq = f.seq;
  if (!evs.length) return;
  const here = evs.some((e) => (e.kind === "page" && ctx.page?.id === "lore" && ctx.params?.id === e.id)
    || (e.kind === "session" && ctx.page?.id === "sessions" && ctx.params?.id === e.id));
  const word = { changed: "edited", added: "added", removed: "deleted" };
  const one = evs.length === 1 ? evs[0] : null;
  const title = one ? `${one.title} was ${word[one.change]}` : `${evs.length} files changed`;
  const t = toast(title, here ? "This page changed outside Lore Studio." : "Changed outside Lore Studio.", "info", "refresh", here ? 0 : 15000);
  const box = t.querySelector(":scope > div:nth-child(2)");
  if (!one) box.append(h("ul.small", { style: { margin: "4px 0 0", paddingLeft: "16px" } },
    evs.slice(0, 5).map((e) => h("li", e.title, h("span.faint", ` (${word[e.change]})`))), evs.length > 5 ? h("li.faint", `and ${evs.length - 5} more`) : null));
  const open = one && one.change !== "removed" && (one.kind === "page" || one.kind === "session") && !here
    ? h("button.btn.sm.ghost", { onclick: () => { t.remove(); one.kind === "page" ? ctx.go("lore", { id: one.id }) : ctx.go("sessions", { id: one.id, tab: { plan: "notes", recap: "recap", draft: "recap", transcript: "transcript" }[one.file] }); } }, "Open") : null;
  box.append(h("div.row", { style: { gap: "6px", marginTop: "6px" } },
    h("button.btn.sm" + (here ? ".primary" : ".ghost"), { onclick: async () => { if (await ctx.refresh()) t.remove(); } }, "Refresh"), open));
  fileDot = true;
  renderRail();
}

async function poll() {
  try {
    const st = await api.state();
    const had = ctx.state?.tasks?.length || 0;
    ctx.state = st;
    if (had !== st.tasks.length) renderRail();
    for (const j of st.recent || []) {
      if (toasted.has(j.id) || !j.kind) continue;
      toasted.add(j.id);
      const ok = j.status === "done";
      const title = j.kind === "transcribe" ? (ok ? "Transcript ready" : "Transcription failed") : j.kind === "recap" ? (ok ? "Recap draft ready" : "Recap draft failed") : (ok ? "Done" : "Failed");
      const t = toast(title, ok ? j.title : (j.last || j.title), ok ? "good" : "bad", ok ? "circleCheck" : "alert", 12000);
      if (j.session) t.querySelector(":scope > div:nth-child(2)").append(h("div", { style: { marginTop: "6px" } },
        h("button.btn.sm.ghost", { onclick: () => { t.remove(); ctx.go("sessions", { id: j.session, tab: j.kind === "recap" ? "recap" : "transcript" }); } }, "Open session")));
    }
    filesChanged(st.files);
    ctx._stateFns.forEach((fn) => { try { fn(st); } catch (e) { console.error(e); } });
  } catch (e) { console.warn("poll failed", e); }
  setTimeout(poll, ctx.state?.tasks?.length ? 1000 : 3000);
}

// Wiki links anywhere in the app open the page they point at.
document.addEventListener("click", async (e) => {
  const a = e.target.closest("a.wl");
  if (!a) return;
  e.preventDefault();
  if (a.dataset.id) return ctx.go("lore", { id: a.dataset.id });
  const names = await ctx.linkNames();
  const want = (a.dataset.wl || "").toLowerCase();
  const hit = names.find(([n]) => n.toLowerCase() === want);
  if (hit) ctx.go("lore", { id: hit[1] });
  else toast("No page with that name yet", a.dataset.wl, "", "book");
});

async function start() {
  try {
    await ctx.refreshBoot();
  } catch (e) {
    clear($main, h("div.main-inner", h("div.card", h("h3", "Couldn't reach the backend"), h("p.muted", String(e)))));
    return;
  }
  ctx.state = await api.state().catch(() => null);
  const last = store.get("page");
  if (!ctx.boot.campaign) ctx.go("welcome");
  else ctx.go(last?.id || "home", last?.params || {});
  poll();
}

start();
