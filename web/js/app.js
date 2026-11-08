// App shell: rail navigation, side panel, header banner, routing, background polling.
import { api } from "./api.js";
import { h, clear, toast, toastError, store } from "./dom.js";
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
import calendar from "./pages/calendar.js";
import clocks from "./pages/clocks.js";
import welcome from "./pages/welcome.js";
import settingsPage from "./pages/settings.js";

const PAGES = [home, live, sessions, lore, maps, calendar, threads, clocks, graph, chat];
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
    const page = ALL.find((p) => p.id === id) || home;
    ctx._stateFns = [];
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

  async refreshBoot() {
    ctx.boot = await api.bootstrap();
    ctx.links = null;
    document.documentElement.dataset.platform = ctx.boot.platform || "windows";
    setNative(ctx.boot.native);
    applyTheme(ctx.boot.settings.theme);
    return ctx.boot;
  },

  async linkNames(force = false) {
    if (!ctx.links || force) ctx.links = await api.link_names();
    return ctx.links;
  },

  async saveSettings(patch) {
    const s = await api.save_settings(patch);
    ctx.boot.settings = s;
    if (patch.theme) applyTheme(s.theme);
    return s;
  },
};
window.ctx = ctx; // handy in the dev tools console

function renderRail() {
  const item = (p) => h("button.rail-btn", { onclick: () => ctx.go(p.id), class: ctx.page?.id === p.id ? "active" : "" },
    icon(p.icon), h("span.tip", p.label));
  const base = ctx.boot?.settings?.theme?.base || "light";
  clear($rail,
    h("div.logo", { title: "Lore Studio" }, logo()),
    h("div.nav", ctx.boot?.campaign ? PAGES.map(item) : null),
    h("div.bottom",
      ctx.state?.tasks?.length ? h("button.rail-btn", { title: ctx.state.tasks[0].title }, icon("refresh", "spin"), h("span.badge-dot"), h("span.tip", ctx.state.tasks[0].title)) : null,
      h("button.rail-btn", {
        onclick: async () => {
          const t = { ...ctx.boot.settings.theme, base: base === "dark" ? "light" : "dark" };
          await ctx.saveSettings({ theme: t });
          renderRail();
        },
      }, icon(base === "dark" ? "sun" : "moon"), h("span.tip", base === "dark" ? "Light mode" : "Dark mode")),
      item(settingsPage)));
}

const toasted = new Set();
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
