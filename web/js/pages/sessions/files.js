// Sessions → Files tab: what's in the session folder, and the Foundry log.
import { api } from "../../api.js";
import { h, btn, card, clear, toastError, confirmBox } from "../../dom.js";
import { icon } from "../../icons.js";

export function filesTab(ctx, body, s) {
  clear(body, card({ title: "Session folder", actions: btn("Open folder", { icon: "folder", size: "sm", onclick: () => api.open_folder(s.path).catch(toastError) }) },
    h("p.small.faint.mono", s.path),
    h("div.list", s.files.map((f) => h("div.list-row", h("div.ic", icon("file")), h("div.main-col", h("div.title", f))))),
    h("hr.soft"),
    h("div.row", { style: { marginTop: "10px" } },
      btn("Delete session", { icon: "trash", kind: "danger", size: "sm", onclick: async () => {
        if (!await confirmBox("Delete this session?", "It's moved to the campaign's .trash folder, so you can still get it back. The recording file itself is never touched.", "Delete", true)) return;
        try { await api.delete_session(s.id); ctx.go("sessions"); } catch (e) { toastError(e); }
      } }))));
  if (s.files.includes("foundry-log.jsonl")) foundryLogCard(body, s).catch(toastError);
}

async function foundryLogCard(body, s) {
  const events = await api.foundry_log(s.id);
  const line = (ev) => {
    const who = ev.speaker || ev.author || "";
    if (ev.type === "roll") return `${who} rolled ${(ev.rolls || []).map((r) => `${r.formula} = ${r.total}`).join(", ")}${ev.flavor ? ` (${ev.flavor})` : ""}`;
    if (ev.type === "chat") return `${who}: ${ev.text || ""}`;
    if (ev.type === "combat") return `Round ${ev.round}: ${ev.combatant || "turn " + ev.turn}`;
    if (ev.type === "scene") return `Scene: ${ev.scene}`;
    return ev.type;
  };
  body.append(card({ title: `From Foundry · ${events.length} event${events.length === 1 ? "" : "s"}` },
    h("p.small.muted", { style: { margin: "0 0 8px" } }, "Rolls, chat and combat turns logged while this session was live. They're used when drafting the recap."),
    h("div.foundry-log", events.slice(-200).reverse().map((ev) =>
      h("div.foundry-ev", h("span.mono.faint", (ev.time || "").slice(11, 19)), h("span.chip", ev.type), h("span", line(ev)))))));
}
