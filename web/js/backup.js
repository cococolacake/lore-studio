// Export everything (Settings → Campaign) and Restore a backup (welcome screen and Settings).
import { api } from "./api.js";
import { h, btn, card, toast, toastError } from "./dom.js";
import { checkEl, pathInput, logView, followTask } from "./components.js";

export function exportCard(ctx) {
  const box = h("div.stack.sm");
  api.backup_info().then((info) => {
    let dest = info.folder, media = false, prefs = true, secrets = false;
    const log = logView(140);
    log.el.classList.add("hidden");
    const result = h("div");
    const go = btn("Export everything", { icon: "download", kind: "primary", onclick: async () => {
      go.disabled = true;
      log.el.classList.remove("hidden"); log.clear(); result.replaceChildren();
      try {
        const tid = await api.backup_export(dest, media, prefs, secrets);
        followTask(tid, log, (t) => {
          go.disabled = false;
          if (t.status !== "done") return toast("The export didn't finish", "See the log.", "bad", "alert");
          toast("Exported", "Your backup .zip is ready.", "good", "check");
          result.replaceChildren(h("div.row.nowrap", h("span.mono.small.grow.break", t.result),
            btn("Show in folder", { icon: "folder", size: "sm", kind: "ghost", onclick: () => api.open_folder(t.result).catch(toastError) })));
        });
      } catch (e) { go.disabled = false; toastError(e); }
    } });
    box.replaceChildren(
      h("p.small.muted", { style: { margin: 0 } }, "One .zip with the whole campaign: every lore page, session (plans, transcripts, recaps, live notes, Foundry logs), map, monster, encounter, board, handout, the calendar, timeline, clocks, threads, chats and the party, plus Lore Studio's settings. Keep it as a backup, or restore it on another computer."),
      h("div.field", h("label", "Save it in"), pathInput(dest, (v) => { dest = v; }, { folder: true }), h("div.help", `As "${info.name}".`)),
      checkEl(prefs, (v) => { prefs = v; }, "Include Lore Studio's settings and themes"),
      checkEl(secrets, (v) => { secrets = v; }, "Include API keys, passwords and Discord webhooks (keep the file private)"),
      checkEl(media, (v) => { media = v; }, info.recordings_gb ? `Include session recordings (about ${info.recordings_gb} GB)` : "Include session recordings"),
      h("div.row", go), log.el, result);
  }).catch((e) => box.replaceChildren(h("p.small.muted", String(e.message || e))));
  return card({ title: "Export everything" }, box);
}

/** Restore a backup .zip into a new folder and open it. */
export function restorePanel(ctx, { onOpened } = {}) {
  let zip = "", parent = "", prefs = false;
  const about = h("div");
  const log = logView(140);
  log.el.classList.add("hidden");
  const check = async () => {
    about.replaceChildren();
    if (!zip) return;
    try {
      const m = await api.backup_inspect(zip);
      const c = m.counts || {};
      about.replaceChildren(h("div.callout", h("b", m.campaign), ` · exported ${m.exported} with Lore Studio ${m.lore_studio}`,
        h("div.small.muted", `${c.pages ?? "?"} pages, ${c.sessions ?? "?"} sessions, ${c.monsters ?? 0} monsters${c.recordings ? `, ${c.recordings} recordings` : ""} · ${m.size_mb} MB unpacked`
          + (m.includes?.secrets ? " · includes API keys and webhooks" : ""))));
    } catch (e) { about.replaceChildren(h("p.small", { style: { color: "var(--bad)", margin: 0 } }, String(e.message || e))); }
  };
  const go = btn("Restore", { icon: "upload", kind: "primary", onclick: async () => {
    if (!zip || !parent) return toast("Choose the backup and where to put it", "", "warn", "alert");
    go.disabled = true;
    log.el.classList.remove("hidden"); log.clear();
    try {
      const tid = await api.backup_restore(zip, parent, prefs);
      followTask(tid, log, async (t) => {
        go.disabled = false;
        if (t.status !== "done") return toast("The restore didn't finish", "See the log.", "bad", "alert");
        try { await api.open_campaign(t.result); await ctx.refreshBoot(); toast("Restored", "It's open now.", "good", "check"); onOpened ? onOpened() : ctx.go("home"); }
        catch (e) { toastError(e); }
      });
    } catch (e) { go.disabled = false; toastError(e); }
  } });
  return h("div.stack",
    h("div.field", h("label", "Backup .zip"), pathInput("", (v) => { zip = v; check(); }, { kind: "zip", placeholder: "C:/Users/you/Documents/My Campaign backup.zip" })),
    about,
    h("div.field", h("label", "Put the campaign in"), pathInput("", (v) => { parent = v; }, { folder: true, placeholder: "C:/Users/you/Documents/Campaigns" }),
      h("div.help", "A new folder is made inside it. Nothing is overwritten.")),
    checkEl(prefs, (v) => { prefs = v; }, "Also restore Lore Studio's settings and themes (keys you already entered here are kept)"),
    h("div.row", go), log.el);
}
