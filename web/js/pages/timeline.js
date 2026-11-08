// Timeline: lanes of events and spans on the in-world calendar. Scroll to zoom, drag or Shift+scroll to pan,
// drag blocks to move them (sideways in time, up and down between lanes), drag a span's right edge to resize it,
// double-click an empty spot to add a block there.
import { api } from "../api.js";
import { h, btn, card, clear, empty, toast, toastError, modal, confirmBox, store } from "../dom.js";
import { icon } from "../icons.js";
import { switchEl } from "../components.js";

const COLORS = ["#9381FF", "#E5626A", "#F0A04B", "#4FB477", "#4A90E2", "#B06AD9", "#3FA9A3", "#E9C64A"];

// ---- calendar arithmetic (the same rules as studio/worldcal.py) ----------------------------
function calMath(cal) {
  const base = cal.months.reduce((s, m) => s + m.days, 0);
  const hits = (rule, y, off = 0) => {
    for (const t of String(rule).split(",").filter(Boolean)) {
      const neg = t.startsWith("!"), k = Number(t.replace("!", ""));
      if (k && ((y - off) % k + k) % k === 0) return !neg;
    }
    return false;
  };
  const monthLen = (y, m) => cal.months[m].days + cal.leap.reduce((s, x) => s + (x.month === m && hits(x.rule, y, x.offset || 0) ? x.days : 0), 0);
  const yearLen = (y) => cal.months.reduce((s, _, m) => s + monthLen(y, m), 0);
  const fl = Math.floor;
  const subsets = (arr) => { const out = []; for (let i = 1; i < 1 << arr.length; i++) out.push(arr.filter((_, j) => (i >> j) & 1)); return out; };
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const leapBetween = (y0, y1) => {
    let total = 0;
    for (const x of cal.leap) {
      const off = x.offset || 0, count = (k) => fl((y1 - 1 - off) / k) - fl((y0 - 1 - off) / k);
      const seen = [];
      for (const t of String(x.rule).split(",").filter(Boolean)) {
        const neg = t.startsWith("!"), k = Number(t.replace("!", ""));
        if (!k) continue;
        let c = count(k);
        for (const sub of subsets(seen)) { let l = k; for (const p of sub) l = (l * p) / gcd(l, p); c += (sub.length % 2 ? -1 : 1) * count(l); }
        if (!neg) total += c * x.days;
        seen.push(k);
      }
    }
    return total;
  };
  const yearStart = (y) => (y >= 1 ? (y - 1) * base + leapBetween(1, y) : -((1 - y) * base + leapBetween(y, 1)));
  const fromDays = (n) => {
    let y = 1 + Math.floor(n / (base + 0.0001 + cal.leap.length * 0.25));
    while (yearStart(y) > n) y--;
    while (yearStart(y + 1) <= n) y++;
    let rest = n - yearStart(y);
    for (let m = 0; m < cal.months.length; m++) { const ml = monthLen(y, m); if (rest < ml) return { y, m, d: rest + 1 }; rest -= ml; }
    return { y, m: cal.months.length - 1, d: 1 };
  };
  const toDays = (d) => { let n = yearStart(d.y); for (let i = 0; i < d.m; i++) n += monthLen(d.y, i); return n + d.d - 1; };
  const neg = cal.eras.find((e) => e.negative), pos = cal.eras.filter((e) => !e.negative).sort((a, b) => (a.start || 1) - (b.start || 1));
  const yearLabel = (y) => {
    if (y < 1 && !cal.has_year_zero && neg) return `${1 - y}${neg.abbr ? " " + neg.abbr : ""}`;
    let era = null;
    for (const e of pos) if (y >= (e.start || 1)) era = e;
    const shown = era && (era.start || 1) > 1 ? y - era.start + 1 : y;
    return `${shown}${era?.abbr ? " " + era.abbr : ""}`;
  };
  return { monthLen, yearLen, yearStart, fromDays, toDays, yearLabel, base };
}

const ord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[n % 10] || "th"}`;

export default {
  id: "timeline", label: "Timeline", icon: "history",

  async mount(ctx, params, root) {
    const v = await api.timeline();
    const C = calMath(v.cal);
    let player = !!store.get("timelinePlayer", false);
    const laneById = Object.fromEntries(v.lanes.map((l) => [l.id, l]));
    const lanes = [...v.lanes.filter((l) => !(player && l.gm)), ...(v.sessions.length ? [{ id: "__sessions", name: "Sessions", color: "#4A90E2", virtual: true }] : [])];
    const blocks = v.blocks.filter((b) => !(player && (b.gm || laneById[b.lane]?.gm)));

    ctx.side(h("h2", "Timeline"),
      h("div.group-label", "Lanes"),
      lanes.map((l) => h("div.side-item.tl-lane-item", h("span.ball", { style: { background: l.color } }), h("span.grow", l.name), l.gm ? icon("lock") : null)),
      h("div", { style: { padding: "10px 6px" } }, btn("Edit lanes", { icon: "edit", size: "sm", onclick: () => editLanes(ctx, v.lanes) })),
      h("p.small.faint", { style: { margin: "6px 10px" } }, v.has_calendar ? "Dates use your calendar." : "Dates use the ordinary calendar until you set one up on the Calendar page."));

    // ---- camera: px per day and the day at the left edge
    const allDays = [...blocks.flatMap((b) => [b.a, b.b]), ...v.sessions.map((s) => s.a), ...(v.today != null ? [v.today] : [])];
    const lo = allDays.length ? Math.min(...allDays) : C.yearStart(1), hi = allDays.length ? Math.max(...allDays) : C.yearStart(2);
    const saved = store.get("timelineCam", null);
    const LANE_H = 64, HEAD = 46;
    const stage = h("div.tl-stage");
    const axis = h("div.tl-axis"), body = h("div.tl-body"), nowLine = h("div.tl-now");
    stage.append(axis, body, nowLine);
    root.classList.add("map-page");
    const viewBtn = btn("", { icon: "eye", size: "sm", kind: player ? "primary" : "", title: player ? "Showing what players see" : "Preview what players see",
      onclick: () => { store.set("timelinePlayer", !player); ctx.go("timeline", {}); } });
    root.append(h("div.map-bar",
      h("div.grow", h("h1.page-title", { style: { margin: 0, fontSize: "24px" } }, "Timeline"), h("div.small.faint", `${blocks.length} blocks · double-click to add one, drag to move it`)),
      btn("Fit everything", { icon: "fit", size: "sm", onclick: () => fitAll() }),
      v.today != null ? btn("Today", { icon: "calendar", size: "sm", onclick: () => center(v.today) }) : null,
      btn("", { icon: "minus", size: "sm", title: "Zoom out", onclick: () => zoomAt(cam.k / 1.6, stage.clientWidth / 2) }),
      btn("", { icon: "plus", size: "sm", title: "Zoom in", onclick: () => zoomAt(cam.k * 1.6, stage.clientWidth / 2) }),
      viewBtn,
      btn("New block", { icon: "plus", size: "sm", kind: "primary", onclick: () => editBlock(ctx, v, C, { lane: v.lanes[0].id, startDay: v.today ?? Math.round((cam.x0 + stage.clientWidth / 2 / cam.k)) }) })),
    stage);

    let cam = saved || { x0: lo - (hi - lo) * 0.05 - 30, k: 1 };
    const W = () => stage.clientWidth || 900;
    const fitAll = () => { const span = Math.max(30, hi - lo); cam.k = (W() * 0.78) / span; cam.x0 = lo - span * 0.06; draw(); };
    const center = (d) => { cam.x0 = d - W() / 2 / cam.k; draw(); };
    const zoomAt = (k, px) => { k = Math.min(60, Math.max(1e-6, k)); const d = cam.x0 + px / cam.k; cam.k = k; cam.x0 = d - px / k; draw(); };
    const X = (d) => (d - cam.x0) * cam.k;

    // pick tick spacing from the zoom: days, weeks… up to millennia
    const ticks = () => {
      const start = cam.x0, end = cam.x0 + W() / cam.k, out = [];
      const yearPx = C.base * cam.k;
      if (yearPx < 60) {
        const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 50000];
        const step = steps.find((s) => s * yearPx >= 80) || 100000;
        let y = C.fromDays(Math.floor(start)).y; y = Math.floor(y / step) * step;
        for (; C.yearStart(y) <= end && out.length < 400; y += step) out.push({ d: C.yearStart(y), label: C.yearLabel(y), major: true });
        return out;
      }
      const monthPx = (C.base / v.cal.months.length) * cam.k;
      let { y } = C.fromDays(Math.floor(start));
      if (monthPx < 90) {
        for (; C.yearStart(y) <= end && out.length < 400; y++) {
          out.push({ d: C.yearStart(y), label: C.yearLabel(y), major: true });
          if (monthPx > 22) for (let m = 1; m < v.cal.months.length; m++) out.push({ d: C.toDays({ y, m, d: 1 }), label: monthPx > 50 ? v.cal.months[m].name.slice(0, 3) : "", major: false });
        }
        return out;
      }
      let { m } = C.fromDays(Math.floor(start));
      const dayPx = cam.k;
      while (out.length < 600) {
        const first = C.toDays({ y, m, d: 1 });
        if (first > end) break;
        out.push({ d: first, label: `${v.cal.months[m].name} ${C.yearLabel(y)}`, major: true });
        const len = C.monthLen(y, m);
        const every = dayPx > 30 ? 1 : dayPx > 12 ? 5 : dayPx > 5 ? 10 : 0;
        if (every) for (let dd = every === 1 ? 2 : every; dd <= len; dd += every) out.push({ d: first + dd - 1, label: String(dd), major: false });
        m++; if (m >= v.cal.months.length) { m = 0; y++; }
      }
      return out;
    };

    const laneRow = (id) => lanes.findIndex((l) => l.id === id);
    const drawn = new Map();
    function draw() {
      store.set("timelineCam", cam);
      clear(axis, ticks().map((t) => h("div.tl-tick", { class: t.major ? "major" : "", style: { left: X(t.d) + "px" } }, t.label ? h("span", t.label) : null)));
      body.style.height = lanes.length * LANE_H + 20 + "px";
      clear(body, lanes.map((l, i) => h("div.tl-lane", { style: { top: i * LANE_H + "px", height: LANE_H + "px", "--c": l.color }, "data-lane": l.id },
        h("div.tl-lane-name", l.name))));
      drawn.clear();
      const items = [...blocks.map((b) => ({ ...b, kind: "block" })), ...v.sessions.map((s) => ({ ...s, lane: "__sessions", kind: "session", title: `${s.number ?? ""}. ${s.title}` }))];
      // stack overlapping blocks in a lane into up to 2 rows
      const rows = {};
      items.sort((a, b) => a.a - b.a);
      for (const it of items) {
        const r = laneRow(it.lane);
        if (r < 0) continue;
        const x1 = X(it.a), x2 = Math.max(X(it.b + 1), x1 + 14);
        const isSpan = it.kind === "block" && !!it.end;
        if (x2 < -200 || x1 > W() + 200) continue;
        const span = it.kind === "block" && !!it.end;      // a block without an end is a moment, even if only its year is known
        const labelW = Math.min(240, it.title.length * 7 + 26);
        const ends = rows[it.lane] ||= [-1e9, -1e9];
        const sub = ends[0] <= x1 ? 0 : ends[1] <= x1 ? 1 : 0;
        ends[sub] = Math.max(x2, x1 + labelW) + 6;
        const color = it.color || laneById[it.lane]?.color || "#4A90E2";
        const node = h("div.tl-block", { class: `${span ? "span" : "point"} ${it.kind}${it.gm ? " gm" : ""}`,
          style: { left: x1 + "px", width: span ? x2 - x1 + "px" : "auto", top: r * LANE_H + 10 + sub * 24 + "px", "--c": color }, title: `${it.title}\n${it.label}` },
          span ? null : h("span.tl-dot"), h("span.tl-text", it.gm ? icon("lock") : null, it.title),
          span && it.kind === "block" && !player ? h("span.tl-grip") : null);
        node.addEventListener("pointerdown", (e) => startDrag(e, it, node));
        body.append(node);
        drawn.set(it.id, node);
      }
      if (v.today != null) { nowLine.style.left = X(v.today) + "px"; nowLine.hidden = X(v.today) < 0 || X(v.today) > W(); } else nowLine.hidden = true;
    }

    // ---- interaction
    let drag = null;
    function startDrag(e, it, node) {
      e.stopPropagation();
      const resize = e.target.classList.contains("tl-grip");
      drag = { it, node, sx: e.clientX, sy: e.clientY, moved: false, resize, a: it.a, b: it.b, lane: it.lane };
      node.setPointerCapture(e.pointerId);
      node.onpointermove = (ev) => {
        if (it.kind !== "block" || player) return;
        const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
        if (Math.hypot(dx, dy) > 4) drag.moved = true;
        if (!drag.moved) return;
        const dd = Math.round(dx / cam.k);
        if (resize) { drag.b = Math.max(drag.a, it.b + dd); node.style.width = Math.max(14, X(drag.b + 1) - X(it.a)) + "px"; return; }
        drag.a = it.a + dd; drag.b = it.b + dd;
        node.style.left = X(drag.a) + "px";
        const r = Math.max(0, Math.min(lanes.length - 1, Math.floor((ev.clientY - body.getBoundingClientRect().top) / LANE_H)));
        if (!lanes[r].virtual) { drag.lane = lanes[r].id; node.style.top = r * LANE_H + 10 + "px"; }
      };
      node.onpointerup = async () => {
        node.onpointermove = node.onpointerup = null;
        const d = drag; drag = null;
        if (!d.moved) return it.kind === "session" ? ctx.go("sessions", { id: it.id }) : showBlock(ctx, v, C, it, player);
        // keep the block's precision: a year-only block moves by whole years, a month block by months
        const precise = (date, n) => {
          const f = C.fromDays(n);
          if (date.m == null) return { y: f.y };
          if (date.d == null) return { y: f.y, m: f.m };
          return f;
        };
        const start = precise(it.start, d.a);
        const end = it.end ? precise(it.end, d.b) : (d.resize && d.b > d.a ? C.fromDays(d.b) : null);
        try { await api.timeline_save_block({ ...stripBlock(it), start, end, lane: d.lane }); ctx.reload(); } catch (err) { toastError(err); }
      };
    }
    let pan = null;
    stage.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".tl-block")) return;
      pan = { x: e.clientX, x0: cam.x0 };
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener("pointermove", (e) => { if (!pan) return; cam.x0 = pan.x0 - (e.clientX - pan.x) / cam.k; draw(); });
    stage.addEventListener("pointerup", () => { pan = null; });
    stage.addEventListener("wheel", (e) => {
      e.preventDefault();
      const px = e.clientX - stage.getBoundingClientRect().left;
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.shiftKey) zoomAt(cam.k * Math.exp(-e.deltaY * 0.002), px);
      else { cam.x0 += (e.deltaX || e.deltaY) / cam.k; draw(); }
    }, { passive: false });
    stage.addEventListener("dblclick", (e) => {
      if (player || e.target.closest(".tl-block")) return;
      const r = body.getBoundingClientRect();
      const row = Math.floor((e.clientY - r.top) / LANE_H);
      const lane = lanes[row] && !lanes[row].virtual ? lanes[row].id : v.lanes[0].id;
      editBlock(ctx, v, C, { lane, startDay: Math.round(cam.x0 + (e.clientX - stage.getBoundingClientRect().left) / cam.k) });
    });
    const ro = new ResizeObserver(() => draw());
    ro.observe(stage);
    ctx.onLeave(() => ro.disconnect());
    if (!saved) requestAnimationFrame(fitAll); else draw();
    if (!blocks.length && !v.sessions.length) toast("An empty timeline", "Double-click anywhere to add the first block.", "", "history", 5000);
  },
};

function stripBlock(b) {
  const { a, b: _b, label, kind, ...rest } = b;
  return rest;
}

function dateFields(cal, C, date) {
  const prec = date.m == null ? "year" : date.d == null ? "month" : "day";
  let p = prec;
  const y = h("input.input", { type: "number", value: date.y, style: { width: "110px" } });
  const m = h("select.select", cal.months.map((mo, i) => h("option", { value: i, selected: i === (date.m ?? 0) }, mo.name)));
  const d = h("input.input", { type: "number", min: 1, value: date.d ?? 1, style: { width: "74px" } });
  const precSel = h("select.select", { style: { width: "auto" }, onchange: (e) => { p = e.target.value; sync(); } },
    [["year", "Year"], ["month", "Month"], ["day", "Day"]].map(([k, l]) => h("option", { value: k, selected: k === prec }, l)));
  const sync = () => { m.hidden = p === "year"; d.hidden = p !== "day"; };
  sync();
  return { el: h("div.row", { style: { gap: "6px", flexWrap: "nowrap" } }, precSel, d, m, y),
    value: () => (p === "year" ? { y: Number(y.value) || 1 } : p === "month" ? { y: Number(y.value) || 1, m: Number(m.value) } : { y: Number(y.value) || 1, m: Number(m.value), d: Number(d.value) || 1 }) };
}

async function editBlock(ctx, v, C, b) {
  const isNew = !b.id;
  const titles = await api.page_titles();
  const startDate = b.start || (() => { const f = C.fromDays(b.startDay ?? 0); return { y: f.y }; })();
  const title = h("input.input", { value: b.title || "", placeholder: "e.g. The Founding of Millbrook" });
  const lane = h("select.select", v.lanes.map((l) => h("option", { value: l.id, selected: l.id === b.lane }, l.name)));
  const page = h("input.input", { value: titles.find((t) => t.id === b.page)?.title || "", list: "tl-pages", placeholder: "Optional" });
  const dl = h("datalist#tl-pages", titles.map((t) => h("option", { value: t.title })));
  const note = h("textarea.input", { rows: 3, value: b.note || "" });
  const start = dateFields(v.cal, C, startDate);
  let hasEnd = !!b.end;
  const end = dateFields(v.cal, C, b.end || startDate);
  end.el.hidden = !hasEnd;
  let gm = !!b.gm, color = b.color || "";
  const sw = h("div.row", { style: { gap: "6px" } }, ["", ...COLORS].map((c) => h("button.color-dot", { class: c === color ? "on" : "", style: { background: c || "var(--line)" }, title: c || "Lane colour",
    onclick: (e) => { color = c; sw.querySelectorAll(".color-dot").forEach((x) => x.classList.remove("on")); e.currentTarget.classList.add("on"); } })));
  const res = await modal(isNew ? "New block" : "Edit block", h("div.stack",
    h("div.field", h("label", "Title"), title),
    h("div.field", h("label", "When"), start.el),
    switchEl(hasEnd, (val) => { hasEnd = val; end.el.hidden = !val; }, "It lasts a while (a span)"),
    end.el,
    h("div.grid.c2", h("div.field", h("label", "Lane"), lane), h("div.field", h("label", "Lore page"), page, dl)),
    h("div.field", h("label", "Notes"), note),
    h("div.field", h("label", "Colour"), sw),
    switchEl(gm, (val) => { gm = val; }, "GM only")),
  [isNew ? null : { label: "Delete", kind: "ghost danger", value: "delete" }, { label: "Cancel", kind: "ghost", value: false }, { label: isNew ? "Add" : "Save", kind: "primary", value: true }].filter(Boolean), { wide: true });
  if (res === "delete") {
    if (await confirmBox(`Delete “${b.title}”?`, "", "Delete", true)) { await api.timeline_delete_block(b.id).catch(toastError); ctx.reload(); }
    return;
  }
  if (!res) return;
  if (!title.value.trim()) return toast("Give it a title", "", "warn", "alert");
  try {
    await api.timeline_save_block({ ...stripBlock(b), title: title.value.trim(), lane: lane.value, start: start.value(), end: hasEnd ? end.value() : null,
      page: titles.find((t) => t.title === page.value.trim())?.id || null, note: note.value.trim(), gm, color });
    ctx.reload();
  } catch (e) { toastError(e); }
}

async function showBlock(ctx, v, C, b, player) {
  const titles = await api.page_titles();
  const res = await modal(b.title, h("div.stack.sm",
    h("div.muted", b.label),
    b.note ? h("p", { style: { margin: 0, whiteSpace: "pre-wrap" } }, b.note) : null,
    b.page ? h("button.linkrow", { onclick: () => { document.querySelector(".scrim .m-head .btn")?.click(); ctx.go("lore", { id: b.page }); } }, icon("book"), h("span", titles.find((t) => t.id === b.page)?.title || b.page)) : null),
  player ? [{ label: "Close", kind: "ghost", value: false }] : [{ label: "Close", kind: "ghost", value: false }, { label: "Edit", kind: "primary", icon: "edit", value: true }]);
  if (res) editBlock(ctx, v, C, b);
}

async function editLanes(ctx, lanes0) {
  const lanes = lanes0.map((l) => ({ ...l }));
  const list = h("div.stack.sm");
  const draw = () => clear(list, lanes.map((l, i) => h("div.setup-row",
    h("input.color-in", { type: "color", value: /^#[0-9a-f]{6}$/i.test(l.color) ? l.color : "#9381ff", oninput: (e) => { l.color = e.target.value; } }),
    h("input.input", { value: l.name, oninput: (e) => { l.name = e.target.value; } }),
    switchEl(!!l.gm, (val) => { l.gm = val; }, "GM only"),
    btn("", { icon: "up", size: "sm", kind: "ghost", onclick: () => { if (i) { [lanes[i - 1], lanes[i]] = [lanes[i], lanes[i - 1]]; draw(); } } }),
    btn("", { icon: "x", size: "sm", kind: "ghost", title: "Remove (its blocks move to the first lane)", onclick: () => { if (lanes.length > 1) { lanes.splice(i, 1); draw(); } } }))),
  h("div", btn("Add a lane", { icon: "plus", size: "sm", onclick: () => { lanes.push({ name: "", color: COLORS[lanes.length % COLORS.length] }); draw(); } })));
  draw();
  const ok = await modal("Lanes", h("div.stack.sm", h("p.small.muted", { style: { margin: 0 } }, "Rows on the timeline: world history, the party, each faction…"), list),
    [{ label: "Cancel", kind: "ghost", value: false }, { label: "Save", kind: "primary", value: true }], { wide: true });
  if (!ok) return;
  try { await api.timeline_save_lanes(lanes.filter((l) => l.name.trim())); ctx.reload(); } catch (e) { toastError(e); }
}
