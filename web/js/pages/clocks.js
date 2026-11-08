// Progress clocks for factions, villains and looming threats.
import { api } from "../api.js";
import { h, btn, card, clear, empty, toast, toastError, modal, confirmBox, promptBox } from "../dom.js";
import { icon } from "../icons.js";
import { seg, switchEl } from "../components.js";

const KINDS = [["faction", "Faction"], ["threat", "Threat"], ["project", "Project"], ["countdown", "Countdown"], ["other", "Other"]];
const COLORS = ["#E5626A", "#F0A04B", "#E9C64A", "#4FB477", "#3FA9A3", "#4A90E2", "#9381FF", "#B06AD9", "#17171A"];

/** A clock face: `segments` wedges, `filled` of them coloured. Clicking a wedge (when onSet is given) fills up to it. */
export function clockSvg(c, size = 120, onSet = null) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "-52 -52 104 104");
  svg.setAttribute("width", size); svg.setAttribute("height", size);
  svg.classList.add("clock-face");
  const n = c.segments, r = 48;
  const pt = (a) => [Math.sin(a) * r, -Math.cos(a) * r];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * 2 * Math.PI, a1 = ((i + 1) / n) * 2 * Math.PI;
    const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", `M0 0L${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}Z`);
    p.setAttribute("fill", i < c.filled ? c.color || "#E5626A" : "var(--clock-empty)");
    p.setAttribute("stroke", "var(--surface)");
    p.setAttribute("stroke-width", "2.5");
    p.setAttribute("stroke-linejoin", "round");
    if (onSet) {
      p.style.cursor = "pointer";
      p.addEventListener("click", (e) => { e.stopPropagation(); onSet(i + 1 === c.filled ? i : i + 1); });
    }
    svg.append(p);
  }
  const ring = document.createElementNS(ns, "circle");
  ring.setAttribute("r", r); ring.setAttribute("fill", "none"); ring.setAttribute("stroke", c.color || "#E5626A"); ring.setAttribute("stroke-width", "2");
  ring.setAttribute("stroke-opacity", ".5");
  svg.append(ring);
  return svg;
}

/** Tick a clock, asking what happened. Resolves to the updated clock, or null. */
export async function tickClock(c, delta = 1) {
  const note = h("input.input", { placeholder: delta > 0 ? "What did they do? (optional)" : "What set them back? (optional)" });
  setTimeout(() => note.focus(), 50);
  note.addEventListener("keydown", (e) => { if (e.key === "Enter") document.querySelector(".scrim .m-foot .btn.primary")?.click(); });
  const ok = await modal(`${delta > 0 ? "Advance" : "Set back"} “${c.name}”`, h("div.stack.sm",
    h("div.row", { style: { gap: "14px", alignItems: "center" } }, clockSvg({ ...c, filled: Math.max(0, Math.min(c.segments, c.filled + delta)) }, 64),
      h("div", h("b", `${Math.max(0, Math.min(c.segments, c.filled + delta))} of ${c.segments}`), c.when_full ? h("div.small.muted", "When full: " + c.when_full) : null)),
    note), [{ label: "Cancel", kind: "ghost", value: false }, { label: delta > 0 ? `+${delta}` : `${delta}`, kind: "primary", value: true }]);
  if (!ok) return null;
  try {
    const r = await api.clock_tick(c.id, delta, note.value.trim());
    if (r.filled_now) toast(`“${c.name}” is full!`, c.when_full || "Time for it to happen.", "warn", "clock", 10000);
    return r.clock;
  } catch (e) { toastError(e); return null; }
}

export async function editClock(c = {}) {
  const isNew = !c.id;
  const titles = await api.page_titles();
  const name = h("input.input", { value: c.name || "", placeholder: "e.g. The Thieves' Guild takes the docks" });
  const page = h("input.input", { value: titles.find((t) => t.id === c.page)?.title || "", list: "clock-pages", placeholder: "The faction or villain's page (optional)" });
  const dl = h("datalist#clock-pages", titles.map((t) => h("option", { value: t.title })));
  const note = h("textarea.input", { rows: 2, value: c.note || "", placeholder: "What are they working towards?" });
  const full = h("textarea.input", { rows: 2, value: c.when_full || "", placeholder: "What happens when it fills? (GM only)" });
  let segs = c.segments || 6, kind = c.kind || "faction", color = c.color || COLORS[0], gm = c.gm ?? true;
  const preview = h("span");
  const drawPrev = () => clear(preview, clockSvg({ segments: segs, filled: Math.min(c.filled || 0, segs), color }, 56));
  drawPrev();
  const custom = h("input.input", { type: "number", min: 2, max: 24, value: segs, style: { width: "80px" }, oninput: (e) => { segs = Math.max(2, Math.min(24, Number(e.target.value) || 6)); drawPrev(); } });
  const sw = h("div.row", { style: { gap: "6px" } }, COLORS.map((x) => h("button.color-dot", { class: x === color ? "on" : "", style: { background: x },
    onclick: (e) => { color = x; sw.querySelectorAll(".color-dot").forEach((d) => d.classList.remove("on")); e.currentTarget.classList.add("on"); drawPrev(); } })));
  const res = await modal(isNew ? "New clock" : "Edit clock", h("div.stack",
    h("div.row", { style: { gap: "14px", alignItems: "center" } }, preview, h("div.field.grow", h("label", "Name"), name)),
    h("div.grid.c2",
      h("div.field", h("label", "Segments"), h("div.row", { style: { gap: "6px" } },
        seg([[4, "4"], [6, "6"], [8, "8"], [12, "12"]], [4, 6, 8, 12].includes(segs) ? segs : null, (v) => { segs = v; custom.value = v; drawPrev(); }), custom)),
      h("div.field", h("label", "Kind"), h("select.select", { onchange: (e) => { kind = e.target.value; } }, KINDS.map(([k, l]) => h("option", { value: k, selected: k === kind }, l))))),
    h("div.field", h("label", "Linked page"), page, dl),
    h("div.field", h("label", "Goal"), note),
    h("div.field", h("label", "When it fills"), full),
    h("div.field", h("label", "Colour"), sw),
    switchEl(gm, (v) => { gm = v; }, "GM only (hidden from players)")),
  [isNew ? null : { label: "Delete", kind: "ghost danger", value: "delete" }, { label: "Cancel", kind: "ghost", value: false }, { label: isNew ? "Create" : "Save", kind: "primary", value: true }].filter(Boolean));
  if (res === "delete") {
    if (await confirmBox(`Delete “${c.name}”?`, "Its history goes with it.", "Delete", true)) { await api.clock_delete(c.id).catch(toastError); return "deleted"; }
    return null;
  }
  if (!res) return null;
  try {
    return await api.clock_save({ ...c, name: name.value.trim(), segments: segs, kind, color, gm, note: note.value.trim(), when_full: full.value.trim(),
      page: titles.find((t) => t.title === page.value.trim())?.id || null });
  } catch (e) { toastError(e); return null; }
}

export default {
  id: "clocks", label: "Clocks", icon: "clock",

  async mount(ctx, params, root) {
    const all = await api.clocks();
    const view = params.view || "active";
    const titles = await api.page_titles();
    const titleOf = (pid) => titles.find((t) => t.id === pid)?.title || pid;
    const active = all.filter((c) => !c.archived);
    const shown = view === "archived" ? all.filter((c) => c.archived) : active;
    ctx.side(h("h2", "Clocks"),
      h("button.side-item", { class: view === "active" ? "active" : "", onclick: () => ctx.go("clocks", {}) }, icon("clock"), h("span.grow", "Running"), h("span.count", active.length)),
      h("button.side-item", { class: view === "archived" ? "active" : "", onclick: () => ctx.go("clocks", { view: "archived" }) }, icon("box"), h("span.grow", "Archived"), h("span.count", all.length - active.length)),
      h("div", { style: { padding: "14px 6px" } }, btn("New clock", { icon: "plus", size: "sm", kind: "primary", onclick: async () => { if (await editClock()) ctx.reload(); } })));
    root.append(ctx.header({ title: "Clocks", subtitle: "What factions, villains and looming threats are doing while the party is busy.", icon: "clock",
      actions: [btn("New clock", { icon: "plus", kind: "primary", onclick: async () => { if (await editClock()) ctx.reload(); } })] }));
    if (!shown.length) {
      root.append(card(null, empty("clock", view === "archived" ? "Nothing archived" : "No clocks yet",
        "A clock fills a segment at a time as a faction or threat makes progress off-screen. Tick it between sessions or during play, and when it fills, it happens.",
        view === "archived" ? null : btn("Create a clock", { icon: "plus", kind: "primary", onclick: async () => { if (await editClock()) ctx.reload(); } }))));
      return;
    }
    root.append(h("div.clock-grid", shown.map((c) => {
      const set = async (v) => { const r = await tickClock(c, v - c.filled); if (r) ctx.reload(); };
      const hist = (c.history || []).slice(-4).reverse();
      return h("div.clock-card", { class: c.filled >= c.segments ? "full" : "" },
        h("div.clock-top",
          h("div.clock-face-wrap", clockSvg(c, 112, set), h("div.clock-count", `${c.filled}/${c.segments}`)),
          h("div.grow.stack.sm",
            h("div.row.nowrap", h("b.grow.clock-name", c.name), c.gm ? h("span.chip.warn", icon("lock"), "GM") : null),
            h("div.row.wrap", { style: { gap: "6px" } }, h("span.chip", KINDS.find((k) => k[0] === c.kind)?.[1] || c.kind),
              c.page ? h("button.tag.click", { onclick: () => ctx.go("lore", { id: c.page }) }, titleOf(c.page)) : null),
            c.note ? h("div.small.muted", c.note) : null,
            c.filled >= c.segments ? h("div.notice.warn.small", icon("alert"), h("span", h("b", "Full. "), c.when_full || "It happens.")) : null)),
        hist.length ? h("div.clock-hist", hist.map((x) => h("div.small", h("span.faint.nums", (x.world_label || x.time.slice(0, 10)) + " "),
          h("b", { style: { color: x.delta > 0 ? "var(--text)" : "var(--text-3)" } }, x.delta > 0 ? `+${x.delta}` : `${x.delta}`), x.note ? ` ${x.note}` : ""))) : null,
        h("div.row", { style: { gap: "6px" } },
          btn("+1", { size: "sm", kind: "primary", disabled: c.filled >= c.segments, onclick: async () => { if (await tickClock(c, 1)) ctx.reload(); } }),
          btn("−1", { size: "sm", disabled: c.filled <= 0, onclick: async () => { if (await tickClock(c, -1)) ctx.reload(); } }),
          h("div.spacer"),
          btn("", { icon: c.archived ? "rollback" : "box", size: "sm", kind: "ghost", title: c.archived ? "Bring back" : "Archive",
            onclick: async () => { await api.clock_save({ ...c, archived: !c.archived }).catch(toastError); ctx.reload(); } }),
          btn("", { icon: "edit", size: "sm", kind: "ghost", title: "Edit", onclick: async () => { if (await editClock(c)) ctx.reload(); } })));
    })));
  },
};

/** Compact clocks for live mode and lore pages. */
export function clocksCard(list, { title = "Clocks", onChange = null, playerView = false } = {}) {
  const box = h("div");
  const draw = (items) => {
    items = items.filter((c) => !c.archived && !(playerView && c.gm));
    if (!items.length) return clear(box);
    clear(box, card({ title }, h("div.stack.sm", items.map((c) => h("div.row.nowrap.clock-mini",
      clockSvg(c, 34), h("div.grow", h("div.small", h("b", c.name)), h("div.tiny.faint", `${c.filled}/${c.segments}` + (c.filled >= c.segments ? " · full" : ""))),
      playerView ? null : btn("+1", { size: "sm", disabled: c.filled >= c.segments, onclick: async () => {
        const r = await tickClock(c, 1);
        if (r) { onChange?.(); draw(items.map((x) => (x.id === r.id ? r : x))); }
      } }))))));
  };
  Promise.resolve(list).then(draw).catch(() => {});
  return box;
}
