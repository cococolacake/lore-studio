// First run (or no campaign open): import from LegendKeeper, start a new campaign, or open a folder.
import { api } from "../api.js";
import { restorePanel } from "../backup.js";
import { h, btn, card, clear, toast, toastError } from "../dom.js";
import { icon } from "../icons.js";
import { pathInput, logView, followTask, examplePath } from "../components.js";

export default {
  id: "welcome", label: "Welcome", icon: "sparkle",

  mount(ctx, params, root) {
    const recent = (ctx.boot.settings.recent_campaigns || []).filter((r) => r.path);
    const body = h("div.stack");
    root.append(ctx.header({ title: "Welcome to Lore Studio", subtitle: "Your campaign lives in a folder of plain files. Pick how to start.", icon: "book" }), body);

    const choices = h("div.grid.c3",
      choice("download", "Import from LegendKeeper", "Bring in your wiki, campaign log and maps from a LegendKeeper JSON export.", () => importFlow(ctx, body)),
      choice("plus", "Start a new campaign", "An empty campaign folder with a landing page to build from.", () => createFlow(ctx, body)),
      choice("folder", "Open a campaign folder", "A folder made by Lore Studio, e.g. one you synced from another PC.", () => openFlow(ctx, body)));
    body.append(choices,
      h("div.row.small.muted", { style: { gap: "8px" } }, icon("dice"), "New to Lore Studio?",
        btn("Try the demo campaign", { size: "sm", kind: "ghost", onclick: () => demoFlow(ctx, body) }),
        h("span", { style: { marginLeft: "12px" } }, "Have a backup?"),
        btn("Restore a backup", { size: "sm", kind: "ghost", icon: "upload", onclick: () => panel(body, "Restore a backup", restorePanel(ctx)) })));

    if (recent.length) {
      body.append(card({ title: "Recent campaigns" }, h("div.list", recent.map((r) =>
        h("div.list-row.click", { onclick: () => openPath(ctx, r.path) },
          h("div.ic.accent", icon("book")),
          h("div.main-col", h("div.title", r.name), h("div.meta.mono", r.path)),
          icon("right"))))));
    }
  },
};

function choice(ic, title, text, onclick) {
  return h("button.card.choice", { onclick, type: "button" },
    h("div.choice-ic", icon(ic)), h("h3", title), h("p.muted.small", text));
}

async function openPath(ctx, path) {
  try {
    await api.open_campaign(path);
    await ctx.refreshBoot();
    ctx.go("home");
  } catch (e) { toastError(e); }
}

function panel(body, title, ...kids) {
  body.querySelector(".flow")?.remove();
  const el = card({ title }, ...kids);
  el.classList.add("flow");
  body.append(el);
  el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  return el;
}

function openFlow(ctx, body) {
  let path = "";
  panel(body, "Open a campaign folder",
    h("div.stack",
      h("div.field", h("label", "Campaign folder"), pathInput("", (v) => { path = v; }, { folder: true, placeholder: "C:/Users/you/Documents/Campaigns/My Campaign" })),
      h("div", btn("Open", { icon: "folder", kind: "primary", onclick: () => path ? openPath(ctx, path) : toast("Choose a folder first", "", "warn", "alert") }))));
}

function demoFlow(ctx, body) {
  let parent = "";
  panel(body, "Try the demo campaign",
    h("div.stack",
      h("p.small.muted", { style: { margin: 0 } }, "A small made-up campaign, The Sunken Crown, with lore pages, a map, session recaps, a transcript, a recap draft and loose threads. Delete the folder whenever you like."),
      h("div.field", h("label", "Where to put it"), pathInput("", (v) => { parent = v; }, { folder: true, placeholder: "C:/Users/you/Documents/Campaigns" })),
      h("div", btn("Create the demo", { icon: "dice", kind: "primary", onclick: async () => {
        if (!parent) return toast("Choose a folder first", "", "warn", "alert");
        try { await api.create_demo(parent); await ctx.refreshBoot(); ctx.go("home"); } catch (e) { toastError(e); }
      } }))));
}

function createFlow(ctx, body) {
  let parent = "", name = "";
  const where = h("div.small.faint.mono");
  const show = () => { where.textContent = parent && name ? `Will create: ${joinPath(parent, name)}` : ""; };
  panel(body, "Start a new campaign",
    h("div.stack",
      h("div.grid.c2",
        h("div.field", h("label", "Campaign name"), h("input.input", { placeholder: "The Sunken Crown", oninput: (e) => { name = e.target.value.trim(); show(); } })),
        h("div.field", h("label", "Where to keep it"), pathInput("", (v) => { parent = v; show(); }, { folder: true, placeholder: "C:/Users/you/Documents/Campaigns" }))),
      where,
      h("div", btn("Create campaign", { icon: "plus", kind: "primary", onclick: async () => {
        if (!parent || !name) return toast("Fill in a name and a folder", "", "warn", "alert");
        try {
          await api.create_campaign(joinPath(parent, safeFolder(name)), name);
          await ctx.refreshBoot();
          ctx.go("home");
        } catch (e) { toastError(e); }
      } }))));
}

function importFlow(ctx, body) {
  let file = "", parent = "", name = "";
  const info = h("div");
  const where = h("div.small.faint.mono");
  const nameIn = h("input.input", { placeholder: "Campaign name", oninput: (e) => { name = e.target.value.trim(); show(); } });
  const show = () => { where.textContent = parent && name ? `Will create: ${joinPath(parent, safeFolder(name))}` : ""; };
  const go = btn("Import", { icon: "download", kind: "primary", disabled: true });
  const log = logView(220);
  log.el.classList.add("hidden");

  async function inspect(p) {
    file = p;
    clear(info);
    if (!p) return;
    try {
      const s = await api.lk_summary(p);
      if (!name) { name = s.suggested_name; nameIn.value = name; show(); }
      clear(info, h("div.row", { style: { gap: "8px" } },
        h("span.chip.accent", `${s.pages} pages`),
        h("span.chip", `${s.sessions} campaign log entries → sessions`),
        h("span.chip", `${s.maps} maps`),
        s.templates.length ? h("span.chip", `${s.templates.length} templates kept aside`) : null));
      go.disabled = false;
    } catch (e) {
      go.disabled = true;
      clear(info, h("div.notice.bad", icon("alert"), h("div", e.message)));
    }
  }

  go.onclick = async () => {
    if (!file || !parent || !name) return toast("Pick the export, a name and a folder", "", "warn", "alert");
    go.disabled = true;
    log.el.classList.remove("hidden");
    try {
      const tid = await api.lk_import(file, joinPath(parent, safeFolder(name)), name);
      followTask(tid, log, async (t) => {
        if (t.status !== "done") { go.disabled = false; return toast("The import didn't finish", "See the log for details.", "bad", "alert"); }
        const r = t.result;
        toast("Import finished", `${r.pages} pages, ${r.sessions} sessions, ${r.secrets} secret blocks`, "good", "circleCheck", 8000);
        await ctx.refreshBoot();
        ctx.go("home");
      });
    } catch (e) { go.disabled = false; toastError(e); }
  };

  panel(body, "Import from LegendKeeper",
    h("div.stack",
      h("p.muted.small", { style: { margin: 0 } }, "In LegendKeeper, open the top-left menu and export the whole project as JSON. Then pick that file here. Nothing in LegendKeeper is changed."),
      h("div.field", h("label", "LegendKeeper export (.json)"), pathInput("", inspect, { kind: "json", placeholder: "C:/Users/you/Downloads/Sunken_Crown.json" })),
      info,
      h("div.grid.c2",
        h("div.field", h("label", "Campaign name"), nameIn),
        h("div.field", h("label", "Where to keep it"), pathInput("", (v) => { parent = v; show(); }, { folder: true, placeholder: "C:/Users/you/Documents/Campaigns" }))),
      where,
      h("div", go),
      log.el));
}

function safeFolder(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim() || "Campaign";
}

function joinPath(parent, child) {
  const sep = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return parent.replace(/[\\/]+$/, "") + sep + child;
}

export { joinPath, safeFolder, examplePath };
