// Sessions: the list, and one session's recap (with Claude drafts), transcript (with the recording and OBS),
// HTML notes and files.
import { api } from "../api.js";
import { checklistCard, checklistOn } from "../checklist.js";
import { h, btn, card, chip, clear, empty, toast, toastError, promptBox, modal } from "../dom.js";
import { icon } from "../icons.js";
import { suggestedChips, suggestTags } from "./lore.js";
import { pickDate } from "./calendar.js";
import { AI, aiOff } from "../ai.js";
import { updateJobRow } from "./sessions/helpers.js";
import { recapTab } from "./sessions/recap.js";
import { transcriptTab } from "./sessions/transcript.js";
import { planTab } from "./sessions/plan.js";
import { filesTab } from "./sessions/files.js";
export { jobRow, updateJobRow } from "./sessions/helpers.js";   // used by Home and Threads

const STATUS = {
  planned: ["Planned", "info", "edit"],
  played: ["Played", "warn", "play"],
  transcribed: ["Transcribed", "accent", "file"],
  recapped: ["Recapped", "good", "circleCheck"],
};

export function sessionChip(status) {
  const [label, kind, ic] = STATUS[status] || [status, "", null];
  return chip(label, kind, ic);
}

export default {
  id: "sessions", label: "Sessions", icon: "scroll",

  async mount(ctx, params, root) {
    const list = await api.sessions();
    const create = async () => {
      const title = await promptBox("New session", "Session title", "");
      if (title == null) return;
      try { ctx.go("sessions", { id: await api.new_session(title || "Untitled session") }); } catch (e) { toastError(e); }
    };
    ctx.side(
      h("h2", "Sessions"),
      h("div", { style: { padding: "0 6px 12px" } }, btn("New session", { icon: "plus", kind: "primary", size: "sm", onclick: create })),
      [...list].reverse().map((s) => h("button.side-item", { class: s.id === params.id ? "active" : "", onclick: () => ctx.go("sessions", { id: s.id }) },
        h("span.sess-num.nums", s.number ?? "·"),
        h("span.grow", h("span", s.title), h("span.sub", s.has_draft ? "Draft ready" : STATUS[s.status]?.[0] || s.status)))));

    if (!params.id) return overview(ctx, root, list, create);
    return sessionView(ctx, root, params);
  },
};

function overview(ctx, root, list, create) {
  root.append(ctx.header({ title: "Sessions", subtitle: `${list.length} sessions in ${ctx.boot.campaign.name}`, icon: "scroll",
    actions: [aiOff() ? null : btn("", { icon: "sparkle", title: "Suggest tags for sessions with AI", onclick: () => suggestTags(ctx, "session:") }),
      btn("New session", { icon: "plus", kind: "primary", onclick: create })].filter(Boolean) }));
  if (!list.length) return root.append(card(null, empty("scroll", "No sessions yet", "", btn("New session", { icon: "plus", kind: "primary", onclick: create }))));
  root.append(card(null, h("div.list", [...list].reverse().map((s) =>
    h("div.list-row.click", { onclick: () => ctx.go("sessions", { id: s.id }) },
      h("div.ic", h("b.nums", s.number ?? "·")),
      h("div.main-col", h("div.title", s.title, s.tags?.length ? h("span.faint.small", " ", s.tags.map((t) => "#" + t).join(" ")) : null), h("div.meta", [s.date_label || s.date, s.in_world_date, s.has_html ? "HTML notes" : null, s.source === "legendkeeper" ? "from LegendKeeper" : null].filter(Boolean).join(" · "))),
      s.has_draft ? chip("Draft ready", "accent", "feather") : null,
      sessionChip(s.status))))));
}

async function sessionView(ctx, root, params) {
  let s = await api.session_full(params.id);
  const tab = params.tab || (s.recap || s.draft ? "recap" : s.transcript || s.recording?.path || s.recording?.live ? "transcript" : s.html_url ? "notes" : "recap");
  const names = ctx.boot.settings.auto_link !== false ? await ctx.linkNames() : [];

  const head = ctx.header({ title: `Session ${s.number ?? ""}: ${s.title}`, subtitle: [STATUS[s.status]?.[0], s.date_label || s.date, s.in_world_date].filter(Boolean).join(" · "), icon: "scroll",
    actions: [
      btn("", { icon: "edit", title: "Rename or renumber", onclick: () => editDetails(ctx, s) }),
      btn("", { icon: "folder", title: "Open the session folder", onclick: () => api.open_folder(s.path).catch(toastError) }),
    ] });
  const tabs = h("div.tabs", [["recap", "Recap"], ["transcript", "Transcript"], ["notes", "Plan"], ["files", "Files"]].map(([id, label]) =>
    h("button", { class: id === tab ? "on" : "", onclick: () => ctx.go("sessions", { id: s.id, tab: id }) }, label,
      id === "recap" && s.draft ? h("span.tab-dot") : null)));
  const body = h("div");
  const tagRow = h("div.row.wrap.sess-tags", { style: { gap: "6px", margin: "-6px 0 14px" } },
    s.tags?.length ? s.tags.map((t) => h("button.tag.click", { title: "Pages and sessions with this tag", onclick: () => ctx.go("lore", { q: "#" + t }) }, "#" + t))
      : h("span.small.faint", "No tags"),
    h("button.linkish.small", { onclick: () => editTags(ctx, s) }, s.tags?.length ? "Edit tags" : "Add tags"),
    aiOff() ? null : h("button.linkish.small", { title: "Suggest tags with AI", onclick: () => suggestTags(ctx, "session:" + s.id) }, icon("sparkle"), " Suggest"),
    suggestedChips(ctx, "session:" + s.id));
  root.append(head, tagRow, tabs, body);

  // time chips in recaps jump to the transcript
  body.addEventListener("click", (e) => {
    const c = e.target.closest(".tchip");
    if (c) { e.preventDefault(); ctx.go("sessions", { id: s.id, tab: "transcript", t: c.dataset.t }); }
  });
  // Jobs for this session update their rows in place. When the set of jobs changes (one finished, or a new one
  // started, like an automatic recap after transcription), reload once, keeping the scroll position.
  const key = (list) => list.map((j) => j.id).sort().join(",");
  let shown = key(s.jobs);
  ctx.onState((st) => {
    const mine = (st.tasks || []).filter((j) => j.session === s.id);
    if (key(mine) !== shown) {
      shown = key(mine);
      ctx.reload();
      return;
    }
    body.querySelectorAll("[data-job]").forEach((el) => {
      const j = mine.find((x) => x.id === el.dataset.job);
      if (j) updateJobRow(el, j);
    });
  });

  if (tab === "recap") recapTab(ctx, body, s, names);
  else if (tab === "transcript") transcriptTab(ctx, body, s, params);
  else if (tab === "notes") {
    const inner = h("div");
    if (checklistOn(ctx) && s.status === "planned") {
      const c = await checklistCard(ctx, s.id);
      if (c) body.append(h("div", { style: { marginBottom: "16px" } }, c));
    }
    body.append(inner);
    await planTab(ctx, inner, s);
  }
  else filesTab(ctx, body, s);
}

const asTags = (v) => v.split(",").map((x) => x.trim().replace(/^#/, "").toLowerCase().replace(/\s+/g, "-")).filter(Boolean);

async function editTags(ctx, s) {
  const tags = h("input.input", { value: (s.tags || []).join(", "), placeholder: "heist, westmarch, combat" });
  const r = await modal("Session tags", h("div.field", h("label", "Tags"), tags,
    h("div.help", "Comma-separated.")),
  [{ label: "Cancel", kind: "ghost", value: false }, { label: "Save", kind: "primary", value: true }]);
  if (!r) return;
  try { await api.update_session(s.id, { tags: asTags(tags.value) }); ctx.reload(); } catch (e) { toastError(e); }
}

async function editDetails(ctx, s) {
  const title = h("input.input", { value: s.title });
  const number = h("input.input.nums", { value: s.number ?? "", type: "number", min: 0 });
  const date = h("input.input", { value: s.date || "", type: "date" });
  const dateEnd = h("input.input", { value: s.date_end || "", type: "date", title: "Leave empty for a single day" });
  const world = h("input.input", { value: s.in_world_date || "", placeholder: "e.g. 3rd of Deepwinter, 1042, or 3rd – 5th of Deepwinter" });
  const tags = h("input.input", { value: (s.tags || []).join(", "), placeholder: "heist, westmarch, combat" });
  const calInfo = await api.calendar().catch(() => ({}));
  let worldDate = s.world_date || null, worldEnd = s.world_date_end || null, worldChanged = false;
  const rangeText = async () => { world.value = await api.calendar_format_range(worldDate, worldEnd); };
  const pickBtn = calInfo.cal ? btn("", { icon: "calendar", title: "Pick the (first) day on the calendar", onclick: async () => {
    const d = await pickDate(calInfo.cal, worldDate || calInfo.cal.current, "In-world date");
    if (!d) return;
    worldDate = d; worldChanged = true;
    await rangeText();
  } }) : null;
  const endBox = h("div.row.nowrap", { style: { gap: "6px" } });
  const drawEnd = async () => clear(endBox, worldEnd
    ? [h("span.small", "Until ", h("b", await api.calendar_format(worldEnd))),
       h("button.linkish.small", { onclick: async () => { worldEnd = null; worldChanged = true; drawEnd(); await rangeText(); } }, "Make it one day")]
    : h("button.linkish.small", { onclick: async () => {
        if (!worldDate) return toast("Pick the first day first", "", "warn", "alert");
        const d = await pickDate(calInfo.cal, worldDate, "Last in-world day");
        if (!d) return;
        worldEnd = d; worldChanged = true; drawEnd(); await rangeText();
      } }, "+ Covers several days"));
  if (calInfo.cal) drawEnd();
  const r = await modal("Session details", h("div.stack",
    h("div.grid.c2", h("div.field", h("label", "Title"), title), h("div.field", h("label", "Number"), number)),
    h("div.grid.c2",
      h("div.field", h("label", "Played on"), h("div.row.nowrap", { style: { gap: "6px" } }, date, h("span.faint", "to"), dateEnd),
        h("div.help", "Leave the second date empty for a single day.")),
      h("div.field", h("label", "In-world date"), pickBtn ? h("div.row.nowrap", { style: { gap: "6px" } }, world, pickBtn) : world,
        calInfo.cal ? endBox : h("div.help", "A date or range, any format."))),
    h("div.field", h("label", "Tags"), tags, h("div.help", "Comma-separated."))),
  [{ label: "Cancel", kind: "ghost", value: false }, { label: "Save", kind: "primary", value: true }]);
  if (!r) return;
  try {
    if (dateEnd.value && date.value && dateEnd.value < date.value) return toast("The end is before the start", "Swap the played-on dates, or clear the second one.", "warn", "alert");
    if (worldChanged) await api.set_session_world_date(s.id, worldDate, worldEnd);
    await api.update_session(s.id, { title: title.value.trim() || s.title, number: number.value === "" ? null : Number(number.value), date: date.value,
      date_end: date.value && dateEnd.value > date.value ? dateEnd.value : "", in_world_date: world.value.trim(), tags: asTags(tags.value) });
    ctx.go("sessions", { id: s.id });
  } catch (e) { toastError(e); }
}
