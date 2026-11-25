// Settings: small helpers several sections use.
import { api } from "../../api.js";
import { h, btn, card, toast, toastError, clear } from "../../dom.js";
import { icon } from "../../icons.js";
import { about } from "./about.js";

// ---------------------------------------------------------------------------
export const saveKey = (ctx, k, msg = "Saved") => (v) => ctx.saveSettings({ [k]: v }).then(() => toast(msg, "", "good", "check", 1500)).catch(toastError);

export function secretInput(ctx, key, placeholder) {
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

export function partyCard(ctx) {
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

export function spellingsCard(ctx) {
  const box = h("div.stack.sm");
  const draw = async () => {
    const sp = await api.spellings().catch(() => ({}));
    const entries = Object.entries(sp);
    clear(box, entries.length ? h("div.row", { style: { gap: "8px" } }, entries.map(([wrong, right]) =>
      h("span.tag", h("s.faint", wrong), " → ", h("b", { style: { color: "var(--text)" } }, right),
        h("button.linkish.danger", { title: "Forget", onclick: async () => { delete sp[wrong]; await api.save_spellings(sp).catch(toastError); draw(); } }, " ✕"))))
      : h("p.small.faint", { style: { margin: 0 } }, "None yet. Use Fix names on a session's recap to add them."));
  };
  const notBox = h("div.stack.sm");
  const drawNot = async () => {
    const words = await api.not_names().catch(() => []);
    clear(notBox, words.length ? h("div.row", { style: { gap: "8px" } }, words.map((w) =>
      h("span.tag", w, h("button.linkish.danger", { title: "Suggest it again", onclick: async () => { await api.save_not_names(words.filter((x) => x !== w)).catch(toastError); drawNot(); } }, " ✕"))))
      : h("p.small.faint", { style: { margin: 0 } }, "None yet. Untick a suggestion in Fix names to add it."));
  };
  draw(); drawNot();
  return card({ title: "Name spellings" }, h("p.small.muted", { style: { marginTop: 0 } }, "Corrections you've asked Lore Studio to remember. They help the transcriber, fix new transcripts and guide recap drafts."), box,
    h("p.small.muted", { style: { margin: "14px 0 0" } }, "Not names: words Fix names won't suggest again."), notBox);
}
