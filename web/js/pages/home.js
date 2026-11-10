// Home: next session, recent sessions, campaign at a glance, tags, loose threads.
import { api } from "../api.js";
import { h, btn, card, empty, stat, promptBox, toastError, clear } from "../dom.js";
import { icon } from "../icons.js";
import { sessionChip, jobRow, updateJobRow } from "./sessions.js";
import { kindChip } from "./threads.js";
import { checklistCard, checklistOn } from "../checklist.js";

function greeting() {
  const hr = new Date().getHours();
  return hr < 5 ? "Good evening" : hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
}

export default {
  id: "home", label: "Home", icon: "home",

  async mount(ctx, params, root) {
    const camp = ctx.boot.campaign;
    const [list, tags, threads] = await Promise.all([api.sessions(), api.tags(), api.threads()]);
    const latest = list.length ? list[list.length - 1] : null;
    const upcoming = list.filter((s) => s.status === "planned").slice(-1)[0];
    const next = upcoming || latest;

    const create = async () => {
      const title = await promptBox("New session", "Session title", "");
      if (title == null) return;
      try {
        const id = await api.new_session(title || "Untitled session");
        ctx.go("sessions", { id });
      } catch (e) { toastError(e); }
    };
    const newSession = btn("New session", { icon: "plus", kind: "primary", onclick: create });

    const sub = next
      ? (next.status === "planned" ? `${camp.name} · Session ${next.number}: ${next.title} is next.` : `${camp.name} · Last played: Session ${next.number}, ${next.title}.`)
      : `${camp.name} · No sessions yet.`;
    root.append(ctx.header({ title: greeting(), subtitle: sub, icon: "feather", actions: [newSession] }));

    const nextCard = card({ title: upcoming ? "Next session" : "Latest session", actions: next ? h("button.linkish", { onclick: () => ctx.go("sessions", { id: next.id }) }, "Open") : null },
      next ? h("div.stack.sm",
        h("div.row", h("h2.session-title", `Session ${next.number}: ${next.title}`), sessionChip(next.status)),
        h("p.muted.small", { style: { margin: 0 } }, next.status === "planned"
          ? "Plan this session's scenes, or attach your HTML notes."
          : "Open it for the recap, the transcript and posting to Discord."),
        h("div.row",
          btn("Open session", { icon: "scroll", onclick: () => ctx.go("sessions", { id: next.id }) }),
          !upcoming ? btn("Plan the next one", { icon: "plus", kind: "ghost", onclick: create }) : null))
        : empty("scroll", "No sessions yet", "Create your first session to start planning.", btn("New session", { icon: "plus", kind: "primary", onclick: create })));

    // the next session's checklist, when it's switched on
    const checkSlot = h("div");
    if (upcoming && checklistOn(ctx)) checklistCard(ctx, upcoming.id, { title: `Before session ${upcoming.number ?? ""}` }).then((c) => c && checkSlot.append(c));

    const s = camp.stats;
    const glance = card({ title: "Campaign", actions: h("button.linkish", { onclick: () => ctx.go("settings", { section: "campaign" }) }, "Manage") },
      h("div.grid.c2", { style: { gap: "10px" } },
        stat("Lore pages", s.pages), stat("Sessions", s.sessions),
        stat("Recaps", s.recapped), stat("Maps", s.maps)));

    const recent = list.slice(-6).reverse();
    const recentCard = card({ title: "Recent sessions", actions: h("button.linkish", { onclick: () => ctx.go("sessions") }, "All sessions") },
      recent.length ? h("div.list", recent.map((x) =>
        h("div.list-row.click", { onclick: () => ctx.go("sessions", { id: x.id }) },
          h("div.ic", h("b.nums", x.number ?? "·")),
          h("div.main-col", h("div.title", x.title), h("div.meta", x.date || (x.source === "legendkeeper" ? "Imported from LegendKeeper" : ""))),
          sessionChip(x.status))))
        : h("p.muted.small", "Sessions you play will show up here."));

    const tagCard = card({ title: "Tags", actions: h("button.linkish", { onclick: () => ctx.go("graph") }, "Graph") },
      tags.length ? h("div.row", { style: { gap: "8px" } }, tags.slice(0, 18).map((t) =>
        h("button.tag.click", { onclick: () => ctx.go("lore", { q: "#" + t.tag }) }, "#" + t.tag, h("b", t.count))))
        : h("p.muted.small", "Add tags to pages to group them, e.g. #character or #westmarch."));

    const open = threads.filter((t) => t.status === "open").sort((a, b) => (a.created || "").localeCompare(b.created || ""));
    const review = threads.filter((t) => t.status === "proposed" || (t.status === "open" && t.suggestion)).length;
    const threadCard = card({ title: "Loose threads", actions: h("button.linkish", { onclick: () => ctx.go("threads") }, "All") },
      review ? h("button.notice.small.click-notice", { onclick: () => ctx.go("threads", { view: "review" }) }, icon("feather"),
        h("div", h("b", `${review} waiting for review`), " from the latest recap drafts")) : null,
      open.length ? h("div.list", { style: { marginTop: review ? "8px" : 0 } }, open.slice(0, 5).map((t) =>
        h("div.list-row.click", { onclick: () => ctx.go("threads") }, h("div.main-col", h("div.title", t.title), h("div.meta", (t.session_titles || []).slice(0, 1).join(""))), kindChip(t.kind))))
        : !review ? empty("link", "No open threads", "Hooks, promises and unanswered questions collect here. They're found when a recap is drafted, or add your own.") : null);

    const jobs = card({ title: "Working on" });
    jobs.classList.add("hidden");
    const jobList = h("div.stack.sm");
    jobs.append(jobList);
    ctx.onState((st) => {
      const tasks = st.tasks || [];
      jobs.classList.toggle("hidden", !tasks.length);
      const ids = tasks.map((j) => j.id).join(",");
      if (jobList.dataset.ids !== ids) {          // the set of jobs changed: rebuild the list
        jobList.dataset.ids = ids;
        clear(jobList, tasks.map((j) => j.session ? h("div.click-job", { onclick: (e) => { if (!e.target.closest("button")) ctx.go("sessions", { id: j.session, tab: j.kind === "recap" ? "recap" : "transcript" }); } }, jobRow(j)) : jobRow(j)));
      } else {                                     // same jobs: just update their progress
        tasks.forEach((j) => { const el = jobList.querySelector(`[data-job="${j.id}"]`); if (el) updateJobRow(el, j); });
      }
    });

    root.append(h("div.home-grid",
      h("div.span2.stack", jobs, nextCard, checkSlot), glance,
      h("div.span2", recentCard), h("div.stack", threadCard, tagCard)));
  },
};
