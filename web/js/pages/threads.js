// Loose threads: hooks, questions, promises, debts and clues the party hasn't followed up yet.
// The recap draft proposes them from transcripts; nothing joins the list until the GM accepts it.
import { api } from "../api.js";
import { h, btn, card, chip, clear, empty, toast, toastError, modal, confirmBox } from "../dom.js";
import { icon } from "../icons.js";
import { jobRow, updateJobRow } from "./sessions.js";
import { AI, aiLocal, aiOff, aiReady, aiSetupHint } from "../ai.js";

export const KINDS = {
  hook: ["Hook", "accent", "sparkle"], question: ["Question", "info", "info"], promise: ["Promise", "good", "heart"],
  debt: ["Debt", "warn", "alert"], clue: ["Clue", "accent", "search"], item: ["Item", "", "box"], other: ["Other", "", "tag"],
};

export const kindChip = (k) => { const [l, c, i] = KINDS[k] || KINDS.other; return chip(l, c, i); };

export default {
  id: "threads", label: "Threads", icon: "link",

  async mount(ctx, params, root) {
    const all = await api.threads();
    const view = params.view || "open";
    const proposed = all.filter((t) => t.status === "proposed");
    const suggestions = all.filter((t) => t.suggestion && t.status === "open");
    const open = all.filter((t) => t.status === "open");
    const resolved = all.filter((t) => t.status === "resolved");

    ctx.side(h("h2", "Loose threads"),
      [["review", "To review", "feather", proposed.length + suggestions.length], ["open", "Open", "link", open.length], ["resolved", "Resolved", "circleCheck", resolved.length]].map(([id, label, ic, n]) =>
        h("button.side-item", { class: id === view ? "active" : "", onclick: () => ctx.go("threads", { view: id }) }, icon(ic), h("span.grow", h("span", label)), h("span.count", n))),
      h("div.stack.sm", { style: { padding: "14px 6px" } },
        btn("Add a thread", { icon: "plus", size: "sm", onclick: () => edit(ctx, null) }),
        aiOff() ? null : btn("Check past recaps", { icon: "search", size: "sm", onclick: () => scanPast(ctx) })));

    root.append(ctx.header({ title: "Loose threads", icon: "link",
      subtitle: `${open.length} open${proposed.length + suggestions.length ? ` · ${proposed.length + suggestions.length} waiting for review` : ""}`,
      actions: [aiOff() ? null : btn("Check past recaps", { icon: "search", onclick: () => scanPast(ctx) }),
        btn("Add a thread", { icon: "plus", kind: "primary", onclick: () => edit(ctx, null) })] }));

    // a running scan shows here, updating in place; the page refreshes when it finishes
    const scanBox = h("div");
    root.append(scanBox);
    let running = "";
    ctx.onState((st) => {
      const jobs = (st.tasks || []).filter((j) => j.kind === "threads");
      const ids = jobs.map((j) => j.id).join(",");
      if (running && !ids) { running = ""; return ctx.reload(); }
      if (ids !== running) { running = ids; clear(scanBox, jobs.map((j) => card({ title: "Checking past recaps" }, jobRow(j)))); return; }
      jobs.forEach((j) => { const el = scanBox.querySelector(`[data-job="${j.id}"]`); if (el) updateJobRow(el, j); });
    });

    const refresh = () => ctx.go("threads", { view });
    if (view === "review") {
      if (!proposed.length && !suggestions.length) return root.append(card(null, empty("feather", "Nothing to review", "When a recap is drafted, the threads it finds land here for you to accept or dismiss.")));
      root.append(h("div.stack",
        proposed.length ? card({ title: `New from the latest sessions (${proposed.length})`, actions: h("div.row",
          btn("Dismiss all", { size: "sm", kind: "ghost", onclick: async () => { if (await confirmBox("Dismiss all proposed threads?", "They're kept as dismissed, not deleted.", "Dismiss all")) { for (const t of proposed) await api.update_thread(t.id, { status: "dismissed" }); refresh(); } } }),
          btn("Accept all", { size: "sm", icon: "check", kind: "primary", onclick: async () => { for (const t of proposed) await api.update_thread(t.id, { status: "open" }); toast("Added to your threads", `${proposed.length} threads`, "good", "check"); refresh(); } })) },
        h("div.thread-list", proposed.map((t) => threadRow(ctx, t, [
          btn("Dismiss", { size: "sm", kind: "ghost", onclick: async () => { await api.update_thread(t.id, { status: "dismissed" }).catch(toastError); refresh(); } }),
          btn("Edit", { size: "sm", kind: "ghost", onclick: () => edit(ctx, t) }),
          btn("Accept", { size: "sm", icon: "check", kind: "primary", onclick: async () => { await api.update_thread(t.id, { status: "open" }).catch(toastError); refresh(); } }),
        ])))) : null,
        suggestions.length ? card({ title: `Updates to existing threads (${suggestions.length})` },
          h("div.thread-list", suggestions.map((t) => threadRow(ctx, t, [
            btn("Ignore", { size: "sm", kind: "ghost", onclick: async () => { await api.dismiss_suggestion(t.id).catch(toastError); refresh(); } }),
            btn(t.suggestion.type === "resolve" ? "Mark resolved" : "Add note", { size: "sm", icon: "check", kind: "primary", onclick: async () => { await api.accept_suggestion(t.id).catch(toastError); refresh(); } }),
          ], t.suggestion)))) : null));
      return;
    }
    const list = view === "resolved" ? resolved : open;
    if (!list.length) return root.append(card(null, empty("link", view === "resolved" ? "Nothing resolved yet" : "No open threads",
      view === "resolved" ? "Threads you close show up here." : "Add one yourself, or let them be found when a recap is drafted.",
      btn("Add a thread", { icon: "plus", kind: "primary", onclick: () => edit(ctx, null) }))));
    const sorted = [...list].sort((a, b) => (a.created || "").localeCompare(b.created || ""));
    root.append(card(null, h("div.thread-list", sorted.map((t) => threadRow(ctx, t, [
      btn("Edit", { size: "sm", kind: "ghost", onclick: () => edit(ctx, t) }),
      view === "resolved"
        ? btn("Reopen", { size: "sm", onclick: async () => { await api.update_thread(t.id, { status: "open" }).catch(toastError); refresh(); } })
        : btn("Resolve", { size: "sm", icon: "check", onclick: async () => { await api.update_thread(t.id, { status: "resolved" }).catch(toastError); toast("Resolved", t.title, "good", "check", 2000); refresh(); } }),
    ])))));
  },
};

function threadRow(ctx, t, actions, suggestion = null) {
  return h("div.thread",
    h("div.row.nowrap", { style: { alignItems: "flex-start" } },
      h("div.grow",
        h("div.row", { style: { gap: "8px", marginBottom: "4px" } }, kindChip(t.kind), h("b.thread-title", t.title)),
        t.detail ? h("div.small.muted", t.detail) : null,
        suggestion ? h("div.notice.small", { style: { marginTop: "8px" } }, icon(suggestion.type === "resolve" ? "circleCheck" : "feather"),
          h("div", h("b", suggestion.type === "resolve" ? "Looks resolved: " : "Progress: "), suggestion.note)) : null,
        (t.notes || []).length ? h("div.thread-notes", t.notes.map((n) => h("div.tiny.faint", `${n.date}: ${n.text}`))) : null,
        h("div.row.tiny.faint", { style: { gap: "6px", marginTop: "6px" } },
          (t.sessions || []).map((sid, i) => h("button.linkish.tiny", { onclick: () => ctx.go("sessions", { id: sid, tab: t.t && i === 0 ? "transcript" : "recap", t: i === 0 ? t.t : undefined }) },
            icon("scroll"), " ", (t.session_titles || [])[i] || sid, t.t && i === 0 ? ` · ${t.t}` : "")),
          t.created ? h("span", `added ${t.created}`) : null)),
      h("div.row.nowrap", actions)));
}

async function edit(ctx, t) {
  const title = h("input.input", { value: t?.title || "", placeholder: "e.g. The debt to the Thieves' Guild" });
  const detail = h("textarea.input", { value: t?.detail || "", placeholder: "What happened, and what's still open" });
  let kind = t?.kind || "hook";
  const ok = await modal(t ? "Edit thread" : "Add a thread", h("div.stack",
    h("div.field", h("label", "Title"), title),
    h("div.field", h("label", "Kind"), h("select.select", { onchange: (e) => { kind = e.target.value; } },
      Object.entries(KINDS).map(([k, [l]]) => h("option", { value: k, selected: k === kind }, l)))),
    h("div.field", h("label", "Details"), detail),
    t ? h("div", btn("Delete thread", { size: "sm", kind: "ghost danger", icon: "trash", onclick: async () => {
      if (!await confirmBox("Delete this thread?", "It's removed for good.", "Delete", true)) return;
      await api.delete_thread(t.id).catch(toastError);
      document.querySelectorAll(".scrim").forEach((x) => x.remove());
      ctx.go("threads", ctx.params);
    } })) : null),
  [{ label: "Cancel", kind: "ghost", value: false }, { label: "Save", kind: "primary", value: true }]);
  if (!ok || !title.value.trim()) return;
  try {
    if (t) await api.update_thread(t.id, { title: title.value.trim(), detail: detail.value.trim(), kind });
    else await api.add_thread(title.value.trim(), detail.value.trim(), kind);
    ctx.go("threads", ctx.params);
  } catch (e) { toastError(e); }
}

async function scanPast(ctx) {
  if (!aiReady()) { toast(...aiSetupHint(), "warn", "key"); return ctx.go("settings", { section: "claude" }); }
  let all;
  try { all = await api.scan_candidates(false); } catch (e) { return toastError(e); }
  if (!all.length) return toast("No recaps yet", "Sessions need a recap before they can be checked.", "", "info");
  const picks = new Set(all.filter((s) => !s.scanned).map((s) => s.id));
  const rows = h("div.stack.sm.scan-list");
  const draw = () => clear(rows, all.map((s) => h("label.check",
    h("input", { type: "checkbox", checked: picks.has(s.id), onchange: (e) => { e.target.checked ? picks.add(s.id) : picks.delete(s.id); count(); } }),
    h("span.grow", `Session ${s.number ?? "?"}: ${s.title}`),
    h("span.tiny.faint", s.scanned ? `checked ${s.scanned}` : "never checked"))));
  const counter = h("p.tiny.faint", { style: { margin: 0 } });
  const count = () => { counter.textContent = `${picks.size} recap${picks.size === 1 ? "" : "s"} selected. ${AI()} reads them oldest first, so later sessions can mark earlier threads as moved on or settled.${aiLocal() ? " Free with your local model." : " Each recap is a small call, usually a cent or two."}`; };
  draw(); count();
  const ok = await modal("Check past recaps for loose threads", h("div.stack",
    h("p.small.muted", { style: { margin: 0 } }, "New threads go to To review, like after a recap draft. Threads a later recap settles are filed as resolved, and your own open threads get suggested updates."),
    h("div.row", { style: { gap: "8px" } },
      h("button.linkish", { onclick: () => { all.forEach((s) => picks.add(s.id)); draw(); count(); } }, "Select all"),
      h("button.linkish", { onclick: () => { picks.clear(); all.filter((s) => !s.scanned).forEach((s) => picks.add(s.id)); draw(); count(); } }, "Only never checked"),
      h("button.linkish", { onclick: () => { picks.clear(); draw(); count(); } }, "None")),
    rows, counter),
  [{ label: "Cancel", kind: "ghost", value: false }, { label: "Check them", kind: "primary", icon: "search", value: true }]);
  if (!ok || !picks.size) return;
  try {
    await api.scan_threads([...picks]);
    toast("Checking past recaps", "New threads will appear under To review.", "", "search", 5000);
    ctx.go("threads", { view: "review" });
  } catch (e) { toastError(e); }
}
