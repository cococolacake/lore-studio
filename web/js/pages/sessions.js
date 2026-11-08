// Sessions: the list, and one session's recap (with Claude drafts), transcript (with the recording and OBS),
// HTML notes and files.
import { api } from "../api.js";
import { h, btn, card, chip, clear, empty, toast, toastError, promptBox, confirmBox, modal, fmtDuration } from "../dom.js";
import { icon } from "../icons.js";
import { pathInput, switchEl, seg } from "../components.js";
import { render } from "../markdown.js";
import { postToDiscord } from "./discordpost.js";
import { sendToFoundry } from "./lore.js";

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

const hms = (sec) => { sec = Math.max(0, Math.floor(sec || 0)); return `${String(Math.floor(sec / 3600)).padStart(2, "0")}:${String(Math.floor(sec % 3600 / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`; };
const money = (usd) => (usd < 0.01 ? "under 1¢" : usd < 1 ? `${Math.round(usd * 100)}¢` : `$${usd.toFixed(2)}`);
const toSec = (t) => t.split(":").reduce((a, b) => a * 60 + Number(b), 0);

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
    actions: [btn("New session", { icon: "plus", kind: "primary", onclick: create })] }));
  if (!list.length) return root.append(card(null, empty("scroll", "No sessions yet", "Create a session to plan it, record it, and keep its recap.", btn("New session", { icon: "plus", kind: "primary", onclick: create }))));
  root.append(card(null, h("div.list", [...list].reverse().map((s) =>
    h("div.list-row.click", { onclick: () => ctx.go("sessions", { id: s.id }) },
      h("div.ic", h("b.nums", s.number ?? "·")),
      h("div.main-col", h("div.title", s.title), h("div.meta", [s.date, s.in_world_date, s.has_html ? "HTML notes" : null, s.source === "legendkeeper" ? "from LegendKeeper" : null].filter(Boolean).join(" · "))),
      s.has_draft ? chip("Draft ready", "accent", "feather") : null,
      sessionChip(s.status))))));
}

async function sessionView(ctx, root, params) {
  let s = await api.session_full(params.id);
  const tab = params.tab || (s.recap || s.draft ? "recap" : s.transcript || s.recording?.path || s.recording?.live ? "transcript" : s.html_url ? "notes" : "recap");
  const names = ctx.boot.settings.auto_link !== false ? await ctx.linkNames() : [];

  const head = ctx.header({ title: `Session ${s.number ?? ""}: ${s.title}`, subtitle: [STATUS[s.status]?.[0], s.date, s.in_world_date].filter(Boolean).join(" · "), icon: "scroll",
    actions: [
      btn("", { icon: "edit", title: "Rename or renumber", onclick: () => editDetails(ctx, s) }),
      btn("", { icon: "folder", title: "Open the session folder", onclick: () => api.open_folder(s.path).catch(toastError) }),
    ] });
  const tabs = h("div.tabs", [["recap", "Recap"], ["transcript", "Transcript"], ["notes", "Plan"], ["files", "Files"]].map(([id, label]) =>
    h("button", { class: id === tab ? "on" : "", onclick: () => ctx.go("sessions", { id: s.id, tab: id }) }, label,
      id === "recap" && s.draft ? h("span.tab-dot") : null)));
  const body = h("div");
  root.append(head, tabs, body);

  // time chips in recaps jump to the transcript
  body.addEventListener("click", (e) => {
    const c = e.target.closest(".tchip");
    if (c) { e.preventDefault(); ctx.go("sessions", { id: s.id, tab: "transcript", t: c.dataset.t }); }
  });
  // when a job for this session finishes, reload
  let hadJob = s.jobs.length > 0;
  ctx.onState((st) => {
    const mine = (st.tasks || []).filter((j) => j.session === s.id);
    if (hadJob && !mine.length) { hadJob = false; ctx.go("sessions", { id: s.id, tab }); return; }
    hadJob = mine.length > 0;
    body.querySelectorAll("[data-job]").forEach((el) => {
      const j = mine.find((x) => x.id === el.dataset.job);
      if (j) el.replaceWith(jobRow(j));
    });
  });

  if (tab === "recap") recapTab(ctx, body, s, names);
  else if (tab === "transcript") transcriptTab(ctx, body, s, params);
  else if (tab === "notes") await planTab(ctx, body, s);
  else filesTab(ctx, body, s);
}

export function jobRow(j) {
  const p = j.progress || {};
  const pct = p.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : null;
  const stage = { decode: "Reading audio", transcribe: "Transcribing", diarize: "Telling voices apart", gm: "Writing the GM recap", player: "Writing the player recap", threads: "Finding loose threads" }[p.stage] || (j.status === "queued" ? "Waiting in line" : "Starting");
  const left = p.total && p.done && p.elapsed ? (p.elapsed / p.done) * (p.total - p.done) : null;
  return h("div.job", { "data-job": j.id },
    h("div.row.nowrap", h("span.chip.accent.live", h("span.dot"), stage), h("span.small.muted.grow.ellipsis", j.title),
      p.speed ? h("span.small.faint.nums", `${p.speed}× real time`) : null,
      left ? h("span.small.faint.nums", `${fmtDuration(left)} left`) : null,
      btn("", { icon: "x", size: "sm", kind: "ghost", title: "Cancel", onclick: () => api.cancel_task(j.id).catch(toastError) })),
    h("div.progress" + (pct == null ? ".idle" : ""), h("i", { style: { width: (pct ?? 8) + "%" } })),
    j.last ? h("div.tiny.faint.ellipsis", j.last) : null);
}

// ---- recap ----------------------------------------------------------------------

function recapTab(ctx, body, s, names) {
  const hasKey = ctx.boot.settings.secrets_set?.anthropic_api_key;
  const job = s.jobs.find((j) => j.kind === "recap");

  const draftWithClaude = async () => {
    if (!hasKey) { toast("Add your Anthropic API key first", "Settings → Claude", "warn", "key"); return ctx.go("settings", { section: "claude" }); }
    try {
      const est = await api.recap_estimate(s.id);
      const ok = await confirmBox("Draft this recap with Claude?",
        `Claude reads the transcript (about ${Math.round(est.transcript_tokens / 1000)}k tokens) and ${est.lore_pages} matching lore pages, then writes a GM recap, a player recap and loose threads: ${est.calls} calls with ${est.model}, roughly ${Math.round(est.input_tokens / 1000)}k tokens in and up to ${Math.round(est.output_tokens / 1000)}k out.`
        + (est.cost != null ? ` Estimated cost: about ${money(est.cost)} of API credit.` : " (No price list for this model, so no cost estimate.)")
        + " Nothing replaces your recap until you accept it.", "Draft it");
      if (!ok) return;
      await api.draft_recap(s.id);
      toast("Claude is writing", "This takes a minute or two. You can keep working.", "", "feather");
      ctx.go("sessions", { id: s.id, tab: "recap" });
    } catch (e) { toastError(e); }
  };

  const parts = [];
  if (job) parts.push(card({ title: "Claude is drafting" }, jobRow(job)));
  const notes = h("textarea.input", { value: s.claude_notes || "", rows: 3,
    placeholder: "Anything the recording doesn't show, e.g. “The first scene wasn't recorded: the party left Millbrook at dawn and found the bridge washed out…”" });
  const saveNotes = btn("Save notes", { icon: "save", size: "sm", onclick: async () => {
    try { await api.update_session(s.id, { claude_notes: notes.value }); s.claude_notes = notes.value; toast("Notes saved", "Claude will use them in the next draft.", "good", "check", 2500); } catch (e) { toastError(e); }
  } });
  const notesCard = card({ title: "Notes for Claude", actions: saveNotes }, notes,
    h("p.tiny.faint", { style: { margin: "8px 0 0" } }, "Claude treats these as true and works them into both recaps and the loose threads. They're never posted anywhere."));
  if (s.draft) parts.push(draftCard(ctx, s, names));

  const gmCard = card({ title: "Recap", actions: h("div.row",
    s.transcript && !job ? btn(s.draft ? "Redo the draft" : "Draft with Claude", { icon: "feather", size: "sm", kind: s.recap || s.draft ? "" : "primary", onclick: draftWithClaude }) : null,
    s.recap.trim() ? btn("Fix names", { icon: "rename", size: "sm", kind: "ghost", onclick: () => fixNames(ctx, s) }) : null,
    btn("Edit", { icon: "edit", size: "sm", onclick: () => editText(ctx, s, "recap", s.recap) })) },
  s.recap.trim() ? render(s.recap, { autoLink: true, linkNames: names })
    : empty("feather", "No recap yet", s.transcript ? "Let Claude draft one from the transcript, or write it yourself." : "Write one, or record and transcribe the session so Claude can draft it.",
      h("div.row", { style: { justifyContent: "center" } },
        s.transcript ? btn("Draft with Claude", { icon: "feather", kind: "primary", onclick: draftWithClaude }) : null,
        btn("Write it myself", { icon: "edit", onclick: () => editText(ctx, s, "recap", "") }))));
  parts.push(gmCard);
  parts.splice(parts.indexOf(gmCard), 0, notesCard);

  const playerText = s.player_recap || "";
  parts.push(card({ title: "For the players", actions: h("div.row",
    btn("Edit", { icon: "edit", size: "sm", kind: "ghost", onclick: () => editText(ctx, s, "player", playerText) }),
    btn("Send to Foundry", { icon: "dice", size: "sm", kind: "ghost", onclick: () => sendToFoundry(() => api.foundry_send_recap(s.id), "Recap") }),
    btn("Post to Discord", { icon: "share", size: "sm", kind: "primary", onclick: () => postToDiscord(ctx, s, playerText || s.recap) })) },
  playerText.trim() ? render(playerText, { autoLink: true, linkNames: names, playerView: true, hideTimes: true })
    : h("p.small.muted", { style: { margin: 0 } }, "A player-safe recap appears here when you accept Claude's draft. Until then, Post to Discord uses the recap above (GM-only blocks are always removed)."),
  s.discord_posts.length ? h("div.tiny.faint", { style: { marginTop: "10px" } }, "Posted: " + s.discord_posts.map((p) => `${p.channel} on ${p.date}`).join(", ")) : null));

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
        : h("p.muted.small", "Claude didn't write this part."));
    }
  };
  const cutNote = h("div");
  const drawCut = () => clear(cutNote, (d.truncated || []).includes(which) ? h("div.notice.warn.small", icon("alert"),
    h("div.grow", h("b", "This part was cut short. "), "Claude hit the length limit before finishing."),
    btn("Write this part again", { size: "sm", icon: "refresh", onclick: async () => {
      try { await api.draft_recap(s.id, [which]); toast("Claude is rewriting it", "", "", "feather"); ctx.go("sessions", { id: s.id, tab: "recap" }); } catch (e) { toastError(e); }
    } })) : null);
  const switcher = seg([["gm", "GM recap", "lock"], ["player", "Player recap", "eye"]], which, (v) => { which = v; draw(); drawCut(); });
  drawCut();
  const editBtn = btn("Edit", { icon: "edit", size: "sm", kind: "ghost", onclick: () => { editing = !editing; editBtn.lastChild.textContent = editing ? "Preview" : "Edit"; draw(); } });
  draw();
  const el = card({ title: "Claude's draft", actions: h("div.row",
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
    view,
    h("div.tiny.faint", `${d.model} · ${d.created}${usage.i ? ` · ${Math.round(usage.i / 1000)}k tokens in, ${Math.round(usage.o / 1000)}k out` : ""}${d.cost != null ? ` · about ${money(d.cost)}` : ""}. Time markers jump to the transcript.`)));
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
    sugg.length ? h("p.small.muted", { style: { margin: 0 } }, "These look like misspellings of names Lore Studio knows. Untick any that aren't, and add your own below.")
      : h("p.small.muted", { style: { margin: 0 } }, "Type the name as Claude wrote it and how it should be spelled. Whole words only, so “Talia” won't touch “Talian”."),
    list,
    h("div.stack.sm",
      s.transcript ? switchEl(transcript, (v) => { transcript = v; }, "Also fix the transcript") : null,
      switchEl(remember, (v) => { remember = v; }, "Remember these spellings for future sessions"),
      h("p.tiny.faint", { style: { margin: 0 } }, "Remembered spellings are given to the transcriber as hints, fixed in new transcripts automatically, and passed to Claude. Manage them in Settings → Campaign."))),
  [{ label: "Cancel", kind: "ghost", value: false }, { label: "Fix them", kind: "primary", icon: "check", value: true }]);
  if (!ok) return;
  const pairs = rows.filter((r) => r.on && r.wrong.trim() && r.right.trim() && r.wrong.trim() !== r.right.trim()).map((r) => [r.wrong.trim(), r.right.trim()]);
  if (!pairs.length) return;
  try {
    const r = await api.fix_names(s.id, pairs, transcript, remember);
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

function transcriptTab(ctx, body, s, params) {
  const parts = [recordingCard(ctx, s)];
  s.jobs.filter((j) => j.kind === "transcribe").forEach((j) => parts.unshift(card({ title: "Transcribing" }, jobRow(j))));
  if (s.transcript) parts.push(transcriptCard(ctx, s, params.t));
  clear(body, h("div.stack", parts));
  if (params.t) setTimeout(() => body.querySelector(".tline.hit")?.scrollIntoView({ block: "center" }), 60);
}

function recordingCard(ctx, s) {
  const st = ctx.boot.settings;
  const rec = s.recording || {};
  const obsOn = !!st.obs_enabled;

  const attach = async () => {
    let path = ctx.boot.native ? await api.pick_file("video") : null;
    if (!ctx.boot.native) {
      const r = await modal("Attach the recording", h("div.field", h("label", "Video or audio file"),
        pathInput("", (v) => { path = v; }, { placeholder: "D:/OBS/2026-11-14 19-02-11.mp4" }),
        h("div.help", "The file stays where it is; Lore Studio only remembers where it is.")),
      [{ label: "Cancel", kind: "ghost", value: false }, { label: "Attach", kind: "primary", value: true }]);
      if (!r) return;
    }
    if (!path) return;
    try { await api.set_recording(s.id, path); ctx.go("sessions", { id: s.id, tab: "transcript" }); } catch (e) { toastError(e); }
  };

  // live recording through OBS
  if (rec.live) {
    const clock = h("span.live-clock.nums", "--:--:--");
    const marks = h("div.list", (rec.chapters || []).map((c) => h("div.list-row", h("span.mono.small", c.time), h("span", c.name))));
    const name = h("input.input", { placeholder: "Name this moment, e.g. “Mira returns”", onkeydown: (e) => { if (e.key === "Enter") mark(); } });
    const mark = async () => {
      const label = name.value.trim() || "Marked moment";
      try {
        const chapters = await api.obs_chapter(s.id, label);
        name.value = "";
        clear(marks, chapters.map((c) => h("div.list-row", h("span.mono.small", c.time), h("span", c.name))));
      } catch (e) { toastError(e); }
    };
    const tick = async () => {
      try { const o = await api.obs_status(); clock.textContent = o.active ? hms(o.seconds) : "stopped"; } catch { clock.textContent = "OBS?"; }
    };
    tick();
    const iv = setInterval(tick, 2000);
    ctx.onLeave(() => clearInterval(iv));
    return card({ title: "Recording in OBS" }, h("div.stack.sm",
      h("div.row", h("span.chip.bad.live", h("span.dot"), "REC"), clock, h("div.spacer"),
        btn("Stop recording", { icon: "stop", kind: "danger solid", onclick: async () => {
          if (!await confirmBox("Stop recording?", st.auto_transcribe ? "The recording is attached to this session and transcription starts right away." : "The recording is attached to this session.", "Stop")) return;
          try {
            const r = await api.obs_stop(s.id);
            if (r.error) toast("Recording saved, but not transcribed", r.error, "warn", "alert", 9000);
            else if (r.queued) toast("Recording saved", "Transcription has started.", "good", "check");
            else toast("Recording saved", r.path || "", "good", "check");
            ctx.go("sessions", { id: s.id, tab: "transcript" });
          } catch (e) { toastError(e); }
        } })),
      h("div.input-wrap", name, btn("Mark", { icon: "tag", onclick: mark })),
      h("p.tiny.faint", { style: { margin: 0 } }, "Marks become chapters in the video (Hybrid MP4) and help Claude follow the session."),
      marks));
  }

  if (!rec.path) {
    return card({ title: "Recording" }, empty("play", "No recording yet",
      obsOn ? "Start recording from here when the session begins. When you stop, the video is attached and transcribed." : "Attach the session's video or audio file, or turn on OBS control in Settings to record from here.",
      h("div.row", { style: { justifyContent: "center" } },
        obsOn ? btn("Start recording in OBS", { icon: "play", kind: "primary", onclick: async () => {
          try { await api.obs_start(s.id); toast("Recording", "Have a great session!", "good", "play"); ctx.go("sessions", { id: s.id, tab: "transcript" }); } catch (e) { toastError(e); }
        } }) : null,
        btn("Attach a recording", { icon: "upload", kind: obsOn ? "" : "primary", onclick: attach }))));
  }

  const streams = rec.streams || [];
  let tracks = (rec.tracks || []).map((t) => ({ ...t }));
  const role = (i) => tracks.find((t) => t.stream === i);
  const trackRows = streams.length ? h("div.track-table", streams.map((x) => {
    const t = role(x.stream);
    const voicesIn = t ? h("input.input.nums.voices", { type: "number", min: 1, max: 12, value: t.voices ?? "", placeholder: "?", disabled: !t.diarize,
      title: "How many people talk on this track. Knowing the number makes telling voices apart much more accurate. Blank = let it guess.",
      onchange: (e) => { t.voices = e.target.value ? Number(e.target.value) : null; api.set_tracks(s.id, tracks).catch(toastError); } }) : null;
    const val = t ? (t.speaker === "GM" ? "gm" : t.speaker === "Players" ? "players" : "table") : "skip";
    const sel = h("select.select", { onchange: (e) => {
      tracks = tracks.filter((y) => y.stream !== x.stream);
      const v = e.target.value;
      const partySize = (ctx.boot.campaign?.info?.party || []).filter((p) => p.character || p.player).length || null;
      if (v !== "skip") tracks.push({ stream: x.stream, speaker: v === "gm" ? "GM" : v === "players" ? "Players" : "Table", diarize: v !== "gm" && !!st.diarize_players,
        voices: v === "players" ? partySize : v === "table" && partySize ? partySize + 1 : null });
      tracks.sort((a, b) => a.stream - b.stream);
      api.set_tracks(s.id, tracks).catch(toastError);
      ctx.go("sessions", { id: s.id, tab: "transcript" });
    } }, [["skip", "Skip"], ["gm", "GM (your mic)"], ["players", "Players (Discord)"], ["table", "Everyone (mixed)"]].map(([v, l]) => h("option", { value: v, selected: v === val }, l)));
    return h("div.track-row",
      h("div", h("b", `Track ${x.stream + 1}`), h("div.tiny.faint", [x.title, x.channels ? `${x.channels} ch` : null, x.duration ? fmtDuration(x.duration) : null].filter(Boolean).join(" · "))),
      sel,
      t && t.speaker !== "GM" ? h("div.row.nowrap",
        switchEl(!!t.diarize, (v) => { t.diarize = v; api.set_tracks(s.id, tracks).catch(toastError); voicesIn.disabled = !v; }, "Tell voices apart"),
        voicesIn, h("span.small.faint", "voices")) : h("span"));
  })) : h("div.notice.warn.small", icon("info"), h("div", "Install transcription in Settings to read this recording's audio tracks.",
    h("div", { style: { marginTop: "6px" } }, btn("Open Settings", { size: "sm", onclick: () => ctx.go("settings", { section: "transcription" }) }))));

  const busy = s.jobs.some((j) => j.kind === "transcribe");
  return card({ title: "Recording", actions: h("div.row",
    btn("Replace", { icon: "upload", size: "sm", kind: "ghost", onclick: attach }),
    !busy ? btn(s.transcript ? "Transcribe again" : "Transcribe", { icon: "play", size: "sm", kind: s.transcript ? "" : "primary", disabled: !streams.length || !tracks.length, onclick: async () => {
      if (s.transcript && !await confirmBox("Transcribe again?", "The current transcript (and any speaker names) will be replaced.", "Transcribe")) return;
      try { await api.transcribe(s.id); toast("Transcription started", "You'll get a notification when it's done.", "", "play"); ctx.go("sessions", { id: s.id, tab: "transcript" }); } catch (e) { toastError(e); }
    } }) : null) },
  h("div.stack.sm",
    h("div.small.mono.faint.break", rec.path),
    trackRows,
    streams.length && !tracks.length ? h("p.small.muted", { style: { margin: 0 } }, "Pick at least one track to transcribe.") : null,
    rec.chapters?.length ? h("div.small.muted", "Marked moments: " + rec.chapters.map((c) => `${c.time} ${c.name}`).join(" · ")) : null));
}

function transcriptCard(ctx, s, jumpTo) {
  const tr = s.transcript;
  const names = { ...tr.speakers };
  const labels = tr.labels;
  const colorIdx = (l) => labels.indexOf(l) % 8;
  const q = h("input.input", { placeholder: "Find in the transcript…", oninput: () => filter() });
  const lines = h("div.tlines");
  const target = jumpTo ? toSec(jumpTo) : null;
  let hitDone = false;

  // merge consecutive lines by the same speaker into turns
  const turns = [];
  for (const seg of tr.segments) {
    const last = turns[turns.length - 1];
    if (last && last.speaker === seg.speaker && seg.start - last.end < 4) { last.text += " " + seg.text; last.end = seg.end; }
    else turns.push({ ...seg });
  }
  const draw = () => clear(lines, turns.map((t) => {
    const hit = target != null && !hitDone && t.end >= target;
    if (hit) hitDone = true;
    return h("div.tline", { class: hit ? "hit" : "", "data-text": (t.text + " " + (names[t.speaker] || t.speaker)).toLowerCase() },
      h("span.tt.mono", hms(t.start)), h("span.tspk", { class: "c" + colorIdx(t.speaker) }, names[t.speaker] || t.speaker), h("span.ttext", t.text));
  }));
  const filter = () => {
    const v = q.value.trim().toLowerCase();
    lines.querySelectorAll(".tline").forEach((el) => el.classList.toggle("hidden", !!v && !el.dataset.text.includes(v)));
  };
  draw();

  const speakers = h("div.speaker-grid", labels.map((l) => h("div.speaker-row",
    h("span.tspk", { class: "c" + colorIdx(l) }, l),
    h("input.input", { value: names[l] || "", placeholder: "Who is this?", onchange: async (e) => {
      names[l] = e.target.value.trim();
      try { await api.save_speakers(s.id, names); hitDone = false; draw(); filter(); } catch (err) { toastError(err); }
    } }))));

  return card({ title: "Transcript", actions: h("div.row", h("span.small.faint", `${tr.segments.length} lines · ${fmtDuration(tr.duration)} · ${tr.model}`)) },
    h("div.stack.sm",
      h("details.speakers", h("summary", `Speakers (${labels.length}) · name them so recaps use the right people`), speakers),
      h("div.search", icon("search"), q),
      lines));
}

// ---- notes & files --------------------------------------------------------------

async function attachHtml(ctx, s) {
  let path = ctx.boot.native ? await api.pick_file("html") : null;
  if (!ctx.boot.native) {
    const r = await modal("Attach HTML notes", h("div.field", h("label", "Path to the .html file"),
      pathInput("", (v) => { path = v; }, { kind: "html", placeholder: "C:/Users/you/Documents/Session_03_The_Drowned_Chapel.html" })),
    [{ label: "Cancel", kind: "ghost", value: false }, { label: "Attach", kind: "primary", value: true }]);
    if (!r) return;
  }
  if (!path) return;
  try {
    await api.attach_session_html(s.id, path);
    toast("Notes attached", "Copied into the session folder.", "good", "check");
    ctx.go("sessions", { id: s.id, tab: "notes" });
  } catch (e) { toastError(e); }
}

const BLOCKS = [
  ["Scene", "scroll", "\n## New Scene\n"],
  ["Read aloud", "feather", "\n:::read\nDescribe what they see.\nSomeone: \"A line of dialogue.\"\n:::\n"],
  ["Divine voice", "sparkle", "\n:::divine\nSomeone: \"Words in gold.\"\n:::\n"],
  ["NPC lines", "list", "\n- **When asked about…**\n  > Something they might say.\n  > Another option.\n"],
  ["Note / secret", "lock", "\n:::note\n**Secret.** Something the players don't know yet.\n:::\n"],
  ["Character card", "heart", "\n:::pc Name\n~ Theme: what this scene asks of them\n- A beat for this character.\n:::\n"],
  ["Menu item", "box", "\n:::act Place or activity | one-line description\n:::read\nWhat they find.\n:::\n- What can happen here.\n:::\n"],
  ["Check", "check", "\n~ Wisdom (Perception) check, DC 13.\n"],
  ["Table", "columns", "\n| Item | Price | Notes |\n|---|---|---|\n| Something | 50 gp | |\n"],
];

async function planTab(ctx, body, s) {
  let plan = await api.plan(s.id);
  if (!plan.exists) {
    if (s.html_url) {
      const frame = h("iframe.notes-frame", { src: s.html_url + "?t=" + Date.now(), title: "Session notes", sandbox: "allow-scripts allow-popups allow-popups-to-escape-sandbox" });
      clear(body, h("div.row", { style: { marginBottom: "12px" } },
        h("span.muted.small.grow", "Your HTML notes, exactly as they print."),
        btn("Edit as a plan", { icon: "edit", size: "sm", kind: "primary", onclick: async () => {
          try { await api.start_plan(s.id); toast("Converted to a plan", "The original file is kept as plan.original.html.", "good", "check"); ctx.go("sessions", { id: s.id, tab: "notes" }); } catch (e) { toastError(e); }
        } }),
        btn("Open in browser", { icon: "external", size: "sm", kind: "ghost", onclick: () => window.open(s.html_url, "_blank") }),
        btn("Replace", { icon: "upload", size: "sm", onclick: () => attachHtml(ctx, s) })), frame);
      return;
    }
    clear(body, card({ title: "Plan" }, empty("scroll", "No plan yet",
      "Write the session as scenes, and Lore Studio turns it into your HTML notes: the scene index, at-a-glance timeline, read-aloud boxes and all.",
      h("div.row", { style: { justifyContent: "center" } },
        btn("Start a plan", { icon: "plus", kind: "primary", onclick: async () => { await api.start_plan(s.id).catch(toastError); ctx.go("sessions", { id: s.id, tab: "notes" }); } }),
        btn("Attach HTML notes", { icon: "upload", onclick: () => attachHtml(ctx, s) })))));
    return;
  }

  const ta = h("textarea.input.editor.plan-editor", { value: plan.text, spellcheck: true });
  const frame = h("iframe.plan-preview", { sandbox: "allow-same-origin", title: "Preview" });
  let dirty = false, timer = null;
  const base = ctx.boot.settings.theme?.base;
  const refresh = async () => {
    try {
      const y = frame.contentWindow?.scrollY || 0;
      frame.srcdoc = await api.preview_plan(s.id, ta.value, base);
      frame.onload = () => { try { frame.contentWindow.scrollTo(0, y); } catch { /* ignore */ } };
    } catch (e) { toastError(e); }
  };
  ta.addEventListener("input", () => { dirty = true; saveBtn.disabled = false; clearTimeout(timer); timer = setTimeout(refresh, 400); });
  const insert = (text) => {
    const at = ta.selectionStart;
    ta.value = ta.value.slice(0, at) + text + ta.value.slice(ta.selectionEnd);
    ta.selectionStart = ta.selectionEnd = at + text.length;
    ta.focus();
    ta.dispatchEvent(new Event("input"));
  };
  const save = async () => {
    try { plan = await api.save_plan(s.id, ta.value); dirty = false; saveBtn.disabled = true; toast("Plan saved", "The HTML notes were updated too.", "good", "check", 1800); } catch (e) { toastError(e); }
  };
  ta.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); }
    if (e.key === "Tab") { e.preventDefault(); insert("  "); }
  });
  ctx.onLeave(() => { if (dirty) api.save_plan(s.id, ta.value).catch(() => {}); });
  const saveBtn = btn("Save", { icon: "save", kind: "primary", size: "sm", disabled: true, onclick: save });

  const toolbar = h("div.plan-tools",
    BLOCKS.map(([label, ic, text]) => btn(label, { icon: ic, size: "sm", kind: "ghost", onclick: () => insert(text) })),
    h("div.spacer"),
    btn("Previously on", { icon: "history", size: "sm", kind: "ghost", title: "Insert the last recap as a read-aloud", onclick: async () => {
      const prev = await api.previously(s.id).catch(() => "");
      if (!prev) return toast("No earlier recap to use", "", "warn", "info");
      insert(`\n## Previously {tag="Recap"}\n:::read Read aloud · Previously\n${prev}\n:::\n`);
    } }),
    btn("Suggest a scene", { icon: "feather", size: "sm", onclick: () => suggestScene(ctx, s, insert) }));

  const help = h("details.plan-help", h("summary", "How plans are written"), h("div.small.muted",
    h("p", h("b", "## Title"), " starts a scene (numbered automatically from ", h("code", "first_scene"), "). Add ", h("code", '{.branch tag="Branch"}'), " for a coloured tag, ", h("code", "{glance}"), " for the at-a-glance section."),
    h("p", h("code", ":::read"), ", ", h("code", ":::divine"), ", ", h("code", ":::note"), ", ", h("code", ":::pc Name"), ", ", h("code", ":::act Name | description"), ", ", h("code", ":::cast"), " … ", h("code", ":::"), " make the boxes. Inside read-aloud, ", h("code", 'Name: "words"'), " is dialogue and ", h("code", "~ text"), " is a check line."),
    h("p", "Everything else is GM notes in Markdown. Under a bullet, indented ", h("code", "> lines"), " are quoted options (", h("code", ">>"), " for gold). In the at-a-glance list, ", h("code", "- branch: Text | 10 min"), " adds the time.")));

  clear(body,
    h("div.row.plan-bar",
      h("span.small.faint.grow", plan.scenes.length ? `${plan.scenes.length} sections · saves to plan.md and plan.html` : "plan.md"),
      btn("Carry over…", { icon: "right", size: "sm", kind: "ghost", title: "Start the next session from scenes you didn't reach", onclick: () => carryOver(ctx, s, plan) }),
      btn("Open notes", { icon: "external", size: "sm", kind: "ghost", onclick: async () => { if (dirty) await save(); window.open(`/c/sessions/${s.id}/plan.html?t=${Date.now()}`, "_blank"); } }),
      saveBtn),
    toolbar, help,
    h("div.plan-split", ta, frame));
  refresh();
}

async function suggestScene(ctx, s, insert) {
  if (!ctx.boot.settings.secrets_set?.anthropic_api_key) return toast("Add your Anthropic API key first", "Settings → Claude", "warn", "key");
  const idea = h("textarea.input", { rows: 3, placeholder: "Optional: what should happen? e.g. “The innkeeper asks the party to find her missing son.”" });
  const ok = await modal("Suggest a scene", h("div.stack.sm", idea,
    h("p.tiny.faint", { style: { margin: 0 } }, "Claude reads this plan, your open loose threads, the last recap and matching lore pages, and writes one scene in plan format. Usually a few cents.")),
  [{ label: "Cancel", kind: "ghost", value: false }, { label: "Suggest", kind: "primary", icon: "feather", value: true }]);
  if (!ok) return;
  toast("Claude is writing a scene…", "", "", "feather", 4000);
  try {
    const r = await api.suggest_scene(s.id, idea.value);
    const view = h("textarea.input.editor.short", { value: r.text });
    const use = await modal("Claude's scene", h("div.stack.sm", view, h("p.tiny.faint", { style: { margin: 0 } }, `${r.model}${r.cost != null ? ` · about ${money(r.cost)}` : ""}. Edit it here or after inserting.`)),
      [{ label: "Discard", kind: "ghost", value: false }, { label: "Insert at cursor", kind: "primary", value: true }], { wide: true });
    if (use) insert("\n" + view.value.trim() + "\n");
  } catch (e) { toastError(e); }
}

async function carryOver(ctx, s, plan) {
  const picks = new Set();
  const rows = plan.scenes.map((sc) => h("label.check", h("input", { type: "checkbox", onchange: (e) => { e.target.checked ? picks.add(sc.id) : picks.delete(sc.id); } }), `${sc.tag ? sc.tag + " · " : ""}${sc.title}`));
  const title = h("input.input", { placeholder: "Title of the next session" });
  const ok = await modal("Carry scenes over to the next session", h("div.stack",
    h("p.small.muted", { style: { margin: 0 } }, "Pick the scenes the party didn't reach. They're copied into a new session's plan, keeping their numbers."),
    h("div.stack.sm", rows), h("div.field", h("label", "Next session's title"), title)),
  [{ label: "Cancel", kind: "ghost", value: false }, { label: "Create next session", kind: "primary", value: true }]);
  if (!ok || !picks.size) return;
  try { const id = await api.carry_over(s.id, [...picks], title.value.trim()); ctx.go("sessions", { id, tab: "notes" }); } catch (e) { toastError(e); }
}

function filesTab(ctx, body, s) {
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
    h("p.small.muted", { style: { margin: "0 0 8px" } }, "Rolls, chat and combat turns logged while this session was live. Claude reads these when drafting the recap."),
    h("div.foundry-log", events.slice(-200).reverse().map((ev) =>
      h("div.foundry-ev", h("span.mono.faint", (ev.time || "").slice(11, 19)), h("span.chip", ev.type), h("span", line(ev)))))));
}

async function editDetails(ctx, s) {
  const title = h("input.input", { value: s.title });
  const number = h("input.input.nums", { value: s.number ?? "", type: "number", min: 0 });
  const date = h("input.input", { value: s.date || "", type: "date" });
  const world = h("input.input", { value: s.in_world_date || "", placeholder: "e.g. 3rd of Deepwinter, 1042" });
  const r = await modal("Session details", h("div.stack",
    h("div.grid.c2", h("div.field", h("label", "Title"), title), h("div.field", h("label", "Number"), number)),
    h("div.grid.c2", h("div.field", h("label", "Played on"), date), h("div.field", h("label", "In-world date"), world))),
  [{ label: "Cancel", kind: "ghost", value: false }, { label: "Save", kind: "primary", value: true }]);
  if (!r) return;
  try {
    await api.update_session(s.id, { title: title.value.trim() || s.title, number: number.value === "" ? null : Number(number.value), date: date.value, in_world_date: world.value.trim() });
    ctx.go("sessions", { id: s.id });
  } catch (e) { toastError(e); }
}
