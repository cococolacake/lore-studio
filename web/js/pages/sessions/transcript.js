// Sessions → Transcript tab: the recording, OBS tracks, who's who, and the transcript.
import { api } from "../../api.js";
import { h, btn, card, clear, empty, toast, toastError, confirmBox, modal, fmtDuration } from "../../dom.js";
import { icon } from "../../icons.js";
import { pathInput, switchEl, seg } from "../../components.js";
import { hms, toSec, jobRow } from "./helpers.js";

export function transcriptTab(ctx, body, s, params) {
  const parts = [recordingCard(ctx, s)];
  s.jobs.filter((j) => j.kind === "transcribe").forEach((j) => parts.unshift(card({ title: "Transcribing" }, jobRow(j))));
  if (s.transcript) parts.push(...transcriptCard(ctx, s, params.t));
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

  const attachPeople = async () => {
    let path = null;
    if (ctx.boot.native) {
      const how = await modal("One file per person", h("div.stack.sm",
        h("p.small.muted", { style: { margin: 0 } }, "Pick Craig's download: the .zip as it came, or the folder you unzipped it to. Every person's file is transcribed on its own and labelled with their name.")),
        [{ label: "Cancel", kind: "ghost", value: false }, { label: "Pick the folder", value: "folder" }, { label: "Pick the .zip", kind: "primary", value: "zip" }]);
      if (!how) return;
      path = how === "folder" ? await api.pick_folder() : await api.pick_file("zip");
    } else {
      const r = await modal("One file per person", h("div.field", h("label", "Craig's .zip, or the folder you unzipped it to"),
        pathInput("", (v) => { path = v; }, { placeholder: "D:/Downloads/craig-session-12.zip" }),
        h("div.help", "A .zip is unpacked into the session's folder (audio only). A folder is used where it is.")),
      [{ label: "Cancel", kind: "ghost", value: false }, { label: "Attach", kind: "primary", value: true }]);
      if (!r) return;
    }
    if (!path) return;
    try {
      toast("Reading the files…", "", "", "upload", 2500);
      await api.set_recording(s.id, path);
      ctx.go("sessions", { id: s.id, tab: "transcript" });
    } catch (e) { toastError(e); }
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
      h("p.tiny.faint", { style: { margin: 0 } }, "Marks become chapters in the video (Hybrid MP4) and help the recap follow the session."),
      marks));
  }

  if (!rec.path) {
    return card({ title: "Recording" }, empty("play", "No recording yet",
      obsOn ? "Start recording from here when the session begins. When you stop, the video is attached and transcribed." : "Attach the session's video or audio file, or turn on OBS control in Settings to record from here.",
      h("div.row", { style: { justifyContent: "center" } },
        obsOn ? btn("Start recording in OBS", { icon: "play", kind: "primary", onclick: async () => {
          try { await api.obs_start(s.id); toast("Recording", "Have a great session!", "good", "play"); ctx.go("sessions", { id: s.id, tab: "transcript" }); } catch (e) { toastError(e); }
        } }) : null,
        btn("Attach a recording", { icon: "upload", kind: obsOn ? "" : "primary", onclick: attach }),
        btn("Attach one file per person", { icon: "layers", kind: "ghost", title: "Craig and similar Discord bots: one audio file for each person", onclick: attachPeople }))));
  }

  if (rec.per_person) return peopleCard(ctx, s, rec, attach, attachPeople);

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

/** A Craig-style recording: one audio file per person. Name each one (or mark yours as GM, or skip a bot). */

function peopleCard(ctx, s, rec, attach, attachPeople) {
  const tracks = (rec.tracks || []).map((t) => ({ ...t }));
  const save = () => api.set_tracks(s.id, tracks).catch(toastError);
  const busy = s.jobs.some((j) => j.kind === "transcribe");
  const used = tracks.filter((t) => !t.skip).length;
  const fileName = (p) => p.split(/[\\/]/).pop();
  const rows = h("div.track-table", tracks.map((t) => {
    const nameIn = h("input.input", { value: t.speaker === "GM" ? "GM" : t.speaker, placeholder: t.who, disabled: t.skip || t.speaker === "GM",
      title: "The name used in the transcript. Use the same name as in your party list (Settings → Campaign) so recaps know who's who.",
      onchange: (e) => { t.speaker = e.target.value.trim() || t.who; save(); } });
    const role = t.skip ? "skip" : t.speaker === "GM" ? "gm" : "player";
    const sel = h("select.select", { onchange: (e) => {
      const v = e.target.value;
      t.skip = v === "skip";
      if (v === "gm") t.speaker = "GM";
      else if (t.speaker === "GM") t.speaker = t.who;
      nameIn.disabled = v !== "player";
      nameIn.value = t.speaker;
      save().then(() => ctx.reload());
    } }, [["player", "Player"], ["gm", "Me (GM)"], ["skip", "Skip"]].map(([v, l]) => h("option", { value: v, selected: v === role }, l)));
    return h("div.track-row", { class: t.skip ? "skipped" : "" },
      h("div", h("b", t.who), h("div.tiny.faint.break", fileName(t.file))), sel, nameIn);
  }));
  return card({ title: "Recording: one file per person", actions: h("div.row",
    btn("Replace", { icon: "upload", size: "sm", kind: "ghost", onclick: attachPeople }),
    btn("Use one recording", { icon: "play", size: "sm", kind: "ghost", title: "Attach a single video or audio file instead", onclick: attach }),
    !busy ? btn(s.transcript ? "Transcribe again" : "Transcribe", { icon: "play", size: "sm", kind: s.transcript ? "" : "primary", disabled: !used, onclick: async () => {
      if (s.transcript && !await confirmBox("Transcribe again?", "The current transcript (and any speaker names) will be replaced.", "Transcribe")) return;
      try { await api.transcribe(s.id); toast("Transcription started", "You'll get a notification when it's done.", "", "play"); ctx.go("sessions", { id: s.id, tab: "transcript" }); } catch (e) { toastError(e); }
    } }) : null) },
  h("div.stack.sm",
    h("div.small.mono.faint.break", rec.path),
    rows,
    h("p.tiny.faint", { style: { margin: 0 } }, `${used} of ${tracks.length} file${tracks.length === 1 ? "" : "s"} will be transcribed. Names are remembered for next time, so you only set them once.`
      + (rec.unpacked ? " The .zip's audio was unpacked into this session's folder." : ""))));
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
      try { await api.save_speakers(s.id, names); hitDone = false; draw(); filter(); drawSpot(); } catch (err) { toastError(err); }
    } }))));

  // spotlight: who talked how much, so a quiet player's turn doesn't slip by
  const spot = h("div.spotlight");
  const drawSpot = () => {
    const rows = spotlightRows(tr.segments, names);
    const players = rows.filter((r) => !r.gm);
    const playerTotal = players.reduce((a, r) => a + r.seconds, 0) || 1;
    const max = rows[0]?.seconds || 1;
    const unnamed = labels.some((l) => !names[l] && l.toUpperCase() !== "GM");
    clear(spot, rows.map((r) => h("div.spot-row",
      h("span.tspk", { class: "c" + colorIdx(r.label) }, r.name),
      h("div.spot-track", h("div.spot-bar", { class: "c" + colorIdx(r.label), style: { width: `${Math.max(2, (r.seconds / max) * 100)}%` } })),
      h("span.small.faint.nums", `${fmtDuration(r.seconds)}${r.gm ? " · GM" : ` · ${Math.round((r.seconds / playerTotal) * 100)}%`}`))),
    h("p.tiny.faint", { style: { margin: "4px 0 0" } }, (players.length > 1 ? "Percentages are each player's share of the players' talk time. " : "")
      + (unnamed ? "Name the speakers below to see who's who." : "From the transcript's speaker labels.")));
  };
  drawSpot();
  const spotCard = card({ title: "Spotlight", actions: h("span.small.faint", "Who talked how much") }, spot);

  return [labels.length > 1 ? spotCard : null, card({ title: "Transcript", actions: h("div.row", h("span.small.faint", `${tr.segments.length} lines · ${fmtDuration(tr.duration)} · ${tr.model}`)) },
    h("div.stack.sm",
      h("details.speakers", h("summary", `Speakers (${labels.length}) · name them so recaps use the right people`), speakers),
      h("div.search", icon("search"), q),
      lines))].filter(Boolean);
}

/** Talk time per speaker from transcript segments: [{name, label, seconds, gm}], most first. */
export function spotlightRows(segments, names) {
  const by = new Map();
  for (const seg of segments || []) {
    const label = seg.speaker || "?";
    const name = (names[label] || label).trim();
    const r = by.get(name) || { name, label, seconds: 0, gm: name.toUpperCase() === "GM" || label.toUpperCase() === "GM" };
    r.seconds += Math.max(0, (seg.end || 0) - (seg.start || 0));
    by.set(name, r);
  }
  return [...by.values()].sort((a, b) => b.seconds - a.seconds);
}

// ---- notes & files --------------------------------------------------------------
