// Live mode: run the session from here. The current scene, beats to tick off, a timestamped scratchpad,
// quick lore lookup, and OBS controls. What you tick and note feeds the recap draft afterwards.
import { api } from "../api.js";
import { h, btn, card, clear, empty, toast, toastError, store } from "../dom.js";
import { icon } from "../icons.js";
import { render } from "../markdown.js";
import { liveWorldCard } from "./calendar.js";
import { clocksCard } from "./clocks.js";
import { foundryPanel } from "../foundrylive.js";
import { handoutCard } from "./handouts.js";
import { boardsCard } from "./boards.js";
import { remindBeforeLive } from "../checklist.js";

const hms = (sec) => { sec = Math.max(0, Math.floor(sec || 0)); return `${String(Math.floor(sec / 3600)).padStart(2, "0")}:${String(Math.floor(sec % 3600 / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`; };

export default {
  id: "live", label: "Live", icon: "play",

  async mount(ctx, params, root) {
    const sid = params.id || await api.live_session();
    if (!sid) {
      root.append(ctx.header({ title: "Live", subtitle: "Run the session from here.", icon: "play" }),
        card(null, empty("play", "No sessions yet", "Create a session and write its plan, then come back here to run it.", btn("Go to Sessions", { kind: "primary", onclick: () => ctx.go("sessions") }))));
      return;
    }
    let st = await api.live_state(sid);
    const s = st.session;
    if (s.status === "planned") remindBeforeLive(ctx, sid);
    const obsOn = !!ctx.boot.settings.obs_enabled;
    root.classList.add("live-page");

    // ---- side: scenes
    // a scene is finished only when you say so: tick it in this list or with the button above the scene
    const isDone = (id) => (st.live.finished || []).includes(id);
    const sceneList = () => st.scenes.map((sc) => h("div.side-item.live-scene-item", { class: [sc.id === st.live.current ? "active" : "", isDone(sc.id) ? "finished" : ""].join(" "), onclick: () => go(sc.id) },
      sc.glance ? icon("list") : h("label.check.scene-tick", { title: isDone(sc.id) ? "Finished. Click to mark it unfinished" : "Mark as finished", onclick: (e) => e.stopPropagation() },
        h("input", { type: "checkbox", checked: isDone(sc.id), onchange: (e) => setFinished(sc.id, e.target.checked) })),
      h("span.grow", h("span", sc.title), h("span.sub", sc.tag))));
    async function setFinished(id, on) {
      try {
        st.live = await api.live_update(sid, { finished: { [id]: on } });
        drawSide();
        drawDoneBtn();
      } catch (e) { toastError(e); }
    }
    const drawSide = () => ctx.side(h("h2", "Live"),
      h("div.small.faint", { style: { margin: "-10px 10px 14px" } }, `Session ${s.number ?? ""}: ${s.title}`),
      st.scenes.length ? sceneList() : h("p.small.muted", { style: { margin: "0 10px" } }, "This session has no plan yet."),
      h("div.sep"),
      h("button.side-item", { onclick: () => ctx.go("sessions", { id: sid, tab: "notes" }) }, icon("edit"), h("span", "Edit the plan")));
    drawSide();

    // ---- top bar
    const clock = h("span.live-clock.nums", "");
    const recBtn = h("span");
    const drawRec = () => {
      clear(recBtn, !obsOn ? null : st.recording
        ? h("div.row.nowrap", h("span.chip.bad.live", h("span.dot"), "REC"), clock,
          btn("Stop", { icon: "stop", size: "sm", kind: "danger", onclick: async () => {
            try { const r = await api.obs_stop(sid); toast("Recording saved", r.queued ? "Transcription has started." : r.path || "", "good", "check"); st = await api.live_state(sid); drawRec(); } catch (e) { toastError(e); }
          } }))
        : btn("Start recording", { icon: "play", size: "sm", onclick: async () => {
          try { await api.obs_start(sid); st = await api.live_state(sid); drawRec(); toast("Recording", "Have a great session!", "good", "play"); } catch (e) { toastError(e); }
        } }));
    };
    drawRec();
    const tick = async () => {
      if (!st.recording) return;
      try { const o = await api.obs_status(); clock.textContent = o.active ? hms(o.seconds) : "stopped"; } catch { clock.textContent = "OBS?"; }
    };
    const iv = setInterval(tick, 2000);
    tick();
    ctx.onLeave(() => clearInterval(iv));

    const idx = () => st.scenes.findIndex((x) => x.id === st.live.current);
    const nextBtn = btn("Next scene", { icon: "right", kind: "primary", onclick: () => {
      const i = idx();
      if (i < st.scenes.length - 1) go(st.scenes[i + 1].id, true);
    } });
    const prevBtn = btn("", { icon: "left", title: "Previous scene", onclick: () => { const i = idx(); if (i > 0) go(st.scenes[i - 1].id); } });
    const title = h("div.grow", h("div.small.faint", "Now playing"), h("h1.page-title", { style: { margin: 0, fontSize: "24px" } }, ""));
    const doneSlot = h("span");
    function drawDoneBtn() {
      const sc = st.scenes[idx()];
      if (!sc || sc.glance) return clear(doneSlot);
      const on = isDone(sc.id);
      clear(doneSlot, btn(on ? "Finished" : "Mark finished", { icon: "check", size: "sm", kind: on ? "" : "ghost",
        title: on ? "Click to mark this scene unfinished" : "Mark this scene as played", onclick: () => setFinished(sc.id, !on) }));
    }

    // ---- scene frame
    const frame = h("iframe.live-scene", { sandbox: "allow-same-origin", title: "Current scene" });
    const sceneLinks = () => {
      const seen = new Set();
      return [...(frame.contentDocument?.querySelectorAll(".fl") || [])].map((el) => ({ kind: el.dataset.fl, name: el.dataset.name }))
        .filter((l) => { const k = l.kind + ":" + l.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    };
    const fpanel = foundryPanel(ctx, { sceneLinks, sessionId: sid });
    const sessionHandouts = h("div");
    const liveBoards = h("div");
    const liveEncounters = h("div");
    api.encounters().then((all) => {
      const mine = all.filter((x) => x.session === sid);
      if (!mine.length) return;
      clear(liveEncounters, card({ title: "Encounters" }, h("div.stack.sm", mine.map((x) => h("div.row.nowrap",
        h("button.linkish.grow", { style: { textAlign: "left" }, onclick: () => ctx.go("monsters", { enc: x.id }) }, h("b", x.name), h("span.faint", ` · ${x.monsters} monster${x.monsters === 1 ? "" : "s"}`)),
        btn("Place", { icon: "play", size: "sm", title: "Put their tokens, hidden, on the scene open in Foundry", onclick: async () => {
          try { const r = await api.encounter_place(x.id, true); toast(`Placed ${r.placed} token${r.placed === 1 ? "" : "s"}`, "Hidden. Reveal them when the fight starts.", "good", "hive"); } catch (e) { toastError(e); }
        } }))))));
    }).catch(() => {});
    api.boards_for(null, sid).then((bs) => { if (bs.length) clear(liveBoards, boardsCard(ctx, bs, { session: sid })); }).catch(() => {});
    api.handouts().then((all) => {
      const mine = all.filter((x) => x.session === sid);
      if (mine.length) clear(sessionHandouts, card({ title: "Handouts" }, h("div.stack.sm", mine.map((x) => handoutCard(ctx, x, { compact: true })))));
    }).catch(() => {});
    async function loadScene() {
      const sc = st.scenes[idx()];
      title.lastChild.textContent = sc ? sc.title : "No plan";
      drawDoneBtn();
      nextBtn.disabled = idx() >= st.scenes.length - 1;
      prevBtn.disabled = idx() <= 0;
      if (!sc) return;
      frame.srcdoc = await api.live_scene(sid, sc.id);
      frame.onload = () => {
        const doc = frame.contentDocument;
        // {actor:…}, {table:…}, {scene:…}, {sound:…}, {handout:…} links in the plan run in Foundry
        doc.querySelectorAll(".fl").forEach((el) => el.addEventListener("click", (e) => { e.stopPropagation(); fpanel.act(el.dataset.fl, el.dataset.name); }));
        fpanel.refresh();
        const items = [...doc.querySelectorAll(".gm li")];
        const done = new Set((st.live.ticks || {})[sc.id] || []);
        // each beat gets its own tick box, so clicking the text (to read, or open a menu) never ticks it
        items.forEach((li, i) => {
          if (done.has(i)) li.classList.add("done");
          const box = doc.createElement("button");
          box.className = "tickbox";
          box.title = "Tick off";
          box.setAttribute("aria-label", "Tick off");
          li.prepend(box);
          box.addEventListener("click", async (e) => {
            e.stopPropagation();
            li.classList.toggle("done");
            const now = items.map((x, k) => (x.classList.contains("done") ? k : -1)).filter((k) => k >= 0);
            const texts = items.filter((x) => x.classList.contains("done")).map((x) => x.textContent.split("\n")[0].trim().slice(0, 200));
            st.live.ticks = { ...(st.live.ticks || {}), [sc.id]: now };
            try { await api.live_update(sid, { ticks: { [sc.id]: now }, ticked_text: { [sc.id]: texts } }); } catch (err) { toastError(err); }
          });
        });
      };
    }
    async function go(id, chapter = false) {
      try {
        st.live = await api.live_update(sid, { current: id });
        drawSide();
        loadScene();
        const sc = st.scenes.find((x) => x.id === id);
        if (chapter && st.recording && sc) api.obs_chapter(sid, sc.title).catch(() => {});
      } catch (e) { toastError(e); }
    }

    // ---- scratchpad
    const notesList = h("div.live-notes");
    const drawNotes = () => clear(notesList, (st.live.notes || []).slice().reverse().map((n, ri) => {
      const i = st.live.notes.length - 1 - ri;
      return h("div.live-note", h("span.mono.tiny.faint", n.rec || n.time), h("span.grow", n.text),
        h("button.linkish.danger", { title: "Delete", onclick: async () => { st.live = await api.delete_live_note(sid, i).catch(toastError) || st.live; drawNotes(); } }, "✕"));
    }));
    drawNotes();
    const noteIn = h("input.input", { placeholder: "Quick note… (Enter)", onkeydown: async (e) => {
      if (e.key !== "Enter" || !noteIn.value.trim()) return;
      const sc = st.scenes[idx()];
      try { st.live = await api.live_note(sid, noteIn.value, sc?.title || ""); noteIn.value = ""; drawNotes(); } catch (err) { toastError(err); }
    } });

    // ---- lookup
    const lookResults = h("div.live-look");
    const names = await ctx.linkNames();
    const lookIn = h("input.input", { placeholder: "Look up a name or #tag…", oninput: () => { clearTimeout(lookIn._t); lookIn._t = setTimeout(look, 200); } });
    async function look() {
      const q = lookIn.value.trim();
      if (!q) return clear(lookResults);
      const hits = await api.search(q).catch(() => []);
      clear(lookResults, hits.filter((x) => x.kind === "page").slice(0, 6).map((x) => h("button.linkrow", { onclick: () => showPage(x.id) }, icon("book"), h("span", x.title))));
    }
    async function showPage(id) {
      try {
        const p = await api.lore_page(id);
        clear(lookResults,
          h("div.row.nowrap", h("b.grow", p.meta.title), h("button.linkish", { onclick: () => ctx.go("lore", { id }) }, "Open"), h("button.linkish", { onclick: () => { lookIn.value = ""; clear(lookResults); } }, "✕")),
          h("div.live-page-body", render(p.body, { autoLink: true, linkNames: names, selfId: id })));
      } catch (e) { toastError(e); }
    }

    root.append(
      h("div.live-bar", prevBtn, title, doneSlot, recBtn, nextBtn),
      st.has_plan
        ? h("div.live-grid",
          h("div.live-main", frame),
          h("div.stack.live-aside",
            fpanel.el,
            sessionHandouts,
            liveEncounters,
            liveBoards,
            liveWorldCard(),
            clocksCard(api.clocks()),
            card({ title: "Scratchpad" }, noteIn, h("p.tiny.faint", { style: { margin: "6px 0 8px" } }, st.recording ? "Notes are stamped with the recording time and go into the recap draft with the transcript." : "Notes go into the recap draft with the transcript."), notesList),
            card({ title: "Look up" }, lookIn, lookResults)))
        : card(null, empty("scroll", "This session has no plan yet", st.has_html ? "Turn its HTML notes into a plan to run it here." : "Write a plan first, then run it from here.",
          btn("Open the plan", { icon: "edit", kind: "primary", onclick: () => ctx.go("sessions", { id: sid, tab: "notes" }) }))));
    if (st.has_plan) loadScene();
    document.addEventListener("keydown", keys);
    ctx.onLeave(() => document.removeEventListener("keydown", keys));
    function keys(e) {
      if (e.target.closest("input, textarea")) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); nextBtn.click(); }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); prevBtn.click(); }
      if (e.key === "n") { e.preventDefault(); noteIn.focus(); }
      if (e.key === "/") { e.preventDefault(); lookIn.focus(); }
    }
    store.set("liveSession", sid);
  },
};
