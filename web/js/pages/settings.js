// Settings: campaign, appearance (theme engine), reading, about.
import { api } from "../api.js";
import { h, btn, card, toast, toastError, promptBox, confirmBox, clear, modal } from "../dom.js";
import { icon } from "../icons.js";
import { seg, switchEl, rangeEl, pathInput, logView, followTask } from "../components.js";
import { ACCENTS, PATTERNS, patternCSS, accentColors, headerCSS, applyTheme } from "../theme.js";

const SECTIONS = [["campaign", "Campaign", "book"], ["claude", "AI", "feather"], ["transcription", "Transcription", "file"],
  ["obs", "OBS", "play"], ["foundry", "Foundry", "dice"], ["discord", "Discord", "share"], ["playersite", "Player lore book", "globe"], ["appearance", "Appearance", "palette"], ["reading", "Reading", "eye"], ["about", "About", "info"]];

export default {
  id: "settings", label: "Settings", icon: "gear",

  mount(ctx, params, root) {
    const section = params.section || (ctx.boot.campaign ? "campaign" : "appearance");
    ctx.side(h("h2", "Settings"), SECTIONS.map(([id, label, ic]) =>
      h("button.side-item", { class: id === section ? "active" : "", onclick: () => ctx.go("settings", { section: id }) }, icon(ic), h("span", label))));
    const fn = ({ campaign, claude, transcription, obs, foundry, discord, playersite, appearance, reading, about })[section] || campaign;
    const out = fn(ctx, root);
    if (out instanceof Promise) out.catch(toastError);
  },
};

// ---------------------------------------------------------------------------
function campaign(ctx, root) {
  const c = ctx.boot.campaign;
  root.append(ctx.header({ title: "Campaign", subtitle: c ? c.path : "No campaign is open.", icon: "book" }));
  if (!c) {
    root.append(card(null, h("p.muted", "Open or create a campaign first."), btn("Go to the welcome screen", { kind: "primary", onclick: () => ctx.go("welcome") })));
    return;
  }
  const recent = (ctx.boot.settings.recent_campaigns || []).filter((r) => r.path && r.path !== c.path);
  // banners still pointing at LegendKeeper: offer to save them into the campaign
  const bannerBox = h("div");
  api.banner_status().then(({ remote }) => {
    if (!remote) return;
    bannerBox.append(card({ title: "Header images" }, h("div.stack.sm",
      h("p.small.muted", { style: { margin: 0 } }, `${remote} page header image${remote === 1 ? " is" : "s are"} still a link to LegendKeeper. Save ${remote === 1 ? "it" : "them"} into the campaign folder so ${remote === 1 ? "it keeps" : "they keep"} working offline and if LegendKeeper removes ${remote === 1 ? "it" : "them"}.`),
      h("div", btn("Save them now", { icon: "download", size: "sm", onclick: async (e) => {
        e.currentTarget.disabled = true;
        try { await api.download_banners(); toast("Saving header images", "This runs in the background.", "", "download", 4000); } catch (err) { toastError(err); }
      } })))));
  }).catch(() => {});
  root.append(bannerBox);
  root.append(h("div.stack",
    card({ title: "This campaign" }, h("div.stack",
      h("div.grid.c2",
        h("div.field", h("label", "Name"), h("input.input", { value: c.name, onchange: async (e) => {
          try { ctx.boot.campaign = await api.rename_campaign(e.target.value.trim() || c.name); toast("Renamed", ctx.boot.campaign.name, "good", "check", 1500); } catch (err) { toastError(err); }
        } })),
        h("div.field", h("label", "Folder"), h("div.input-wrap", h("input.input.mono", { value: c.path, readOnly: true }),
          btn("", { icon: "folder", title: "Open the folder", onclick: () => api.open_folder().catch(toastError) })))),
      c.info.imported_from === "legendkeeper" ? h("div.notice.small", icon("info"), h("div", `Imported from LegendKeeper (export of ${String(c.info.legendkeeper_export || "").slice(0, 10)}). LegendKeeper itself was not changed.`)) : null,
      h("p.small.faint", { style: { margin: 0 } }, "Everything is plain files: Markdown pages in lore/, one folder per session in sessions/. Back it up or sync it like any folder."))),
    partyCard(ctx),
    checklistSettingsCard(ctx),
    spellingsCard(ctx),
    card({ title: "Switch campaign" }, h("div.stack.sm",
      recent.length ? h("div.list", recent.map((r) => h("div.list-row.click", { onclick: async () => {
        try { await api.open_campaign(r.path); await ctx.refreshBoot(); ctx.go("home"); } catch (e) { toastError(e); }
      } }, h("div.ic", icon("book")), h("div.main-col", h("div.title", r.name), h("div.meta.mono", r.path)), icon("right")))) : null,
      h("div", btn("Open, create or import another campaign", { icon: "plus", onclick: () => ctx.go("welcome", { force: true }) }))))));
}

/** Settings → Campaign: switch the before-session checklist on, and edit the reminders every session gets. */
function checklistSettingsCard(ctx) {
  const on = !!ctx.boot.settings.checklist_on;
  const listBox = h("div.stack.sm");
  const draw = (items) => {
    listBox.replaceChildren(
      ...items.map((it, n) => h("div.row.cl-edit",
        h("input.input.grow", { value: it.text, onchange: (e) => api.checklist_edit(it.id, e.target.value).then((r) => draw(r.items)).catch(toastError) }),
        btn("", { icon: "up", size: "sm", kind: "ghost", title: "Move up", disabled: n === 0, onclick: () => api.checklist_move(it.id, -1).then((r) => draw(r.items)).catch(toastError) }),
        btn("", { icon: "down", size: "sm", kind: "ghost", title: "Move down", disabled: n === items.length - 1, onclick: () => api.checklist_move(it.id, 1).then((r) => draw(r.items)).catch(toastError) }),
        btn("", { icon: "trash", size: "sm", kind: "ghost", title: "Remove", onclick: () => api.checklist_remove(null, it.id).then((r) => draw(r.items)).catch(toastError) }))),
      (() => {
        const inp = h("input.input.grow", { placeholder: "Add a reminder for every session…", onkeydown: (e) => { if (e.key === "Enter") add(); } });
        const add = () => inp.value.trim() && api.checklist_add(null, inp.value, true).then((r) => draw(r.items)).catch(toastError);
        return h("div.row", inp, btn("Add", { icon: "plus", size: "sm", onclick: add }));
      })());
  };
  if (on) api.checklist_template().then((r) => draw(r.items)).catch(toastError);
  return card({ title: "Before-session checklist" }, h("div.stack.sm",
    switchEl(on, async (v) => {
      try {
        if (v) await api.checklist_start();
        await ctx.saveSettings({ checklist_on: v });
        ctx.go("settings", { section: "campaign" });
      } catch (e) { toastError(e); }
    }, "Show a checklist before each session"),
    h("p.small.muted", { style: { margin: 0 } }, on
      ? "These reminders appear on every upcoming session's Plan tab and on Home, and Live mode reminds you of anything unticked. Ticks are kept per session. For a one-off reminder, add it on that session's Plan tab."
      : "Reminders you tick off before each session, like starting the recording or loading the first scene. They show on the Plan tab and Home, and Live mode reminds you of anything left."),
    on ? listBox : null));
}

// ---------------------------------------------------------------------------
function appearance(ctx, root) {
  let theme = structuredClone(ctx.boot.settings.theme);
  let themes = ctx.boot.themes;
  let saveTimer = null;
  const headSlot = h("div");
  root.append(headSlot);

  const commit = (redraw = true) => {
    applyTheme(theme);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => ctx.saveSettings({ theme }).catch(toastError), 350);
    if (redraw) draw();
  };

  const body = h("div.stack");
  root.append(body);

  function themePreview(t) {
    const css = headerCSS(t) || { background: "var(--surface-3)" };
    const accent = (ACCENTS.find((a) => a[0] === t.accent) || ACCENTS[0])[2];
    const dark = t.base === "dark";
    return h("div.tp", { style: css },
      h("div.mini", { style: { background: dark ? "#19191C" : "#fff" } }, h("i", { style: { background: accent } }), h("b", { style: { background: dark ? "#fff" : "#17171A" } })));
  }

  function draw() {
    clear(headSlot, ctx.header({ title: "Appearance", subtitle: "Changes apply instantly. The header above is a live preview.", icon: "palette",
      actions: [btn("Save as theme", { icon: "save", onclick: async () => {
        const name = await promptBox("Save theme", "Theme name", theme.name && !themes.find((t) => !t.user && t.name === theme.name) ? theme.name : "My theme");
        if (!name) return;
        theme.name = name;
        themes = await api.save_theme(theme);
        ctx.boot.themes = themes;
        commit();
        toast("Theme saved", name, "good", "palette");
      } })] }));

    const hd = theme.header;
    const isOn = (t) => t.name === theme.name && t.base === theme.base && t.accent === theme.accent;

    const gallery = card({ title: "Themes" }, h("div.theme-cards", themes.map((t) =>
      h("button.theme-card", { class: isOn(t) ? "on" : "", onclick: () => { theme = structuredClone({ ...t, user: undefined }); delete theme.user; commit(); } },
        themePreview(t),
        h("div.tn", t.name, h("div.spacer"), t.user ? h("span", { title: "Delete theme", style: { color: "var(--text-3)", display: "flex" },
          onclick: async (e) => { e.stopPropagation(); themes = await api.delete_theme(t.name); ctx.boot.themes = themes; draw(); } }, icon("trash")) : null)))));

    const colours = card({ title: "Colours" }, h("div.row", { style: { gap: "48px", alignItems: "flex-start", flexWrap: "nowrap" } },
      h("div.field", h("label", "Mode"), seg([["light", "Light", "sun"], ["dark", "Dark", "moon"]], theme.base, (v) => { theme.base = v; commit(); })),
      h("div.field", { style: { flex: 1 } }, h("label", "Accent"), h("div.swatches", { style: { marginTop: "4px" } }, ACCENTS.map(([id, label, hex]) =>
        h("button.swatch", { class: theme.accent === id ? "on" : "", onclick: () => { theme.accent = id; commit(); } },
          h("span.ball", { style: { background: hex } }), label))))));

    // ---- header editor ----
    const [ac1, ac2, ac3] = accentColors(theme.accent, theme.base);
    const colors = hd.useAccent ? [ac1, ac2] : (hd.colors?.length ? hd.colors : [ac1, ac2]);
    const tiles = h("div.pattern-tiles", PATTERNS.map(([id, label]) =>
      h("button.ptile", { class: hd.pattern === id && hd.type === "pattern" ? "on" : "", onclick: () => { hd.type = "pattern"; hd.pattern = id; commit(); } },
        h("div.p", { style: patternCSS(id, colors[0], colors[1], Math.max(10, (hd.scale || 28) * 0.55), ac3) }), label)));

    const colorIn = (i) => h("input.color-in", { type: "color", value: colors[i], disabled: hd.useAccent,
      oninput: (e) => { hd.colors = [...colors]; hd.colors[i] = e.target.value; colors[i] = e.target.value; commit(false); } });

    const fileIn = h("input", { type: "file", accept: "image/*", style: { display: "none" }, onchange: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        hd.image = await imageToDataUrl(f);
        hd.type = "image";
        commit();
      } catch (err) { toastError(err); }
    } });

    const headerCard = card({ title: "Header" },
      h("div.stack",
        seg([["pattern", "Pattern", "sparkle"], ["image", "Image", "image"], ["none", "None", "x"]], hd.type, (v) => { hd.type = v; commit(); }),
        hd.type === "pattern" ? [
          tiles,
          h("div.grid.c3",
            h("div.field", h("label", "Colours"), h("div.row", colorIn(0), colorIn(1), switchEl(hd.useAccent, (v) => { hd.useAccent = v; if (!v) hd.colors = [...colors]; commit(); }, "Match accent"))),
            h("div.field", h("label", "Pattern size"), rangeEl(hd.scale || 28, 10, 80, 1, (v) => { hd.scale = v; commit(false); })),
            h("div.field", h("label", "Header height"), rangeEl(hd.height || 132, 96, 260, 2, (v) => { hd.height = v; commit(false); }))),
        ] : null,
        hd.type === "image" ? [
          h("div.row", fileIn, btn(hd.image ? "Choose another image" : "Choose an image", { icon: "upload", kind: "primary", onclick: () => fileIn.click() }),
            hd.image ? btn("Remove", { icon: "trash", kind: "ghost", onclick: () => { hd.image = ""; hd.type = "pattern"; commit(); } }) : null),
          h("div.grid.c3",
            h("div.field", h("label", "Fit"), seg([["cover", "Fill"], ["tile", "Tile"], ["contain", "Fit"]], hd.imageFit || "cover", (v) => { hd.imageFit = v; commit(false); })),
            h("div.field", h("label", "Tile size"), rangeEl(hd.scale || 28, 10, 80, 1, (v) => { hd.scale = v; commit(false); })),
            h("div.field", h("label", "Header height"), rangeEl(hd.height || 132, 96, 260, 2, (v) => { hd.height = v; commit(false); }))),
          h("p.small.faint", { style: { margin: 0 } }, "Your art is stored with the theme, so saved themes keep their image. Tile mode works well for seamless patterns."),
        ] : null,
        hd.type === "none" ? h("p.small.muted", { style: { margin: 0 } }, "A clean page title with no banner.") : null));

    clear(body, gallery, colours, headerCard,
      h("div.notice", icon("info"), h("div", "Want to go further? ", h("span.mono", "web/css/custom.css"), " is yours to edit. Add new accents, change corner roundness, anything. It's loaded last, so it wins.")));
  }
  draw();
}

async function imageToDataUrl(file, maxW = 2400) {
  const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  if (file.size < 1.5e6 || file.type === "image/gif") return url;
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const scale = Math.min(1, maxW / img.width);
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/webp", 0.9);
}


// ---------------------------------------------------------------------------
function reading(ctx, root) {
  const s = ctx.boot.settings;
  const saveKey = (k) => (v) => ctx.saveSettings({ [k]: v }).then(() => { ctx.links = null; toast("Saved", "", "good", "check", 1500); }).catch(toastError);
  root.append(ctx.header({ title: "Reading", subtitle: "How pages and recaps are shown.", icon: "eye" }),
    h("div.stack",
      card({ title: "Automatic links" },
        switchEl(s.auto_link !== false, saveKey("auto_link"), "Link mentions of page names"),
        h("p.small.muted", { style: { margin: "8px 0 0" } },
          "The first time a page's name, an alias, or a character's first name appears in a page or recap, it becomes a link. Your files aren't changed; it's only how they're shown.")),
      card({ title: "Notifications" },
        switchEl(s.notify_on_finish !== false, saveKey("notify_on_finish"), "Desktop notification when a long job finishes"))));
}

function about(ctx, root) {
  const b = ctx.boot;
  root.append(ctx.header({ title: "About", subtitle: `Lore Studio ${b.version}`, icon: "info" }),
    card(null, h("div.stack.sm",
      h("p", { style: { margin: 0 } }, "A local GM suite for planning, running and remembering a tabletop campaign. MIT licensed."),
      h("p.tiny.faint", { style: { margin: "6px 0 0" } }, "Includes material from the System Reference Document 5.1 (SRD 5.1) by Wizards of the Coast LLC, licensed under CC BY 4.0."),
      h("div.kv",
        h("div.kv-row", h("span.faint", "Version"), h("span", b.version)),
        h("div.kv-row", h("span.faint", "App data"), h("span.mono", b.data_dir)),
        h("div.kv-row", h("span.faint", "Window"), h("span", b.native ? "App window" : "Web browser"))))),
    card({ title: "Report a problem" }, h("div.stack.sm",
      h("p.small.muted", { style: { margin: 0 } }, "Copy diagnostics gives a short report of your setup (versions, AI, transcription, GPU) to paste into a bug report. API keys, tokens and webhooks are never included, and neither is anything from your campaign."),
      h("div.row",
        btn("Copy diagnostics", { icon: "copy", onclick: () => showDiagnostics() }),
        btn("Report a bug", { icon: "share", kind: "ghost", onclick: () => window.open("https://github.com/cococolacake/lore-studio/issues/new/choose", "_blank") })))));
}

async function showDiagnostics() {
  let text;
  try { text = await api.diagnostics(); } catch (e) { return toastError(e); }
  const box = h("textarea.input.mono", { value: text, rows: 16, readonly: true, style: { fontSize: "12px" } });
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); }
    catch { box.select(); document.execCommand("copy"); }
    toast("Copied", "Paste it into the Diagnostics box of your bug report.", "good", "check", 3000);
  };
  copy();
  await modal("Diagnostics", h("div.stack.sm", box,
    h("div.row", h("p.tiny.faint.grow", { style: { margin: 0 } }, "Already copied. Have a quick look before posting: failed job logs can mention session or page names."),
      btn("Copy again", { icon: "copy", size: "sm", kind: "ghost", onclick: copy }))),
    [{ label: "Done", kind: "primary", value: true }], { wide: true });
}

// ---------------------------------------------------------------------------
const saveKey = (ctx, k, msg = "Saved") => (v) => ctx.saveSettings({ [k]: v }).then(() => toast(msg, "", "good", "check", 1500)).catch(toastError);

function secretInput(ctx, key, placeholder) {
  const set = ctx.boot.settings.secrets_set?.[key];
  const inp = h("input.input.mono", { type: "password", placeholder: set ? "Saved. Type to replace it." : placeholder, autocomplete: "off" });
  const save = btn("Save", { onclick: async () => {
    if (!inp.value.trim()) return;
    try { await ctx.saveSettings({ [key]: inp.value.trim() }); inp.value = ""; inp.placeholder = "Saved. Type to replace it."; toast("Saved", "", "good", "check", 1500); } catch (e) { toastError(e); }
  } });
  const clearBtn = set ? btn("", { icon: "trash", kind: "ghost", title: "Remove", onclick: async () => {
    await ctx.saveSettings({ [key]: "" }).catch(toastError); inp.placeholder = placeholder; clearBtn.remove();
  } }) : null;
  return h("div.input-wrap", inp, save, clearBtn);
}

function partyCard(ctx) {
  const party = structuredClone(ctx.boot.campaign.info.party || []);
  const rows = h("div.stack.sm");
  const draw = () => clear(rows,
    party.length ? h("div.party-row.head", h("span", "Character"), h("span", "Player"), h("span", "Their transcript label"), h("span")) : null,
    party.map((p, i) => h("div.party-row",
      h("input.input", { value: p.character || "", placeholder: "John Doe", oninput: (e) => { p.character = e.target.value; } }),
      h("input.input", { value: p.player || "", placeholder: "Sam", oninput: (e) => { p.player = e.target.value; } }),
      h("input.input", { value: p.speaker || "", placeholder: "optional, e.g. Players 01", oninput: (e) => { p.speaker = e.target.value; } }),
      btn("", { icon: "trash", kind: "ghost", onclick: () => { party.splice(i, 1); draw(); } }))),
    h("div.row", btn("Add a character", { icon: "plus", size: "sm", kind: "ghost", onclick: () => { party.push({}); draw(); } }),
      btn("Save party", { icon: "save", size: "sm", kind: "primary", onclick: async () => {
        try { ctx.boot.campaign = await api.save_campaign_info({ party: party.filter((p) => p.character || p.player) }); toast("Party saved", "", "good", "check", 1500); } catch (e) { toastError(e); }
      } })));
  draw();
  return card({ title: "The party", actions: h("button.linkish", { onclick: () => ctx.go("party") }, "Open the Party page") },
    h("p.small.muted", { style: { marginTop: 0 } }, "Recap drafts use this to write about characters instead of players, and the transcriber listens for these names. Backstories, your plans and Foundry sheets are on the Party page."), rows);
}

function spellingsCard(ctx) {
  const box = h("div.stack.sm");
  const draw = async () => {
    const sp = await api.spellings().catch(() => ({}));
    const entries = Object.entries(sp);
    clear(box, entries.length ? h("div.row", { style: { gap: "8px" } }, entries.map(([wrong, right]) =>
      h("span.tag", h("s.faint", wrong), " → ", h("b", { style: { color: "var(--text)" } }, right),
        h("button.linkish.danger", { title: "Forget", onclick: async () => { delete sp[wrong]; await api.save_spellings(sp).catch(toastError); draw(); } }, " ✕"))))
      : h("p.small.faint", { style: { margin: 0 } }, "None yet. Use Fix names on a session's recap to add them."));
  };
  draw();
  return card({ title: "Name spellings" }, h("p.small.muted", { style: { marginTop: 0 } }, "Corrections you've asked Lore Studio to remember. They help the transcriber, fix new transcripts and guide recap drafts."), box);
}

// ---------------------------------------------------------------------------
async function claude(ctx, root) {
  const s = ctx.boot.settings;
  const offCard = card({ title: "AI features" }, h("div.stack.sm",
    switchEl(!s.ai_off, async (on) => { await ctx.saveSettings({ ai_off: !on }); ctx.go("settings", { section: "claude" }); }, "Show AI features"),
    h("p.small.muted", { style: { margin: 0 } }, s.ai_off
      ? "AI is hidden: no chat page, no drafting, scene ideas, tag suggestions or thread checks. Recaps, transcripts and everything else work as normal, and nothing is ever sent to an AI."
      : "Turn this off to hide chat, recap drafting, scene ideas, tag suggestions and thread checks everywhere in Lore Studio.")));
  if (s.ai_off) {
    root.append(ctx.header({ title: "AI", subtitle: "Switched off.", icon: "feather" }), h("div.stack", offCard));
    return;
  }
  const models = await api.claude_models();
  const presets = await api.local_presets();
  const known = models.some(([id]) => id === s.recap_model);
  const local = s.ai_provider === "local";
  const style = h("textarea.input", { value: ctx.boot.campaign?.info?.recap_style || "", placeholder: "e.g. Keep player recaps under 600 words. Open with an italic one-line teaser. Call the party “the Lanterns”." });
  const redraw = () => ctx.go("settings", { section: "claude" });
  const testBtn = (label) => btn(label, { icon: "zap", size: "sm", onclick: async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { const r = await api.claude_test(); toast(local ? "Your local model answered" : "Claude is connected", `${r.model}: “${r.reply}”`, "good", "check", 8000); } catch (err) { toastError(err); }
    b.disabled = false;
  } });

  const providerCard = card({ title: "Who writes the drafts" }, h("div.stack.sm",
    seg([["claude", "Claude (Anthropic API)"], ["local", "A local model"]], local ? "local" : "claude",
      async (v) => { await ctx.saveSettings({ ai_provider: v }); redraw(); }),
    h("p.small.muted", { style: { margin: 0 } }, local
      ? "Use a model running on your own computer (or your network) through any OpenAI-compatible server: Ollama, LM Studio, llama.cpp, KoboldCpp, vLLM, text-generation-webui and others. Free and private; quality and speed depend on the model and your hardware."
      : "Claude writes the best recaps. You pay Anthropic directly for what you use, usually a few cents to a quarter per session.")));

  let claudeCards = [];
  if (!local) {
    claudeCards = [
      card({ title: "API key" }, h("div.stack.sm",
        secretInput(ctx, "anthropic_api_key", "sk-ant-…"),
        h("p.small.muted", { style: { margin: 0 } }, "Create a key at console.anthropic.com. It's stored only on this PC, in Lore Studio's settings, never in your campaign folder."),
        h("div", testBtn("Test the connection")))),
      card({ title: "Model" }, h("div.field", h("select.select", { onchange: (e) => saveKey(ctx, "recap_model")(e.target.value) },
        models.map(([id, label]) => h("option", { value: id, selected: id === s.recap_model }, label)),
        known ? null : h("option", { value: s.recap_model, selected: true }, s.recap_model)))),
    ];
  }

  let localCards = [];
  if (local) {
    const url = h("input.input.mono", { value: s.local_url || "", placeholder: "http://localhost:11434/v1", onchange: (e) => saveKey(ctx, "local_url")(e.target.value.trim()) });
    const modelIn = h("input.input.mono", { value: s.local_model || "", placeholder: "e.g. qwen3:14b", list: "local-models",
      onchange: (e) => saveKey(ctx, "local_model")(e.target.value.trim()) });
    const list = h("datalist#local-models");
    const found = h("div.small.muted");
    const findModels = async (quiet) => {
      try {
        const ms = await api.local_models(url.value.trim());
        clear(list); list.append(...ms.map((m) => h("option", { value: m })));
        found.textContent = ms.length ? `Found ${ms.length} model${ms.length === 1 ? "" : "s"}: ${ms.slice(0, 8).join(", ")}${ms.length > 8 ? "…" : ""}. Click the box to pick one.` : "The server is running but lists no models. Load one in your server first.";
        if (!modelIn.value && ms.length === 1) { modelIn.value = ms[0]; await saveKey(ctx, "local_model")(ms[0]); }
      } catch (err) { found.textContent = ""; if (!quiet) toastError(err); }
    };
    findModels(true);
    localCards = [
      card({ title: "Server" }, h("div.stack.sm",
        h("div.row.wrap", { style: { gap: "6px" } }, presets.map(([name, u]) => h("button.tag.click", { onclick: async () => { url.value = u; await saveKey(ctx, "local_url")(u); findModels(); } }, name))),
        h("div.field", h("label", "Address (OpenAI-compatible, usually ends in /v1)"), url),
        h("div.grid.c2",
          h("div.field", h("label", "Model"), h("div.input-wrap", modelIn, btn("", { icon: "refresh", title: "Find models on the server", onclick: () => findModels() })), list),
          h("div.field", h("label", "API key (only if your server needs one)"), secretInput(ctx, "local_api_key", "optional"))),
        found,
        h("div", testBtn("Test the model")))),
      card({ title: "Context size" }, h("div.stack.sm",
        h("div.field", h("label", "How many tokens the model can read at once"),
          h("select.select", { onchange: (e) => saveKey(ctx, "local_context")(Number(e.target.value)) },
            [8192, 16384, 32768, 65536, 131072].map((n) => h("option", { value: n, selected: Number(s.local_context) === n }, `${n / 1024}k tokens`)),
            [8192, 16384, 32768, 65536, 131072].includes(Number(s.local_context)) ? null : h("option", { value: s.local_context, selected: true }, `${s.local_context} tokens`))),
        h("p.small.muted", { style: { margin: 0 } }, "Match what your server is set to, not just what the model supports (Ollama's default is small: set num_ctx, or OLLAMA_CONTEXT_LENGTH). When a session's transcript is too long, Lore Studio condenses it into notes part by part first, so smaller contexts still work, just more slowly."))),
      card({ title: "Picking a model" }, h("ul.small.muted", { style: { margin: 0, paddingLeft: "18px" } },
        h("li", "Recaps are long writing from long input: an instruction-tuned model of about 12B parameters or more with at least a 32k context does well."),
        h("li", "Loose threads use function calling. Models without it still work: Lore Studio asks for plain JSON instead."),
        h("li", "Reasoning models are fine; their thinking is removed from the draft."))),
    ];
  }

  root.append(ctx.header({ title: "AI", subtitle: "Recaps, player recaps, loose threads and scene ideas, drafted from your transcripts.", icon: "feather" }),
    h("div.stack",
      offCard, providerCard, ...claudeCards, ...localCards,
      card({ title: "Drafting" }, h("div.stack",
        switchEl(!!s.auto_recap, saveKey(ctx, "auto_recap"), "Draft the recap automatically when a transcript is ready"),
        h("p.small.faint", { style: { margin: 0 } }, "Drafts never replace your recap until you accept them."))),
      ctx.boot.campaign ? card({ title: `Style notes for ${ctx.boot.campaign.name}` }, h("div.stack.sm", style,
        h("div", btn("Save notes", { icon: "save", size: "sm", onclick: async () => {
          try { ctx.boot.campaign = await api.save_campaign_info({ recap_style: style.value }); toast("Saved", "", "good", "check", 1500); } catch (e) { toastError(e); }
        } })))) : null));
}

// ---------------------------------------------------------------------------
async function transcription(ctx, root) {
  const s = ctx.boot.settings;
  const st = await api.transcription_status();
  const log = logView(200);
  log.el.classList.add("hidden");
  const install = async (diar) => {
    log.el.classList.remove("hidden");
    log.clear();
    try {
      const tid = await api.install_transcription(diar);
      followTask(tid, log, (t) => {
        if (t.status === "done") { toast("Transcription is ready", "", "good", "check"); ctx.go("settings", { section: "transcription" }); }
        else toast("Install didn't finish", "See the log.", "bad", "alert");
      });
    } catch (e) { toastError(e); }
  };
  root.append(ctx.header({ title: "Transcription", subtitle: "Runs on your PC with faster-whisper. Nothing is uploaded.", icon: "file" }),
    h("div.stack",
      card({ title: "Engine" }, h("div.stack.sm",
        h("div.row",
          st.installed ? h("span.chip.good", icon("circleCheck"), "Installed") : h("span.chip.warn", icon("alert"), "Not installed"),
          st.gpu ? h("span.chip", "NVIDIA GPU found") : h("span.chip", "No NVIDIA GPU: CPU only, much slower"),
          st.diarization ? h("span.chip.good", "Speaker detection installed") : null),
        h("p.small.muted", { style: { margin: 0 } }, "Installs into its own environment (", h("span.mono", st.path), "), so the app itself stays small. About 1 to 2 GB with the GPU libraries; the Whisper model downloads on first use."),
        h("div.row",
          btn(st.installed ? "Update" : "Install transcription", { icon: "download", kind: st.installed ? "" : "primary", onclick: () => install(false) }),
          st.installed && !st.diarization ? btn("Add speaker detection", { icon: "plus", onclick: () => install(true) }) : null),
        log.el)),
      card({ title: "Options" }, h("div.grid.c2",
        h("div.field", h("label", "Whisper model"), h("select.select", { onchange: (e) => saveKey(ctx, "whisper_model")(e.target.value) },
          [["large-v3-turbo", "large-v3-turbo (fast, accurate: recommended)"], ["large-v3", "large-v3 (slowest, most accurate)"], ["medium", "medium"], ["small", "small (for CPUs)"]]
            .map(([v, l]) => h("option", { value: v, selected: v === s.whisper_model }, l)))),
        h("div.field", h("label", "Run on"), seg([["auto", "Auto"], ["cuda", "GPU"], ["cpu", "CPU"]], s.whisper_device || "auto", saveKey(ctx, "whisper_device"))),
        h("div.field", h("label", "Batch size"), h("input.input.nums", { type: "number", min: 1, max: 64, value: s.whisper_batch, onchange: (e) => saveKey(ctx, "whisper_batch")(Number(e.target.value) || 16) }),
          h("div.help", "16 fits comfortably in 16 GB of VRAM. Lower it if you run out of memory.")),
        h("div.field", h("label", "Language"), h("input.input", { value: s.whisper_language, placeholder: "en (blank = detect)", onchange: (e) => saveKey(ctx, "whisper_language")(e.target.value.trim()) })),
        h("div.span2", switchEl(s.auto_transcribe !== false, saveKey(ctx, "auto_transcribe"), "Start transcribing as soon as OBS stops recording")))),
      card({ title: "Speaker detection (optional)" }, h("div.stack.sm",
        h("p.small.muted", { style: { margin: 0 } }, "Tells the players apart on the Discord track, using pyannote's community-1 model. It needs a free Hugging Face token, and you must accept the model's terms once at huggingface.co/pyannote/speaker-diarization-community-1."),
        h("div.field", h("label", "Hugging Face token"), secretInput(ctx, "hf_token", "hf_…")),
        switchEl(s.diarize_players !== false, saveKey(ctx, "diarize_players"), "Tell voices apart on the players' track by default")))));
}

// ---------------------------------------------------------------------------
function obs(ctx, root) {
  const s = ctx.boot.settings;
  const trackSel = (key) => h("select.select", { onchange: (e) => saveKey(ctx, key)(Number(e.target.value)) },
    [0, 1, 2, 3, 4, 5, 6].map((n) => h("option", { value: n, selected: Number(s[key]) === n }, n ? `Track ${n}` : "None")));
  root.append(ctx.header({ title: "OBS", subtitle: "Start, mark and stop the session recording from Lore Studio.", icon: "play" }),
    h("div.stack",
      card({ title: "Connection" }, h("div.stack",
        switchEl(!!s.obs_enabled, async (v) => { await saveKey(ctx, "obs_enabled")(v); }, "Control OBS from Lore Studio"),
        h("div.grid.c3",
          h("div.field", h("label", "Host"), h("input.input", { value: s.obs_host, onchange: (e) => saveKey(ctx, "obs_host")(e.target.value.trim() || "127.0.0.1") })),
          h("div.field", h("label", "Port"), h("input.input.nums", { type: "number", value: s.obs_port, onchange: (e) => saveKey(ctx, "obs_port")(Number(e.target.value) || 4455) })),
          h("div.field", h("label", "Password"), secretInput(ctx, "obs_password", "From OBS"))),
        h("div", btn("Test the connection", { icon: "zap", size: "sm", onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true;
          try { const r = await api.obs_test(); toast("Connected to OBS", `OBS ${r.obs}, WebSocket ${r.websocket}${r.recording ? " · recording now" : ""}`, "good", "check", 6000); } catch (err) { toastError(err); }
          b.disabled = false;
        } })))),
      card({ title: "Audio tracks" }, h("div.stack.sm",
        h("p.small.muted", { style: { margin: 0 } }, "Which OBS audio track holds whose voice. With your mic and Discord on separate tracks, every line is labelled GM or Players before any speaker detection runs."),
        h("div.grid.c2",
          h("div.field", h("label", "Your mic (GM)"), trackSel("obs_gm_track")),
          h("div.field", h("label", "Discord (players)"), trackSel("obs_players_track"))))),
      card({ title: "Recording with Craig instead?" }, h("p.small.muted", { style: { margin: 0 } },
        "Craig and similar Discord bots record each person to their own file. On a session's Transcript tab, choose ", h("b", "Attach one file per person"),
        " and pick Craig's download (the .zip or the unzipped folder). Every line is then labelled with who said it, with no guessing.")),
      card({ title: "One-time setup in OBS" }, h("ol.setup",
        h("li", "Tools → WebSocket Server Settings → tick ", h("b", "Enable WebSocket server"), ", then Show Connect Info and copy the password here."),
        h("li", "Settings → Output → Recording: set the format to ", h("b", "Hybrid MP4"), " (marked moments become chapters, and the file survives a crash)."),
        h("li", "Edit → Advanced Audio Properties: put ", h("b", "your mic"), " only on track 2 and ", h("b", "Discord"), " only on track 3. (No Discord source yet? Add an ", h("b", "Application Audio Capture"), " source and pick Discord, so other sounds stay out of the players' track.) Keep both on track 1 too, for the video's normal sound."),
        h("li", "Settings → Output → Recording: tick Audio Track ", h("b", "1, 2 and 3"), ". If they're round buttons you can't tick, Recording Quality is set to “Same as stream”, which records one track only: pick ", h("b", "High Quality, Medium File Size"), " instead (or switch Output Mode to Advanced and use its Recording tab).")))));
}

// ---------------------------------------------------------------------------
async function foundry(ctx, root) {
  const info = await api.foundry_info();
  let dataDir = info.data_dirs[0] || "";
  const statusLine = h("div.small");
  const drawStatus = (st) => {
    clear(statusLine);
    statusLine.append(st.connected
      ? h("span.chip.good", icon("check"), ` Connected${st.world ? ` to ${st.world}` : ""}${st.user ? ` as ${st.user}` : ""}`)
      : h("span.chip", "Not connected. Open your world in Foundry as the GM with the module enabled."));
    if (st.connected && st.system) statusLine.append(h("span.muted", ` · Foundry ${st.foundry}, ${st.system}`));
  };
  drawStatus(info.status);
  const timer = setInterval(async () => {
    if (!statusLine.isConnected) return clearInterval(timer);
    try { drawStatus(await api.foundry_status()); } catch { /* ignore */ }
  }, 4000);
  const copy = (text, what) => navigator.clipboard.writeText(text).then(() => toast(`${what} copied`, "", "good", "check", 2500), toastError);
  const tokenBox = h("input.input.mono", { value: info.token, readonly: true, type: "password" });
  root.append(ctx.header({ title: "Foundry VTT", subtitle: "Send rolls, chat and combat to the session log, and lore pages and recaps to Foundry journals.", icon: "dice" }),
    h("div.stack",
      card({ title: "Status" }, statusLine),
      card({ title: "Install the module" }, h("div.stack.sm",
        h("p.small.muted", { style: { margin: 0 } }, `Lore Studio Bridge ${info.module_version}. Pick Foundry's Data folder (the one containing modules and worlds) and Lore Studio copies the module in. Installing again updates it.`),
        h("div.field", h("label", "Foundry Data folder"), pathInput(dataDir, (v) => { dataDir = v; }, { folder: true, placeholder: "C:/Users/you/AppData/Local/FoundryVTT/Data" })),
        h("div", btn("Install module", { icon: "download", size: "sm", onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true;
          try { const where = await api.foundry_install(dataDir); toast("Module installed", where, "good", "check", 6000); } catch (err) { toastError(err); }
          b.disabled = false;
        } })))),
      card({ title: "Connect" }, h("div.stack.sm",
        h("div.grid.c2",
          h("div.field", h("label", "Lore Studio address"), h("div.input-wrap", h("input.input.mono", { value: info.url, readonly: true }),
            btn("", { icon: "copy", title: "Copy", onclick: () => copy(info.url, "Address") }))),
          h("div.field", h("label", "Token"), h("div.input-wrap", tokenBox,
            btn("", { icon: "eye", title: "Show", onclick: () => { tokenBox.type = tokenBox.type === "password" ? "text" : "password"; } }),
            btn("", { icon: "copy", title: "Copy", onclick: () => copy(info.token, "Token") })))),
        h("div", btn("New token", { size: "sm", kind: "ghost", onclick: async () => {
          if (!(await confirmBox("Make a new token?", "Foundry will stop connecting until you paste the new token into the module settings."))) return;
          const r = await api.foundry_new_token(); tokenBox.value = r.token; info.token = r.token;
        } })))),
      card({ title: "One-time setup in Foundry" }, h("ol.setup",
        h("li", "Install the module above, then start Foundry and open your world."),
        h("li", "Game Settings → Manage Modules → tick ", h("b", "Lore Studio Bridge"), "."),
        h("li", "Game Settings → Configure Settings → Lore Studio Bridge: paste the ", h("b", "address"), " and ", h("b", "token"), " from this page."),
        h("li", "Keep Lore Studio open while you play. Only the GM's browser talks to it, and only on this computer.")))));
}

// ---------------------------------------------------------------------------
async function playersite(ctx, root) {
  if (!ctx.boot.campaign) return campaign(ctx, root);
  let info = await api.player_site();
  const o = { ...info.options };
  const save = async (patch) => { Object.assign(o, patch); try { info = await api.player_site_save(patch); } catch (e) { toastError(e); } };
  const status = h("div.small.muted");
  const drawStatus = () => { status.textContent = info.built ? `Last built ${info.built}, in ${info.path}` : `Not built yet. It goes in ${info.path}`; };
  drawStatus();
  const previewBtn = btn("Preview", { icon: "eye", size: "sm", disabled: !info.preview && !info.built, onclick: () => {
    if (info.preview) window.open(info.preview, "_blank");
    else api.player_site_open().catch(toastError);
  } });
  const buildBtn = btn(info.built ? "Update the lore book" : "Build the lore book", { icon: "refresh", kind: "primary", onclick: async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      const tid = await api.player_site_build();
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const st = await api.task(tid).catch(() => null);
        if (!st || st.status !== "running") {
          if (st?.status === "error" || st?.status === "failed") throw new Error((st.lines || []).slice(-1)[0] || "Building the lore book failed.");
          break;
        }
      }
      info = await api.player_site(); drawStatus();
      previewBtn.disabled = false;
      toast("Player lore book ready", "Preview it, then upload the folder to share it.", "good", "check", 5000);
    } catch (err) { toastError(err); }
    b.disabled = false;
  } });
  const missing = info.sessions_without_player_recap;
  root.append(ctx.header({ title: "Player lore book", subtitle: "A website of everything your players are allowed to see, to share with a link.", icon: "globe" }),
    h("div.stack",
      card({ title: "Your lore book", actions: h("div.row", { style: { gap: "6px" } }, previewBtn, buildBtn) }, h("div.stack.sm",
        status,
        h("div.notice.small", icon("lock"), h("div.grow", `GM-only pages (${info.gm_pages}), GM blocks, GM map pins, GM clocks, GM calendar events and handouts you haven't revealed are left out before anything is written, so they're not in the website at all. Everything else is in, so mark secrets as GM-only first.`)),
        h("div", btn("Open the folder", { icon: "folder", size: "sm", kind: "ghost", onclick: () => api.player_site_open().catch(toastError) })))),
      card({ title: "What to include" }, h("div.stack.sm",
        switchEl(o.maps, (v) => save({ maps: v }), "Maps (without GM pins)"),
        switchEl(o.handouts, (v) => save({ handouts: v }), "Handouts you've marked as revealed"),
        switchEl(o.calendar, (v) => save({ calendar: v }), "Calendar: today's date, holidays and events that aren't GM-only"),
        switchEl(o.clocks, (v) => save({ clocks: v }), "Clocks that aren't GM-only, as “Rumours & threats”"),
        switchEl(o.timeline, (v) => save({ timeline: v }), "Timeline blocks and lanes that aren't GM-only"),
        switchEl(o.gm_recaps, (v) => save({ gm_recaps: v }), "For sessions without a player recap, use the main recap (GM blocks removed)"),
        missing.length ? h("p.tiny.faint", { style: { margin: 0 } }, `${missing.length} session${missing.length === 1 ? " has" : "s have"} a recap but no player recap (${missing.slice(0, 12).join(", ")}${missing.length > 12 ? "…" : ""}). Main recaps can mention GM things outside GM blocks, like a “For the GM” section, so check them before turning this on.`) : null,
        h("div.grid.c2",
          h("div.field", h("label", "Title"), h("input.input", { value: o.title || "", placeholder: ctx.boot.campaign.name, onchange: (e) => save({ title: e.target.value.trim() }) })),
          h("div.field", h("label", "Folder"), pathInput(o.out_dir || "", (v) => save({ out_dir: v }), { folder: true, placeholder: info.default }))))),
      card({ title: "Sharing it" }, h("div.stack.sm",
        h("p.small.muted", { style: { margin: 0 } }, "The lore book is a plain folder of files, so any free static host can put it online. Rebuild and upload again after each session."),
        h("ol.setup",
          h("li", h("b", "Quickest: Netlify Drop. "), "Go to app.netlify.com/drop and drag the folder onto the page. You get a link at once; make a free account to keep it and to update it by dragging again."),
          h("li", h("b", "GitHub Pages. "), "Make a repository, upload the folder's contents, then Settings → Pages → deploy from the main branch. The link looks like you.github.io/your-repo."),
          h("li", h("b", "Neocities, a shared Google Drive or Dropbox folder, or a zip on Discord "), "work too: players open index.html.")),
        h("p.tiny.faint", { style: { margin: 0 } }, "Anyone with the link can read it, so treat it like anything else you post for the players.")))));
}

// ---------------------------------------------------------------------------
async function discord(ctx, root) {
  if (!ctx.boot.campaign) return campaign(ctx, root);
  const cfg = await api.discord_config();
  const hooks = h("div.stack.sm");
  const drawHooks = () => clear(hooks,
    cfg.webhooks.map((w, i) => h("div.hook-row",
      h("input.input", { value: w.name || "", placeholder: "#recaps", oninput: (e) => { w.name = e.target.value; } }),
      h("input.input.mono", { value: w.url || "", placeholder: "https://discord.com/api/webhooks/…", oninput: (e) => { w.url = e.target.value.trim(); } }),
      btn("", { icon: "trash", kind: "ghost", onclick: () => { cfg.webhooks.splice(i, 1); drawHooks(); } }))),
    h("div", btn("Add a channel", { icon: "plus", size: "sm", kind: "ghost", onclick: () => { cfg.webhooks.push({ name: "", url: "" }); drawHooks(); } })));
  drawHooks();
  const text = (key, ph) => h("input.input", { value: cfg[key] || "", placeholder: ph, oninput: (e) => { cfg[key] = e.target.value; } });
  const save = btn("Save Discord settings", { icon: "save", kind: "primary", onclick: async () => {
    try { Object.assign(cfg, await api.save_discord_config(cfg)); toast("Saved", "", "good", "check", 1500); } catch (e) { toastError(e); }
  } });
  root.append(ctx.header({ title: "Discord", subtitle: `Where ${ctx.boot.campaign.name}'s recaps get posted. Nothing posts without your OK.`, icon: "share", actions: [save] }),
    h("div.stack",
      card({ title: "Channels" }, h("div.stack.sm",
        h("p.small.muted", { style: { margin: 0 } }, "In Discord: Channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL. Anyone with the URL can post there, so keep it private."),
        hooks)),
      card({ title: "How posts look" }, h("div.stack",
        h("div.grid.c2",
          h("div.field", h("label", "Post as"), text("username", "The Chronicler"), h("div.help", "Blank uses the webhook's own name.")),
          h("div.field", h("label", "Avatar image URL"), text("avatar_url", "https://…/avatar.png"))),
        h("div.grid.c3",
          h("div.field", h("label", "Style"), seg([["embed", "Card"], ["plain", "Plain text"]], cfg.style, (v) => { cfg.style = v; })),
          h("div.field", h("label", "Card colour"), h("input.color-in", { type: "color", value: cfg.color || "#9381FF", oninput: (e) => { cfg.color = e.target.value; } })),
          h("div.field", h("label", "Spoiler tags"), switchEl(!!cfg.spoiler, (v) => { cfg.spoiler = v; }, "Hide the text until clicked"))),
        h("div.grid.c3",
          h("div.field", h("label", "Title"), text("title", "Session {number}: {title}")),
          h("div.field", h("label", "Line above"), text("header", "Previously, in {campaign}…")),
          h("div.field", h("label", "Footer"), text("footer", "{campaign} · {date}"))),
        h("div.help", "You can use {number}, {title}, {campaign}, {date} and {world_date}."),
        h("div.field", h("label", "Ping a role (optional)"), text("ping_role", "Role ID, e.g. 112233445566778899"),
          h("div.help", "In Discord with Developer Mode on: Server settings → Roles → right-click the role → Copy Role ID."))))));
}
