// Settings → About: version, updates and diagnostics.
import { api } from "../../api.js";
import { h, btn, card, toast, toastError, clear, modal } from "../../dom.js";
import { switchEl } from "../../components.js";
import { updateNow } from "../../selfupdate.js";

export function about(ctx, root) {
  const b = ctx.boot;
  const upd = h("div.row", { style: { gap: "var(--s3)", flexWrap: "wrap" } });
  const showUpd = (u) => {
    if (u && !u.off) ctx.update = u;
    clear(upd, !u || u.off ? null
      : u.newer ? [h("span.small", h("b", u.latest.channel === "main" ? `New changes on main: ${u.latest.name}` : `${u.latest.tag} is available.`)), btn("Update now", { icon: "download", kind: "primary", size: "sm", onclick: () => updateNow(ctx, u.latest) })]
      : h("span.small.muted", u.latest ? `You're up to date (latest is ${u.latest.tag}).` : "Couldn't reach GitHub."));
  };
  if (ctx.update) showUpd(ctx.update);
  const updates = card({ title: "Updates" },
    h("div.row", { style: { gap: "var(--s3)", flexWrap: "wrap" } },
      switchEl(b.settings.check_app_updates !== false, async (v) => { await ctx.saveSettings({ check_app_updates: v }); }, "Tell me when a new version is out"),
      btn("Check now", { icon: "refresh", onclick: async () => { clear(upd, h("span.small.muted", "Checking…")); try { showUpd(await api.app_update(true)); } catch (e) { toastError(e); } } })),
    h("div.field", { style: { marginTop: "var(--s3)", maxWidth: "360px" } }, h("label", "Update from"),
          h("select.select", { onchange: async (e) => { await ctx.saveSettings({ update_channel: e.target.value }); clear(upd, h("span.small.muted", "Checking…")); try { showUpd(await api.app_update(true)); } catch (err) { toastError(err); } } },
            h("option", { value: "release", selected: b.settings.update_channel !== "main" }, "Releases"),
            h("option", { value: "main", selected: b.settings.update_channel === "main" }, "Main branch (unreleased, less tested)"))),
        h("div", { style: { marginTop: "var(--s2)" } }, upd));
  root.append(ctx.header({ title: "About", subtitle: `Lore Studio ${b.version}`, icon: "info" }),
    h("div.stack",
    card(null, h("div.stack.sm",
      h("p", { style: { margin: 0 } }, "A local GM suite for planning, running and remembering a tabletop campaign. MIT licensed."),
      h("p.tiny.faint", { style: { margin: "var(--s2) 0 0" } }, "Includes material from the System Reference Document 5.1 (SRD 5.1) by Wizards of the Coast LLC, licensed under CC BY 4.0."),
      h("div.kv",
        h("div.kv-row", h("span.faint", "Version"), h("span", b.version)),
        h("div.kv-row", h("span.faint", "App data"), h("span.mono", b.data_dir)),
        h("div.kv-row", h("span.faint", "Window"), h("span", b.native ? "App window" : "Web browser"))))),
    updates,
    card({ title: "Report a problem" }, h("div.stack.sm",
      h("p.small.muted", { style: { margin: 0 } }, "Your setup info for a bug report. Never includes keys, tokens, webhooks or campaign content."),
      h("div.row",
        btn("Copy diagnostics", { icon: "copy", onclick: () => showDiagnostics() }),
        btn("Report a bug", { icon: "share", kind: "ghost", onclick: () => window.open("https://github.com/cococolacake/lore-studio/issues/new/choose", "_blank") }))))));
}

async function showDiagnostics() {
  let text;
  try { text = await api.diagnostics(); } catch (e) { return toastError(e); }
  const box = h("textarea.input.mono", { value: text, rows: 16, readonly: true, style: { fontSize: "12px" } });
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); }
    catch { box.select(); document.execCommand("copy"); }
    toast("Copied", "", "good", "check", 3000);
  };
  copy();
  await modal("Diagnostics", h("div.stack.sm", box,
    h("div.row", h("p.tiny.faint.grow", { style: { margin: 0 } }, "Copied. Failed job logs can include session or page names, so check before posting."),
      btn("Copy again", { icon: "copy", size: "sm", kind: "ghost", onclick: copy }))),
    [{ label: "Done", kind: "primary", value: true }], { wide: true });
}
