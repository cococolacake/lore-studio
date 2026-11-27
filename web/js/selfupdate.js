// "Update now": update Lore Studio itself from inside the app, then restart it.
import { api } from "./api.js";
import { h, modal, toast, toastError, clear, btn } from "./dom.js";
import { icon } from "./icons.js";
import { logView, followTask } from "./components.js";

export async function updateNow(ctx, latest) {
  let info;
  try { info = await api.app_update_info(); } catch (e) { return toastError(e); }
  if (info.busy?.length) {
    return toast(`${info.busy[0]} is still running`, "Update Lore Studio after it has finished.", "", "info", 7000);
  }
  const blocked = info.method === "git" && info.local_changes;
  const how = info.method === "git"
    ? (blocked
      ? h("div.notice.warn", icon("alert"), h("div", "This folder uses git and has changes of its own, so it can't be updated automatically. Use Pull origin in GitHub Desktop instead."))
      : h("p.small.muted", { style: { margin: 0 } }, "This Lore Studio folder uses git, so it's updated with a git pull. Nothing you made locally is overwritten."))
    : h("p.small.muted", { style: { margin: 0 } }, (latest?.channel === "main" ? "The newest files on main are downloaded from GitHub and copied over this folder." : "The new version is downloaded from GitHub and copied over this folder.") + " Your .venv, your custom.css, your settings and your campaigns are kept.");
  const go = await modal(latest?.channel === "main" ? "Update to the latest changes" : latest ? `Update to Lore Studio ${latest.tag}` : "Update Lore Studio", h("div.stack.sm",
    latest?.channel === "main" ? h("p", { style: { margin: 0 } }, `The newest change on main: ${latest.name}`)
      : latest ? h("p", { style: { margin: 0 } }, `You have ${ctx.boot.version}; the newest is ${latest.tag}.`) : null,
    how,
    h("p.small.muted", { style: { margin: 0 } }, "Afterwards Lore Studio restarts by itself (one click). Your campaign opens again where you left it.")),
    [{ label: "Cancel", kind: "ghost", value: false },
     ...(latest?.url ? [{ label: "What's new", value: "notes" }] : []),
     ...(blocked ? [] : [{ label: "Update now", kind: "primary", value: true, icon: "download" }])]);
  if (go === "notes") { window.open(latest.url, "_blank"); return; }
  if (go !== true) return;

  // the progress window: a live log, then Restart now
  const log = logView(200);
  const foot = h("div.row", { style: { justifyContent: "flex-end", gap: "var(--s3)", marginTop: "var(--s3)" } });
  const closeAll = () => document.querySelectorAll(".scrim").forEach((s) => s.remove());
  modal("Updating Lore Studio", h("div.stack.sm", log.el, foot), []);
  let id;
  try { id = await api.app_self_update(latest?.tag || null); } catch (e) { closeAll(); return toastError(e); }
  followTask(id, log, (t) => {
    if (t.status !== "done") {
      clear(foot, btn("Close", { onclick: closeAll }));
      return;
    }
    if (!t.result?.restart) {
      clear(foot, h("span.small.muted", { style: { marginRight: "auto" } }, "You already have the latest version."), btn("Close", { kind: "primary", onclick: closeAll }));
      return;
    }
    clear(foot,
      h("span.small.muted", { style: { marginRight: "auto" } }, "Updated! Restart to use the new version."),
      btn("Later", { kind: "ghost", onclick: closeAll }),
      btn("Restart now", { kind: "primary", icon: "refresh", onclick: async () => {
        if (ctx.dirty?.()) { toast("Save your edits first", "This page has unsaved changes.", "warn", "alert", 6000); return; }
        try {
          await api.app_restart();
          clear(foot, h("span.small.muted", "Restarting… Lore Studio will open again in a moment."));
          if (!ctx.boot.native) setTimeout(() => window.close(), 1500);   // browser mode: the new one opens its own tab
        } catch (e) { toastError(e); }
      } }));
  });
}
