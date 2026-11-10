// Before-session checklist: reminders to tick off before a session (Settings → Campaign turns it on).
// Reminders for every session belong to the campaign; ticks and one-off reminders belong to each session.
import { api } from "./api.js";
import { h, btn, card, modal, toastError } from "./dom.js";

export const checklistOn = (ctx) => !!ctx.boot.settings.checklist_on && !!ctx.boot.campaign;

/** The interactive list for one session. onChange(state) runs after every tick, add or delete. */
export function checklistList(sid, state, { onChange, editable = true } = {}) {
  const wrap = h("div.checklist");
  const draw = (st) => {
    state = st;
    wrap.replaceChildren(...[
      ...st.items.map((it) => h("div.cl-row", { class: it.done ? "done" : "" },
        h("label.check.grow", h("input", { type: "checkbox", checked: it.done, onchange: (e) => set(it, e.target.checked) }),
          h("span.cl-text", it.text), it.once ? h("span.cl-once", { title: "Only for this session" }, "this session") : null),
        editable ? btn("", { icon: "x", size: "sm", kind: "ghost", title: it.once ? "Remove this reminder" : "Remove from every session",
          onclick: () => del(it) }) : null)),
      !st.items.length ? h("p.small.muted", { style: { margin: "2px 0" } }, "Nothing on the list yet.") : null,
      editable ? addRow() : null].filter(Boolean));
  };
  const done = (st) => { draw(st); onChange?.(st); };
  const set = (it, v) => api.checklist_toggle(sid, it.id, v).then(done).catch(toastError);
  const del = async (it) => {
    if (!it.once && !await modal("Remove this reminder?", h("p", `"${it.text}" will be removed from every session's checklist.`),
      [{ label: "Cancel", kind: "ghost", value: false }, { label: "Remove", kind: "danger", value: true }])) return;
    api.checklist_remove(sid, it.id).then(done).catch(toastError);
  };
  const addRow = () => {
    let every = false;
    const inp = h("input.input", { placeholder: "Add a reminder…", onkeydown: (e) => { if (e.key === "Enter") go(); } });
    const scope = h("select.select.cl-scope", { title: "Who gets this reminder", onchange: (e) => { every = e.target.value === "every"; } },
      h("option", { value: "once" }, "This session"), h("option", { value: "every" }, "Every session"));
    const go = () => {
      const text = inp.value.trim();
      if (!text) return inp.focus();
      api.checklist_add(sid, text, every).then((st) => { done(st); wrap.querySelector(".cl-add input")?.focus(); }).catch(toastError);
    };
    return h("div.row.cl-add", inp, scope, btn("", { icon: "plus", size: "sm", title: "Add", onclick: go }));
  };
  draw(state);
  return wrap;
}

export const progressText = (st) => !st.total ? "" : st.left ? `${st.total - st.left} of ${st.total} done` : "All done";

/** The checklist as a card (Plan tab and Home). */
export async function checklistCard(ctx, sid, { title = "Before the session" } = {}) {
  let st;
  try { st = await api.checklist(sid); } catch (e) { return null; }
  const prog = h("span.small.muted", progressText(st));
  return card({ title, actions: h("div.row", prog,
    h("button.linkish", { onclick: () => ctx.go("settings", { section: "campaign" }) }, "Edit list")) },
  checklistList(sid, st, { onChange: (s2) => { prog.textContent = progressText(s2); } }));
}

/** Going live with things still unticked: a gentle reminder, once per session per run of the app. */
const asked = new Set();
export async function remindBeforeLive(ctx, sid) {
  if (!checklistOn(ctx) || asked.has(sid)) return;
  asked.add(sid);
  let st;
  try { st = await api.checklist(sid); } catch { return; }
  if (!st.left) return;
  await modal("Before you start", h("div.stack.sm",
    h("p.small.muted", { style: { margin: 0 } }, `${st.left} thing${st.left === 1 ? "" : "s"} left on your checklist.`),
    checklistList(sid, st, { editable: false })),
  [{ label: "Start the session", kind: "primary", value: true }]);
}
