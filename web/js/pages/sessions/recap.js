// Sessions → Recap tab: the GM and player recaps, AI drafts and name fixes.
import { api } from "../../api.js";
import { h, btn, card, clear, empty, toast, toastError, confirmBox, modal } from "../../dom.js";
import { icon } from "../../icons.js";
import { switchEl, seg } from "../../components.js";
import { render } from "../../markdown.js";
import { postToDiscord } from "../discordpost.js";
import { sendToFoundry } from "../lore.js";
import { AI, aiName, aiPossessive, aiReady, aiLocal, aiOff } from "../../ai.js";
import { money, jobRow } from "./helpers.js";

export function recapTab(ctx, body, s, names) {
  const hasKey = aiReady();
  const off = aiOff();
  const job = s.jobs.find((j) => j.kind === "recap");

  const draftWithClaude = async () => {
    if (!hasKey) { toast(...aiSetupHint(), "warn", "key"); return ctx.go("settings", { section: "claude" }); }
    try {
      const est = await api.recap_estimate(s.id);
      const ok = await confirmBox(`Draft this recap with ${aiName()}?`, est.local
        ? `${AI()} (${est.model.replace(/^local:/, "")}) reads the transcript (about ${Math.round(est.transcript_tokens / 1000)}k tokens) and up to ${est.lore_pages} matching lore pages, then writes a GM recap, a player recap and loose threads.`
          + (est.condense_parts ? ` The transcript is bigger than the model's ${Math.round(est.context / 1000)}k-token context, so it's condensed into notes first, in about ${est.condense_parts} parts.` : "")
          + ` About ${est.calls} calls.`
        : `Claude reads the transcript (about ${Math.round(est.transcript_tokens / 1000)}k tokens) and ${est.lore_pages} matching lore pages, then writes a GM recap, a player recap and loose threads: ${est.calls} calls with ${est.model}, roughly ${Math.round(est.input_tokens / 1000)}k tokens in and up to ${Math.round(est.output_tokens / 1000)}k out.`
          + (est.cost != null ? ` Estimated cost: about ${money(est.cost)} of API credit.` : " (No price list for this model, so no cost estimate.)")
          + "", "Draft it");
      if (!ok) return;
      await api.draft_recap(s.id);
      toast(`${AI()} is writing`, aiLocal() ? "This can take a while." : "This takes a minute or two.", "", "feather");
      ctx.go("sessions", { id: s.id, tab: "recap" });
    } catch (e) { toastError(e); }
  };

  const parts = [];
  if (job && !off) parts.push(card({ title: `${AI()} is drafting` }, jobRow(job)));
  const notes = h("textarea.input", { value: s.claude_notes || "", rows: 3,
    placeholder: "Anything the recording missed" });
  const saveNotes = btn("Save notes", { icon: "save", size: "sm", onclick: async () => {
    try { await api.update_session(s.id, { claude_notes: notes.value }); s.claude_notes = notes.value; toast("Notes saved", "They're used in the next draft.", "good", "check", 2500); } catch (e) { toastError(e); }
  } });
  const notesCard = card({ title: "Notes for the recap", actions: saveNotes }, notes,
    h("p.tiny.faint", { style: { margin: "var(--s2) 0 0" } }, `${AI()} treats these as true and works them into both recaps and the loose threads. They're never posted anywhere.`));
  if (s.draft && !off) parts.push(draftCard(ctx, s, names));

  const gmCard = card({ title: "Recap", actions: h("div.row",
    s.transcript && !job && !off ? btn(s.draft ? "Redo the draft" : `Draft with ${aiLocal() ? "local model" : "Claude"}`, { icon: "feather", size: "sm", kind: s.recap || s.draft ? "" : "primary", onclick: draftWithClaude }) : null,
    s.recap.trim() ? btn("Fix names", { icon: "rename", size: "sm", kind: "ghost", onclick: () => fixNames(ctx, s) }) : null,
    btn("Edit", { icon: "edit", size: "sm", onclick: () => editText(ctx, s, "recap", s.recap) })) },
  s.recap.trim() ? render(s.recap, { autoLink: true, linkNames: names })
    : empty("feather", "No recap yet", off ? "Write it yourself, from your notes or the transcript." : s.transcript ? `Let ${aiName()} draft one from the transcript, or write it yourself.` : "Write one, or transcribe the session to draft one.",
      h("div.row", { style: { justifyContent: "center" } },
        s.transcript && !off ? btn(`Draft with ${aiLocal() ? "local model" : "Claude"}`, { icon: "feather", kind: "primary", onclick: draftWithClaude }) : null,
        btn("Write it myself", { icon: "edit", onclick: () => editText(ctx, s, "recap", "") }))));
  parts.push(gmCard);
  if (!off) parts.splice(parts.indexOf(gmCard), 0, notesCard);

  const playerText = s.player_recap || "";
  parts.push(card({ title: "For the players", actions: h("div.row",
    btn("Edit", { icon: "edit", size: "sm", kind: "ghost", onclick: () => editText(ctx, s, "player", playerText) }),
    btn("Send to Foundry", { icon: "dice", size: "sm", kind: "ghost", onclick: () => sendToFoundry(() => api.foundry_send_recap(s.id), "Recap") }),
    btn("Post to Discord", { icon: "share", size: "sm", kind: "primary", onclick: () => postToDiscord(ctx, s, playerText || s.recap) })) },
  playerText.trim() ? render(playerText, { autoLink: true, linkNames: names, playerView: true, hideTimes: true })
    : h("p.small.muted", { style: { margin: 0 } }, off ? "No player recap. Discord posts use the recap above, minus GM-only blocks." : "No player recap. Discord posts use the recap above, minus GM-only blocks."),
  s.discord_posts.length ? h("div.tiny.faint", { style: { marginTop: "var(--s3)" } }, "Posted: " + s.discord_posts.map((p) => `${p.channel} on ${p.date}`).join(", ")) : null));

  clear(body, h("div.stack", parts));
}

function draftCard(ctx, s, names) {
  const d = s.draft;
  let which = d.gm ? "gm" : "player";
  const texts = { gm: d.gm || "", player: d.player || "" };
  let editing = false;
  const view = h("div");
  const usage = (d.usage || []).reduce((a, u) => ({ i: a.i + u.input + u.cache_read + u.cache_write, o: a.o + u.output }), { i: 0, o: 0 });

  const draw = () => {
    if (editing) {
      const ta = h("textarea.input.editor.short", { value: texts[which], oninput: (e) => { texts[which] = e.target.value; } });
      clear(view, ta);
      ta.focus();
    } else {
      clear(view, texts[which].trim() ? render(texts[which], { autoLink: true, linkNames: names, playerView: which === "player", hideTimes: which === "player" })
        : h("p.muted.small", "This part wasn't written."));
    }
  };
  const cutNote = h("div");
  const drawCut = () => clear(cutNote, (d.truncated || []).includes(which) ? h("div.notice.warn.small", icon("alert"),
    h("div.grow", h("b", "This part was cut short. "), aiLocal() ? "The model hit its length limit before finishing. A bigger context size (Settings → AI) gives it more room." : "Claude hit the length limit before finishing."),
    btn("Write this part again", { size: "sm", icon: "refresh", onclick: async () => {
      try { await api.draft_recap(s.id, [which]); toast(`${AI()} is rewriting it`, "", "", "feather"); ctx.go("sessions", { id: s.id, tab: "recap" }); } catch (e) { toastError(e); }
    } })) : null);
  const switcher = seg([["gm", "GM recap", "lock"], ["player", "Player recap", "eye"]], which, (v) => { which = v; draw(); drawCut(); });
  drawCut();
  const editBtn = btn("Edit", { icon: "edit", size: "sm", kind: "ghost", onclick: () => { editing = !editing; editBtn.lastChild.textContent = editing ? "Preview" : "Edit"; draw(); } });
  draw();
  const el = card({ title: `${aiPossessive()} draft`, actions: h("div.row",
    btn("Fix names", { icon: "rename", size: "sm", kind: "ghost", onclick: () => fixNames(ctx, s) }),
    editBtn,
    btn("Discard", { icon: "trash", size: "sm", kind: "ghost", onclick: async () => {
      if (!await confirmBox("Discard the draft?", "Your current recap stays as it is.", "Discard", true)) return;
      await api.discard_draft(s.id).catch(toastError);
      ctx.go("sessions", { id: s.id, tab: "recap" });
    } }),
    btn("Accept", { icon: "check", size: "sm", kind: "primary", onclick: async () => {
      if (s.recap.trim() && !await confirmBox("Replace the current recap?", "The current recap is kept as recap.previous.md in the session folder.", "Replace")) return;
      try { await api.accept_draft(s.id, texts.gm || null, texts.player || null); toast("Recap saved", "", "good", "check"); ctx.links = null; ctx.go("sessions", { id: s.id, tab: "recap" }); } catch (e) { toastError(e); }
    } })) },
  h("div.stack.sm",
    h("div.row", switcher, h("div.spacer"),
      d.threads ? h("button.linkish", { onclick: () => ctx.go("threads") }, `${d.threads.new} new loose thread${d.threads.new === 1 ? "" : "s"}${d.threads.suggestions ? `, ${d.threads.suggestions} update${d.threads.suggestions === 1 ? "" : "s"}` : ""} →`) : null),
    cutNote,
    (d.warnings || []).length ? h("div.notice.warn.small", icon("alert"), h("div.grow", d.warnings[0])) : null,
    view,
    h("div.tiny.faint", `${String(d.model || "").replace(/^local:/, "")} · ${d.created}${usage.i ? ` · ${Math.round(usage.i / 1000)}k tokens in, ${Math.round(usage.o / 1000)}k out` : ""}${d.cost ? ` · about ${money(d.cost)}` : ""}. Time markers jump to the transcript.`)));
  el.classList.add("draft-card");
  return el;
}

async function fixNames(ctx, s) {
  let sugg = [];
  try { sugg = await api.suggest_name_fixes(s.id); } catch { /* suggestions are optional */ }
  const rows = sugg.map(([wrong, right, n]) => ({ wrong, right, on: true, n }));
  rows.push({ wrong: "", right: "", on: true });
  let transcript = !!s.transcript, remember = true;
  const list = h("div.stack.sm");
  const draw = () => clear(list,
    h("div.fix-row.head", h("span"), h("span", "Written as"), h("span"), h("span", "Should be"), h("span")),
    rows.map((r, i) => h("div.fix-row",
      h("input", { type: "checkbox", checked: r.on, onchange: (e) => { r.on = e.target.checked; } }),
      h("input.input", { value: r.wrong, placeholder: "Talia", oninput: (e) => { r.wrong = e.target.value; if (i === rows.length - 1 && r.wrong) { rows.push({ wrong: "", right: "", on: true }); draw(); list.querySelectorAll(".fix-row:not(.head) input.input")[i * 2].focus(); } } }),
      icon("right"),
      h("input.input", { value: r.right, placeholder: "Thalia", oninput: (e) => { r.right = e.target.value; } }),
      h("span.tiny.faint.nums", r.n ? `${r.n}×` : ""))));
  draw();
  const ok = await modal("Fix names", h("div.stack",
    sugg.length ? h("p.small.muted", { style: { margin: 0 } }, "Possible misspellings of known names. Untick any that aren't.")
      : h("p.small.muted", { style: { margin: 0 } }, "Wrong spelling, then the right one. Whole words only."),
    list,
    h("div.stack.sm",
      s.transcript ? switchEl(transcript, (v) => { transcript = v; }, "Also fix the transcript") : null,
      switchEl(remember, (v) => { remember = v; }, "Remember these (and don't suggest unticked ones again)"))),
  [{ label: "Cancel", kind: "ghost", value: false }, { label: "Fix them", kind: "primary", icon: "check", value: true }]);
  if (!ok) return;
  const pairs = rows.filter((r) => r.on && r.wrong.trim() && r.right.trim() && r.wrong.trim() !== r.right.trim()).map((r) => [r.wrong.trim(), r.right.trim()]);
  const ignore = remember ? rows.filter((r) => r.n && !r.on).map((r) => r.wrong.trim()).filter(Boolean) : [];   // unticked suggestions
  if (!pairs.length && !ignore.length) return;
  try {
    const r = await api.fix_names(s.id, pairs, transcript, remember, ignore);
    if (!pairs.length) { toast("Got it", `${ignore.join(", ")} won't be suggested again.`, "good", "check"); return; }
    const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
    toast(total ? `Fixed ${total} name${total === 1 ? "" : "s"}` : "No matches found", Object.entries(r.counts).map(([k, v]) => `${k} ×${v}`).join(", "), total ? "good" : "", "check");
    ctx.go("sessions", { id: s.id, tab: ctx.params.tab || "recap" });
  } catch (e) { toastError(e); }
}

async function editText(ctx, s, which, value) {
  const ta = h("textarea.input.editor", { value, spellcheck: true });
  setTimeout(() => ta.focus(), 50);
  const ok = await modal(which === "player" ? "Edit the player recap" : "Edit the recap",
    h("div.stack.sm", ta, h("p.tiny.faint", { style: { margin: 0 } }, "Markdown. [[Page name]] links a page.")),
    [{ label: "Cancel", kind: "ghost", value: false }, { label: "Save", kind: "primary", icon: "save", value: true }], { wide: true });
  if (!ok) return;
  try {
    if (which === "player") await api.save_player_recap(s.id, ta.value);
    else await api.save_session_text(s.id, "recap", ta.value);
    toast("Saved", "", "good", "check", 1500);
    ctx.go("sessions", { id: s.id, tab: "recap" });
  } catch (e) { toastError(e); }
}

// ---- transcript & recording ------------------------------------------------------
