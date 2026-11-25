// Campaign stats: sessions and hours, who talks most, what the recaps keep coming back to, and loose threads over time.
import { api } from "../api.js";
import { h, card, empty, stat, fmtDuration } from "../dom.js";

const COLORS = ["#8B7BF5", "#E0679A", "#3FA35A", "#E08A4A", "#4A90E2", "#B8952A", "#9B6DD6", "#2FA3A0"];

export default {
  id: "stats", label: "Stats", icon: "chart",

  async mount(ctx, params, root) {
    const st = await api.campaign_stats();
    root.append(ctx.header({ title: "Campaign stats", subtitle: ctx.boot.campaign?.name || "", icon: "chart" }));
    if (!st.sessions) {
      root.append(card(null, empty("chart", "Nothing to count yet", "Play a session or two and come back.")));
      return;
    }

    const tiles = h("div.stat-row",
      stat("Sessions played", st.played, st.sessions > st.played ? `of ${st.sessions}` : ""),
      st.hours >= 1 ? stat("Hours recorded", st.hours) : stat("Recorded", st.hours ? fmtDuration(st.hours * 3600) : "–"),
      stat("Recaps", st.recapped),
      stat("Lore pages", st.pages));

    // spotlight: players' share of the players' talk time, the GM shown apart
    const players = st.spotlight.filter((p) => !p.gm);
    const gm = st.spotlight.filter((p) => p.gm);
    const playerTotal = players.reduce((a, p) => a + p.seconds, 0) || 1;
    const maxP = players[0]?.seconds || 1;
    const spotlight = card({ title: "Spotlight", actions: h("span.small.faint", "Talk time across every transcribed session") },
      players.length ? h("div.spotlight",
        players.map((p, i) => h("div.spot-row",
          h("span.tspk", { style: { color: COLORS[i % COLORS.length] } }, p.name),
          h("div.spot-track", h("div.spot-bar", { style: { width: `${Math.max(2, (p.seconds / maxP) * 100)}%`, background: COLORS[i % COLORS.length] } })),
          h("span.small.faint.nums", `${fmtDuration(p.seconds)} · ${Math.round((p.seconds / playerTotal) * 100)}%`))),
        gm.length ? h("p.tiny.faint", { style: { margin: "4px 0 0" } }, `The GM talked for ${fmtDuration(gm.reduce((a, p) => a + p.seconds, 0))}. Percentages are each player's share of the players' talk time.`) : null)
        : h("p.small.faint", { style: { margin: 0 } }, "Transcribe a session and name its speakers to see who talks how much."));

    const maxM = st.mentioned[0]?.count || 1;
    const mentioned = card({ title: "Most mentioned in recaps" },
      st.mentioned.length ? h("div.spotlight", st.mentioned.map((m) => h("div.spot-row",
        h("button.linkish.rel-name", { onclick: () => ctx.go("lore", { id: m.id }) }, m.title),
        h("div.spot-track", h("div.spot-bar", { style: { width: `${Math.max(2, (m.count / maxM) * 100)}%`, background: "var(--accent)" } })),
        h("span.small.faint.nums", `${m.count}× · ${m.sessions} session${m.sessions === 1 ? "" : "s"}`))))
        : h("p.small.faint", { style: { margin: 0 } }, "Once recaps mention your lore pages, the ones that come up most show here."));

    const th = st.threads;
    const perMax = Math.max(1, ...st.per_session.map((s) => Math.max(s.opened, s.resolved)));
    const played = st.per_session.filter((s) => s.status !== "planned");
    const threads = card({ title: "Loose threads", actions: h("button.linkish", { onclick: () => ctx.go("threads") }, "Open threads") },
      h("div.stack",
        h("div.row", { style: { gap: "8px", flexWrap: "wrap" } },
          [["open", "Open"], ["proposed", "To review"], ["resolved", "Resolved"], ["dismissed", "Dismissed"]].filter(([k]) => th[k]).map(([k, label]) =>
            h("span.tag", h("b", String(th[k])), " ", label))),
        played.length ? h("div.thread-bars", played.map((s) => h("div.thread-col", { title: `Session ${s.number}: ${s.title}\n${s.opened} opened, ${s.resolved} resolved` },
          h("div.thread-pair",
            h("div.tb.open", { style: { height: `${(s.opened / perMax) * 100}%` } }),
            h("div.tb.resolved", { style: { height: `${(s.resolved / perMax) * 100}%` } })),
          h("span.tiny.faint.nums", String(s.number ?? ""))))) : null,
        played.length ? h("div.row.tiny.faint", { style: { gap: "14px" } }, h("span", h("span.tb-key.open"), " opened"), h("span", h("span.tb-key.resolved"), " resolved"), h("span", "per session")) : null));

    const tags = card({ title: "Top tags" }, h("div.row", { style: { gap: "6px", flexWrap: "wrap" } },
      st.tags.map(([t, n]) => h("button.tag.click", { onclick: () => ctx.go("lore", { q: "#" + t }) }, "#" + t, h("span.faint", ` ${n}`)))));

    root.append(h("div.stack", tiles, h("div.grid.c2.stats-grid", spotlight, mentioned, threads, tags)));
  },
};
