// Settings → Campaign: the campaign's name and folder, export/restore, and the before-session checklist.
import { api } from "../../api.js";
import { exportCard, restorePanel } from "../../backup.js";
import { h, btn, card, toast, toastError } from "../../dom.js";
import { icon } from "../../icons.js";
import { switchEl } from "../../components.js";
import { partyCard, spellingsCard } from "./helpers.js";

// ---------------------------------------------------------------------------
export function campaign(ctx, root) {
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
    exportCard(ctx),
    card({ title: "Restore a backup" }, restorePanel(ctx)),
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
