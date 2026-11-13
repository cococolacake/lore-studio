// The in-world calendar: months, moons, holidays, events and sessions, plus a setup tab to build any calendar.
import { api } from "../api.js";
import { h, btn, card, clear, empty, toast, toastError, modal, confirmBox, store } from "../dom.js";
import { icon } from "../icons.js";
import { seg, switchEl } from "../components.js";

const ord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[n % 10] || "th"}`;

/** A moon drawn at phase f (0 new, 0.5 full). */
export function moonSvg(f, color = "#E8E4D8", size = 16, title = "") {
  const r = 10, k = Math.cos(2 * Math.PI * f), s = f < 0.5 ? 1 : -1;
  const pts = [];
  for (let i = 0; i <= 24; i++) { const t = -Math.PI / 2 + (Math.PI * i) / 24; pts.push([s * r * Math.cos(t), r * Math.sin(t)]); }
  for (let i = 24; i >= 0; i--) { const t = -Math.PI / 2 + (Math.PI * i) / 24; pts.push([s * k * r * Math.cos(t), r * Math.sin(t)]); }
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "-12 -12 24 24");
  svg.setAttribute("width", size); svg.setAttribute("height", size);
  svg.classList.add("moon");
  svg.innerHTML = `<title>${title.replace(/</g, "")}</title><circle r="${r}" fill="#2a2633" stroke="${color}" stroke-opacity=".55" stroke-width="1"/>`
    + `<path d="M${pts.map((p) => p.map((v) => v.toFixed(2)).join(" ")).join("L")}Z" fill="${color}"/>`;
  return svg;
}

export default {
  id: "calendar", label: "Calendar", icon: "calendar",

  async mount(ctx, params, root) {
    let info = await api.calendar();
    if (!info.cal) return startScreen(ctx, root, info.presets);
    const tab = params.tab || "month";
    const cal = info.cal;

    ctx.side(h("h2", "Calendar"),
      h("div",
        h("button.side-item", { class: tab === "month" ? "active" : "", onclick: () => ctx.go("calendar", { tab: "month" }) }, icon("calendar"), h("span", "Month")),
        h("button.side-item", { class: tab === "setup" ? "active" : "", onclick: () => ctx.go("calendar", { tab: "setup" }) }, icon("gear"), h("span", "Set up the calendar"))),
      h("div.group-label", "Coming up"),
      info.upcoming.length ? info.upcoming.slice(0, 12).map((u) => h("button.side-item.up-item", { onclick: () => ctx.go("calendar", { y: u.date.y, m: u.date.m }) },
        icon(u.kind === "holiday" ? "star" : "flag"), h("span.grow", h("span.ellipsis", u.title), h("small", u.in === 1 ? "tomorrow" : `in ${u.in} days`)))) :
        h("p.small.faint", { style: { padding: "0 10px" } }, "Nothing in the next 30 days."));

    root.append(todayCard(ctx, info));
    if (tab === "setup") return setup(ctx, root, cal);
    return monthView(ctx, root, cal, params);
  },
};

// ---------------------------------------------------------------------------
function startScreen(ctx, root, presets) {
  root.append(ctx.header({ title: "Calendar", subtitle: "Your world's own months, weeks, moons and holidays.", icon: "calendar" }),
    card(null, empty("calendar", "No calendar yet",
      "Start from one of these and change anything: month names and lengths, festival days outside the week, leap rules, any number of moons, eras, seasons and holidays. A LegendKeeper calendar comes across on import.",
      h("div.row.wrap", { style: { gap: "8px", justifyContent: "center" } }, presets.map(([k, name]) =>
        btn(name, { icon: "calendar", kind: k === "simple" ? "primary" : "", onclick: async () => {
          try { await api.calendar_create(k); ctx.go("calendar", { tab: "setup" }); } catch (e) { toastError(e); }
        } }))))));
}

// ---------------------------------------------------------------------------
function todayCard(ctx, info) {
  const cal = info.cal;
  const moons = h("div.today-moons");
  api.calendar_month(cal.current.y, cal.current.m).then((v) => {
    const day = v.days[cal.current.d - 1];
    clear(moons, (day?.moons || []).map((mo) => h("span.today-moon", moonSvg(mo.f, mo.color, 22, mo.name), h("span", h("b", mo.name), h("small", mo.phase)))));
  }).catch(() => {});
  const step = (n, label) => btn(label, { size: "sm", onclick: async () => {
    try { await api.calendar_advance(n); ctx.reload(); } catch (e) { toastError(e); }
  } });
  return h("div.today-card",
    h("div.grow",
      h("div.tiny.caps.faint", "Today in the world"),
      h("div.today-date", info.today),
      moons),
    h("div.today-actions",
      h("div.row", { style: { gap: "6px" } }, step(-1, "−1 day"), step(1, "+1 day"), step(cal.weekdays.length, `+1 ${cal.weekdays.length === 7 ? "week" : "week"}`)),
      h("div.row", { style: { gap: "6px" } },
        btn("Go to today", { size: "sm", kind: "ghost", onclick: () => ctx.go("calendar", { y: cal.current.y, m: cal.current.m }) }),
        btn("Set the date…", { size: "sm", kind: "ghost", icon: "edit", onclick: () => pickDate(cal, cal.current, "Set today's date").then(async (d) => {
          if (!d) return;
          try { await api.calendar_set_today(d); ctx.reload(); } catch (e) { toastError(e); }
        }) }))));
}

/** A small date picker modal for this calendar. Resolves to {y, m, d} or null. */
export async function pickDate(cal, start, title = "Pick a date") {
  const y = h("input.input", { type: "number", value: start?.y ?? cal.current.y, style: { width: "110px" } });
  const m = h("select.select", cal.months.map((mo, i) => h("option", { value: i, selected: i === (start?.m ?? cal.current.m) }, mo.name)));
  const d = h("input.input", { type: "number", min: 1, value: start?.d ?? cal.current.d, style: { width: "80px" } });
  const ok = await modal(title, h("div.row", { style: { gap: "8px", alignItems: "flex-end" } },
    h("div.field", h("label", "Day"), d), h("div.field.grow", h("label", "Month"), m), h("div.field", h("label", "Year"), y)),
  [{ label: "Cancel", kind: "ghost", value: false }, { label: "OK", kind: "primary", value: true }]);
  if (!ok) return null;
  return { y: Number(y.value) || 1, m: Number(m.value), d: Math.max(1, Number(d.value) || 1) };
}

// ---------------------------------------------------------------------------
async function monthView(ctx, root, cal, params) {
  let y = params.y != null ? Number(params.y) : cal.current.y;
  let mi = params.m != null ? Number(params.m) : cal.current.m;
  const v = await api.calendar_month(y, mi);
  const go = (yy, mm) => {
    if (mm < 0) { yy -= 1; mm = cal.months.length - 1; }
    if (mm >= cal.months.length) { yy += 1; mm = 0; }
    ctx.go("calendar", { y: yy, m: mm });
  };
  const yearIn = h("input.input.year-in", { type: "number", value: y, onchange: (e) => go(Number(e.target.value) || y, mi) });
  const head = h("div.cal-head",
    btn("", { icon: "left", title: "Previous month", onclick: () => go(y, mi - 1) }),
    h("div.cal-title", h("h1", v.name), h("span.muted", v.year_label)),
    btn("", { icon: "right", title: "Next month", onclick: () => go(y, mi + 1) }),
    h("div.spacer"),
    h("select.select.month-sel", { onchange: (e) => go(y, Number(e.target.value)) }, cal.months.map((mo, i) => h("option", { value: i, selected: i === mi }, mo.name))),
    yearIn);

  const cellFor = (day) => {
    const majors = day.moons.filter((mo) => mo.full || mo.new);
    return h("button.cal-day", { class: (day.today ? "today " : "") + (day.events.length || day.sessions.length || day.holidays.length ? "busy" : ""),
      onclick: () => dayDialog(ctx, cal, { y, m: mi, d: day.d }, day) },
      h("div.cal-num", h("span", day.d),
        h("span.cal-moons", (majors.length ? majors : []).map((mo) => moonSvg(mo.f, mo.color, 13, `${mo.name}: ${mo.phase}`)))),
      day.seasons.map((s) => h("div.cal-season", s)),
      day.holidays.map((ho) => h("div.cal-chip.holiday", { style: ho.color ? { "--c": ho.color } : {} }, ho.name)),
      day.sessions.map((s) => h("div.cal-chip.session", `Session ${s.number}`)),
      day.events.map((e) => h("div.cal-chip.event", { class: e.gm ? "gm" : "", style: e.color ? { "--c": e.color } : {} }, e.gm ? icon("lock") : null, e.title)));
  };

  let grid;
  if (v.intercalary || v.start_weekday == null) {
    grid = h("div.cal-grid.festival", v.days.map(cellFor));
  } else {
    const w = v.weekdays.length;
    const blanks = Array.from({ length: v.start_weekday }, () => h("div.cal-day.blank"));
    grid = h("div.cal-grid", { style: { gridTemplateColumns: `repeat(${w}, minmax(0, 1fr))` } },
      v.weekdays.map((n) => h("div.cal-wd", n)), blanks, v.days.map(cellFor));
  }
  root.append(card(null, h("div.stack", head, v.intercalary ? h("p.small.muted", { style: { margin: 0 } }, "Festival days: outside the week.") : null, grid,
    h("div.row.small.faint", { style: { gap: "14px" } }, "Click a day to add an event, date a session or make it today.",
      cal.moons.length ? h("span.row", { style: { gap: "8px" } }, cal.moons.map((mo) => h("span.row", { style: { gap: "4px" } }, moonSvg(0.5, mo.color, 12), mo.name))) : null))));
}

async function dayDialog(ctx, cal, date, day) {
  const dateText = await api.calendar_format(date);
  const sessions = await api.sessions();
  const sessSel = h("select.select", h("option", { value: "" }, "Pick a session…"),
    sessions.map((s) => h("option", { value: s.id }, `Session ${s.number ?? "?"}: ${s.title}`)));
  const body = h("div.stack",
    h("div.row.wrap", { style: { gap: "12px" } }, day.moons.map((mo) => h("span.today-moon", moonSvg(mo.f, mo.color, 20), h("span", h("b", mo.name), h("small", mo.phase))))),
    day.holidays.length ? h("div.stack.sm", day.holidays.map((ho) => h("div", h("b", ho.name), ho.note ? h("div.small.muted", ho.note) : null))) : null,
    day.sessions.length ? h("div.row.wrap", { style: { gap: "6px" } }, day.sessions.map((s) => h("button.tag.click", { onclick: () => { closeAll(); ctx.go("sessions", { id: s.id }); } }, `Session ${s.number}: ${s.title}`))) : null,
    h("div.stack.sm",
      h("div.row", h("b.grow", "Events"), btn("Add an event", { size: "sm", icon: "plus", onclick: () => { closeAll(); editEvent(ctx, cal, { date }); } })),
      day.events.length ? day.events.map((e) => h("div.row.event-row",
        h("span.ball", { style: { background: e.color || "var(--accent)" } }),
        h("div.grow", h("div", e.title, e.gm ? h("span.chip.warn", { style: { marginLeft: "6px" } }, icon("lock"), "GM") : null), e.note ? h("div.small.muted", e.note) : null),
        e.page ? btn("", { icon: "book", size: "sm", kind: "ghost", title: "Open the page", onclick: () => { closeAll(); ctx.go("lore", { id: e.page }); } }) : null,
        btn("", { icon: "edit", size: "sm", kind: "ghost", title: "Edit", onclick: () => { closeAll(); editEvent(ctx, cal, e); } }))) : h("p.small.faint", { style: { margin: 0 } }, "None.")),
    h("div.field", h("label", "Date a session on this day"), h("div.row", { style: { gap: "6px" } }, sessSel,
      btn("Set", { size: "sm", onclick: async () => {
        if (!sessSel.value) return;
        try { await api.set_session_world_date(sessSel.value, date, "keep"); closeAll(); ctx.reload(); toast("Session dated", dateText, "good", "check", 2500); } catch (e) { toastError(e); }
      } }))));
  const res = await modal(dateText, body, [{ label: "Close", kind: "ghost", value: false }, { label: "Make this today", kind: "primary", icon: "calendar", value: "today" }]);
  if (res === "today") {
    try { await api.calendar_set_today(date); ctx.reload(); } catch (e) { toastError(e); }
  }
}

function closeAll() { document.querySelectorAll(".scrim .m-head .btn").forEach((b) => b.click()); }

async function editEvent(ctx, cal, ev) {
  const isNew = !ev.id;
  const titles = await api.page_titles();
  const title = h("input.input", { value: ev.title || "", placeholder: "e.g. The bridge washes out" });
  const page = h("input.input", { value: titles.find((t) => t.id === ev.page)?.title || "", list: "ev-pages", placeholder: "Link a lore page (optional)" });
  const dl = h("datalist#ev-pages", titles.map((t) => h("option", { value: t.title })));
  const note = h("textarea.input", { rows: 3, value: ev.note || "" });
  let date = ev.date, end = ev.end || null, gm = !!ev.gm, color = ev.color || "";
  const dateBtn = btn("", { size: "sm" }), endBtn = btn("", { size: "sm" });
  dateBtn.onclick = async () => { const d = await pickDate(cal, date, "Event date"); if (d) { date = d; dateBtn.textContent = await api.calendar_format(d); } };
  endBtn.onclick = async () => { const d = await pickDate(cal, end || date, "Ends on"); end = d; endBtn.textContent = d ? await api.calendar_format(d) : "One day"; };
  dateBtn.textContent = await api.calendar_format(date);
  endBtn.textContent = end ? await api.calendar_format(end) : "One day";
  const colors = ["", "#9381FF", "#E5626A", "#F0A04B", "#4FB477", "#4A90E2", "#B06AD9"];
  const sw = h("div.row", { style: { gap: "6px" } }, colors.map((c) => h("button.color-dot", { class: c === color ? "on" : "", style: { background: c || "var(--line)" }, title: c || "Default",
    onclick: (e) => { color = c; sw.querySelectorAll(".color-dot").forEach((d) => d.classList.remove("on")); e.currentTarget.classList.add("on"); } })));
  const res = await modal(isNew ? "New event" : "Edit event", h("div.stack",
    h("div.field", h("label", "What happens"), title),
    h("div.grid.c2", h("div.field", h("label", "Date"), dateBtn), h("div.field", h("label", "Until"), h("div.row", { style: { gap: "6px" } }, endBtn,
      btn("", { icon: "x", size: "sm", kind: "ghost", title: "Just one day", onclick: () => { end = null; endBtn.textContent = "One day"; } })))),
    h("div.field", h("label", "Lore page"), page, dl),
    h("div.field", h("label", "Notes"), note),
    h("div.field", h("label", "Colour"), sw),
    switchEl(gm, (v) => { gm = v; }, "GM only")),
  [isNew ? null : { label: "Delete", kind: "ghost danger", value: "delete" }, { label: "Cancel", kind: "ghost", value: false }, { label: "Save", kind: "primary", value: true }].filter(Boolean));
  if (res === "delete") {
    if (await confirmBox("Delete this event?", ev.title, "Delete", true)) { await api.calendar_delete_event(ev.id).catch(toastError); ctx.reload(); }
    return;
  }
  if (!res) return;
  if (!title.value.trim()) return toast("Give the event a name", "", "warn", "alert");
  try {
    await api.calendar_save_event({ ...ev, title: title.value.trim(), date, end, gm, color, note: note.value.trim(),
      page: titles.find((t) => t.title === page.value.trim())?.id || null });
    ctx.reload();
  } catch (e) { toastError(e); }
}

// ---------------------------------------------------------------------------
function setup(ctx, root, cal0) {
  const cal = JSON.parse(JSON.stringify(cal0));
  let dirty = false;
  const touch = () => { dirty = true; saveBtn.disabled = false; };
  const saveBtn = btn("Save the calendar", { icon: "save", kind: "primary", onclick: async () => {
    try { await api.calendar_save(cal); dirty = false; toast("Calendar saved", "", "good", "check", 2000); ctx.reload(); } catch (e) { toastError(e); }
  } });
  saveBtn.disabled = true;

  const inp = (obj, key, attrs = {}, cast = String) => h("input.input", { value: obj[key] ?? "", ...attrs,
    oninput: (e) => { obj[key] = attrs.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : cast(e.target.value); touch(); } });
  const monthSel = (obj, key) => h("select.select", { onchange: (e) => { obj[key] = Number(e.target.value); touch(); } },
    cal.months.map((mo, i) => h("option", { value: i, selected: i === obj[key] }, mo.name || `Month ${i + 1}`)));
  const listCard = (title, help, arr, row, blankItem, opts = {}) => {
    const body = h("div.stack.sm");
    const draw = () => clear(body,
      help ? h("p.small.muted", { style: { margin: 0 } }, help) : null,
      arr.map((item, i) => h("div.setup-row", row(item, i),
        opts.order ? btn("", { icon: "up", size: "sm", kind: "ghost", title: "Move up", onclick: () => { if (i) { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; touch(); draw(); } } }) : null,
        btn("", { icon: "x", size: "sm", kind: "ghost", title: "Remove", onclick: () => { arr.splice(i, 1); touch(); draw(); } }))),
      h("div", btn(opts.add || "Add", { icon: "plus", size: "sm", onclick: () => { arr.push(blankItem()); touch(); draw(); } })));
    draw();
    return card({ title }, body);
  };

  const weekdays = cal.weekdays.map((name) => ({ name }));
  const syncWeek = () => { cal.weekdays = weekdays.map((w) => w.name).filter((n) => n.trim()); };
  const negEra = cal.eras.find((e) => e.negative) || { name: "", abbr: "", negative: true };
  const posEras = cal.eras.filter((e) => !e.negative);
  if (!cal.eras.includes(negEra)) cal.eras.unshift(negEra);
  const syncEras = () => { cal.eras = [negEra, ...posEras]; };

  root.append(h("div.stack.cal-setup",
    card({ title: "Calendar", actions: saveBtn }, h("div.grid.c2",
      h("div.field", h("label", "Name"), inp(cal, "name")),
      h("div.field", h("label", "The first day of year 1 is a…"), h("select.select", { onchange: (e) => { cal.epoch_weekday = Number(e.target.value); touch(); } },
        cal.weekdays.map((w, i) => h("option", { value: i, selected: i === cal.epoch_weekday }, w)))),
      switchEl(cal.week_resets, (v) => { cal.week_resets = v; touch(); }, "Every month starts on the first weekday"),
      switchEl(cal.has_year_zero, (v) => { cal.has_year_zero = v; touch(); }, "There is a year 0"))),
    listCard("Months", "Festival months sit outside the week (like a few holy days between two months).", cal.months, (mo) => [
      inp(mo, "name", { placeholder: "Month name" }),
      inp(mo, "days", { type: "number", min: 1, style: { width: "84px" }, title: "Days" }),
      h("span.small.faint", "days"),
      switchEl(!!mo.intercalary, (v) => { mo.intercalary = v; touch(); }, "Festival")], () => ({ name: "", days: 30, intercalary: false }), { order: true, add: "Add a month" }),
    listCard("Weekdays", null, weekdays, (w) => [h("input.input", { value: w.name, placeholder: "Day name", oninput: (e) => { w.name = e.target.value; syncWeek(); touch(); } })],
      () => ({ name: "" }), { order: true, add: "Add a weekday" }),
    listCard("Leap days", "A rule lists divisors in order, and the first that divides the year decides. “4” is every 4th year; “400,!100,4” is the Gregorian rule (! means not a leap year).",
      cal.leap, (x) => [inp(x, "name", { placeholder: "Name", class: "input grow-in" }), h("span.small.faint", "adds"), inp(x, "days", { type: "number", min: 1, style: { width: "70px" } }),
        h("span.small.faint", "day(s) to"), monthSel(x, "month"), h("span.small.faint", "when"), inp(x, "rule", { placeholder: "4", style: { width: "120px" } })],
      () => ({ name: "Leap day", month: 0, rule: "4", days: 1 }), { add: "Add a leap rule" }),
    listCard("Moons", "As many as your world has. The cycle is days from one new moon to the next; the shift moves when the first new moon falls.",
      cal.moons, (mo) => [inp(mo, "name", { placeholder: "Moon name" }),
        h("span.small.faint", "cycle"), inp(mo, "cycle", { type: "number", step: "0.01", min: 0.1, style: { width: "90px" } }),
        h("span.small.faint", "shift"), inp(mo, "shift", { type: "number", step: "0.1", style: { width: "80px" } }),
        h("input.color-in", { type: "color", value: /^#[0-9a-f]{6}$/i.test(mo.color) ? mo.color : "#e8e4d8", oninput: (e) => { mo.color = e.target.value; touch(); } })],
      () => ({ name: "", cycle: 28, shift: 0, color: "#E8E4D8" }), { add: "Add a moon" }),
    card({ title: "Eras" }, h("div.stack.sm",
      h("p.small.muted", { style: { margin: 0 } }, "Years before year 1 count back in the earlier era (5 BE, 4 BE…). Later eras can start a new count from any year."),
      h("div.setup-row", h("span.small.row-label", "Before year 1"), inp(negEra, "name", { placeholder: "Era name", class: "input grow-in" }), inp(negEra, "abbr", { placeholder: "Abbr.", style: { width: "90px" } })),
      ...posEras.map((e, i) => h("div.setup-row", h("span.small.row-label", i === 0 ? "From year 1" : "From year"),
        i === 0 ? null : inp(e, "start", { type: "number", style: { width: "100px" } }),
        inp(e, "name", { placeholder: "Era name", class: "input grow-in" }), inp(e, "abbr", { placeholder: "Abbr.", style: { width: "90px" } }),
        i === 0 ? null : btn("", { icon: "x", size: "sm", kind: "ghost", onclick: () => { posEras.splice(i, 1); syncEras(); touch(); ctx.go("calendar", { tab: "setup" }); } }))),
      h("div", btn("Add an era", { icon: "plus", size: "sm", onclick: () => { posEras.push({ name: "", abbr: "", start: (cal.current.y || 1) }); if (!posEras[0].start) posEras[0].start = 1; syncEras(); touch(); api.calendar_save(cal).then(() => ctx.go("calendar", { tab: "setup" })); } })))),
    listCard("Seasons", null, cal.seasons, (s) => [inp(s, "name", { placeholder: "Season" }), h("span.small.faint", "starts"),
      inp(s, "day", { type: "number", min: 1, style: { width: "70px" } }), monthSel(s, "month")], () => ({ name: "", month: 0, day: 1 }), { add: "Add a season" }),
    listCard("Holidays", "Every year on the same day.", cal.holidays, (ho) => [inp(ho, "name", { placeholder: "Holiday" }),
      inp(ho, "day", { type: "number", min: 1, style: { width: "70px" } }), monthSel(ho, "month"), inp(ho, "note", { placeholder: "Note (optional)", class: "input grow-in" }),
      h("input.color-in", { type: "color", value: /^#[0-9a-f]{6}$/i.test(ho.color) ? ho.color : "#f0a04b", oninput: (e) => { ho.color = e.target.value; touch(); } })],
      () => ({ name: "", month: 0, day: 1, note: "", color: "" }), { add: "Add a holiday" }),
    h("div", saveBtn.cloneNode(true))));
  root.lastChild.lastChild.firstChild.onclick = () => saveBtn.click();
  syncEras();
  ctx.onLeave(() => { if (dirty) toast("Calendar changes weren't saved", "", "warn", "alert", 4000); });
}

/** A small "today in the world" card for live mode. Empty when the campaign has no calendar. */
export function liveWorldCard() {
  const box = h("div");
  const draw = async () => {
    const info = await api.calendar().catch(() => ({}));
    if (!info.cal) return clear(box);
    const v = await api.calendar_month(info.cal.current.y, info.cal.current.m).catch(() => null);
    const day = v?.days[info.cal.current.d - 1];
    clear(box, card({ title: "In the world" }, h("div.stack.sm",
      h("div.live-date", info.today),
      day?.moons.length ? h("div.row.wrap", { style: { gap: "10px" } }, day.moons.map((mo) => h("span.today-moon", moonSvg(mo.f, mo.color, 16, mo.name), h("span.small", mo.phase)))) : null,
      day?.holidays.length ? h("div.small", "Today: ", h("b", day.holidays.map((x) => x.name).join(", "))) : null,
      h("div.row", { style: { gap: "6px" } },
        btn("+1 day", { size: "sm", onclick: async () => { await api.calendar_advance(1).catch(toastError); draw(); } }),
        btn("+1 week", { size: "sm", onclick: async () => { await api.calendar_advance(info.cal.weekdays.length).catch(toastError); draw(); } })))));
  };
  draw();
  return box;
}
