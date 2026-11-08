// The player lore book viewer. Runs from data.js (window.LORE), which holds only player-safe content.
// Bundled after markdown.js and pinicons.js into one classic script, so it works opened straight from disk.
const L = window.LORE;
const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  if (attrs == null || typeof attrs !== "object" || Array.isArray(attrs) || attrs instanceof Node) { kids.unshift(attrs); attrs = {}; }
  const [name, ...cls] = tag.split(".");
  const n = document.createElement(name);
  if (cls.length) n.className = cls.join(" ");
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "style" && typeof v === "object") for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith("--")) n.style.setProperty(sk, sv); else n.style[sk] = sv; }
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return n;
};
const byTitle = new Map(Object.entries(L.pages).flatMap(([id, p]) => [[p.title.toLowerCase(), id], ...p.aliases.map((a) => [a.toLowerCase(), id])]));
const go = (path) => { location.hash = "#/" + path; };

function md(src, selfId) {
  const node = render(src || "", { playerView: true, autoLink: true, linkNames: L.names, selfId });
  // wiki links: resolve to pages players can see; anything else becomes plain text
  node.querySelectorAll("a.wl").forEach((a) => {
    const id = a.dataset.id || byTitle.get((a.dataset.wl || "").toLowerCase());
    if (id && L.pages[id]) { a.href = "#/page/" + encodeURIComponent(id); }
    else a.replaceWith(document.createTextNode(a.textContent));
  });
  node.querySelectorAll(".tchip").forEach((t) => t.remove());
  // {{children}} and {{sessions}} placeholders
  node.querySelectorAll(".md-embed").forEach((slot) => {
    if (slot.dataset.embed === "children") slot.replaceWith(selfId ? childGrid(selfId) : el("span"));
    else if (slot.dataset.embed === "sessions") slot.replaceWith(recapList(5));
  });
  return node;
}

function childGrid(id) {
  const kids = (L.pages[id]?.children || []);
  if (!kids.length) return el("span");
  return el("div.cards", kids.map((c) => el("a.cardlink", { href: "#/page/" + encodeURIComponent(c.id) },
    L.pages[c.id]?.banner ? el("span.thumb", { style: { backgroundImage: `url("${L.pages[c.id].banner}")` } }) : null, el("span", c.title))));
}

function recapList(n) {
  const list = L.recaps.slice().reverse().slice(0, n);
  if (!list.length) return el("span");
  return el("div.cards", list.map((r) => el("a.cardlink", { href: "#/recaps/" + encodeURIComponent(r.id) }, el("span.num", r.number ?? ""), el("span", r.title))));
}

// ---- navigation -----------------------------------------------------------------------------
function navTree(nodes, depth = 0) {
  return el("ul.tree", nodes.map((n) => {
    const open = depth < 1;
    const label = n.id ? el("a", { href: "#/page/" + encodeURIComponent(n.id), "data-id": n.id }, n.title) : el("span.folder", n.title);
    if (!n.children.length) return el("li", label);
    return el("li", el("details", { open }, el("summary", label), navTree(n.children, depth + 1)));
  }));
}

function drawNav() {
  const nav = $("#nav");
  nav.replaceChildren(...[
    L.home ? el("a.navtop", { href: "#/" }, "Home") : null,
    L.recaps.length ? el("a.navtop", { href: "#/recaps" }, "The story so far") : null,
    L.maps.length ? el("a.navtop", { href: "#/maps" }, "Maps") : null,
    L.handouts.length ? el("a.navtop", { href: "#/handouts" }, "Handouts") : null,
    L.calendar ? el("a.navtop", { href: "#/calendar" }, "Calendar") : null,
    (L.timeline || []).length ? el("a.navtop", { href: "#/timeline" }, "Timeline") : null,
    L.clocks.length ? el("a.navtop", { href: "#/clocks" }, "Rumours & threats") : null,
    el("div.navsep"),
    navTree(L.tree)].filter(Boolean));
}

function markActive() {
  const h = location.hash;
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("on", a.getAttribute("href") === h || (h === "" && a.getAttribute("href") === "#/")));
}

// ---- views ---------------------------------------------------------------------------------
function pageView(id) {
  const p = L.pages[id];
  if (!p) return notFound();
  document.title = `${p.title} · ${L.name}`;
  const head = el("header.phead", { class: p.banner ? "phead with-banner" : "phead" },
    p.banner ? el("div.banner", { style: { backgroundImage: `url("${p.banner}")`, backgroundPosition: `center ${p.banner_y ?? 40}%` } }) : null,
    el("div.phead-body",
      p.crumbs.length ? el("div.crumbs", p.crumbs.map((c, i) => [i ? " / " : "", el("a", { href: "#/page/" + encodeURIComponent(c.id) }, c.title)])) : null,
      el("h1", p.title),
      p.tags.length ? el("div.tags", p.tags.map((t) => el("a.tag", { href: "#/search/" + encodeURIComponent("#" + t) }, "#" + t))) : null));
  if (p.banner) {  // a header image that can't be reached (moved, offline) folds away instead of leaving an empty box
    const probe = new Image();
    probe.onerror = () => { head.querySelector(".banner")?.remove(); head.className = "phead"; };
    probe.src = p.banner;
  }
  const onMaps = L.maps.flatMap((m) => [
    ...(m.page === id ? [{ map: m, pin: null }] : []),
    ...m.pins.filter((p) => p.page === id).map((p) => ({ map: m, pin: p }))]);
  const own = !p.body.trim() ? L.maps.filter((m) => m.page === id) : [];
  if (own.length) {
    const parts = own.map((m) => { const [, stage] = mapsView(m.id); stage.classList.add("embedded"); return el("div.embedmap", el("div.embedhead", el("b", m.name), el("a", { href: "#/maps/" + encodeURIComponent(m.id) }, "Open the map")), stage); });
    document.title = `${p.title} · ${L.name}`;
    return [head, ...parts];
  }
  return [head, el("article.card", md(p.body, id),
    onMaps.length ? el("div.onmap", "On the map: ", onMaps.map((x, i) => [i ? ", " : "", el("a", { href: "#/maps/" + encodeURIComponent(x.map.id) }, x.pin ? `${x.pin.name} (${x.map.name})` : x.map.name)])) : null)];
}

function recapsView(id) {
  document.title = `The story so far · ${L.name}`;
  const list = L.recaps.slice().reverse();
  return [el("h1.title", "The story so far"), list.length ? list.map((r) => el("article.card.recap", { id: "r-" + r.id, class: id === r.id ? "card recap hl" : "card recap" },
    el("div.recap-head", el("span.num", r.number ?? ""), el("div", el("h2", r.title), el("div.muted", [r.world, r.date].filter(Boolean).join(" · ")))),
    md(r.body))) : el("p.muted", "No recaps yet.")];
}

function mapsView(id) {
  const m = L.maps.find((x) => x.id === id) || (!id && L.maps.length === 1 ? L.maps[0] : null);
  if (!m) {
    document.title = `Maps · ${L.name}`;
    return [el("h1.title", "Maps"), el("div.cards", L.maps.map((x) => el("a.cardlink.mapcard", { href: "#/maps/" + encodeURIComponent(x.id) },
      el("span.thumb", { style: { backgroundImage: `url("${x.image}")` } }), el("span", x.name))))];
  }
  document.title = `${m.name} · ${L.name}`;
  const img = el("img.mapimg", { src: m.image, alt: m.name, draggable: "false" });
  const pins = el("div.pins");
  const inner = el("div.mapinner", img, pins);
  const pop = el("div.pop.hidden");
  const stage = el("div.stage", inner, pop,
    el("div.zoom", el("button", { type: "button", onclick: () => zoomBy(1.4) }, "+"), el("button", { type: "button", onclick: () => zoomBy(1 / 1.4) }, "−"), el("button", { type: "button", onclick: () => fit() }, "⤢")));
  let cam = { x: 0, y: 0, k: 1 }, W = 1, H = 1, fitK = 1;
  const vis = () => {
    const z = cam.k / fitK;
    for (const p of pins.children) p.classList.toggle("zh", (+p.dataset.zmin && z < +p.dataset.zmin) || (+p.dataset.zmax && z > +p.dataset.zmax));
  };
  const apply = () => { inner.style.transform = `translate(${cam.x}px,${cam.y}px) scale(${cam.k})`; inner.style.setProperty("--k", cam.k); vis(); };
  const fit = () => { const r = stage.getBoundingClientRect(); cam.k = fitK = Math.min(r.width / W, r.height / H) * 0.96; cam.x = (r.width - W * cam.k) / 2; cam.y = (r.height - H * cam.k) / 2; apply(); };
  const zoomAt = (k, cx, cy) => { k = Math.min(8, Math.max(0.05, k)); cam.x = cx - ((cx - cam.x) * k) / cam.k; cam.y = cy - ((cy - cam.y) * k) / cam.k; cam.k = k; apply(); };
  const zoomBy = (f) => { const r = stage.getBoundingClientRect(); zoomAt(cam.k * f, r.width / 2, r.height / 2); };
  m.pins.forEach((p) => {
    const b = el("button.pin", { type: "button", class: `pin size-${p.size}${p.label === "always" ? " lbl" : ""}`, "data-zmin": p.zmin || "", "data-zmax": p.zmax || "",
      style: { left: p.x * 100 + "%", top: p.y * 100 + "%", "--pin": p.color || "#9381FF" } },
    el("span.dot", p.icon ? pinIcon(p.icon) : null), el("span.lab", p.name));
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const r = b.getBoundingClientRect(), sr = stage.getBoundingClientRect();
      pop.replaceChildren(el("b", p.name), p.note ? el("div.small", p.note) : null,
        p.page ? el("a", { href: "#/page/" + encodeURIComponent(p.page) }, "Read about " + (L.pages[p.page]?.title || p.name)) : null,
        p.map ? el("a", { href: "#/maps/" + encodeURIComponent(p.map) }, "Open " + (L.maps.find((x) => x.id === p.map)?.name || "map")) : null);
      pop.style.left = Math.min(sr.width - 230, r.left - sr.left + 16) + "px";
      pop.style.top = Math.max(8, r.top - sr.top - 8) + "px";
      pop.classList.remove("hidden");
    });
    pins.append(b);
  });
  let pan = null;
  stage.addEventListener("pointerdown", (e) => { if (e.target.closest(".pin,.zoom,.pop")) return; pop.classList.add("hidden"); pan = { x: e.clientX - cam.x, y: e.clientY - cam.y }; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener("pointermove", (e) => { if (!pan) return; cam.x = e.clientX - pan.x; cam.y = e.clientY - pan.y; apply(); });
  stage.addEventListener("pointerup", () => { pan = null; });
  stage.addEventListener("wheel", (e) => { e.preventDefault(); const r = stage.getBoundingClientRect(); zoomAt(cam.k * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  const ready = () => { W = img.naturalWidth || 1600; H = img.naturalHeight || 1000; inner.style.width = W + "px"; inner.style.height = H + "px"; fit(); };
  img.complete && img.naturalWidth ? setTimeout(ready) : (img.onload = ready);
  addEventListener("resize", () => W > 1 && fit());
  return [el("div.maphead", el("h1.title", m.name), m.page ? el("a", { href: "#/page/" + encodeURIComponent(m.page) }, "About this place") : null,
    L.maps.length > 1 ? el("a", { href: "#/maps" }, "All maps") : null), stage];
}

function handoutsView() {
  document.title = `Handouts · ${L.name}`;
  return [el("h1.title", "Handouts"), el("div.handouts", L.handouts.map((x) => el("article.card.handout",
    x.image ? el("a", { href: x.image, target: "_blank" }, el("img", { src: x.image, alt: x.title })) : null,
    el("h2", x.title), x.text ? md(x.text) : null)))];
}

function moon(f, color) {
  const r = 10, k = Math.cos(2 * Math.PI * f), s = f < 0.5 ? 1 : -1, pts = [];
  for (let i = 0; i <= 24; i++) { const t = -Math.PI / 2 + (Math.PI * i) / 24; pts.push([s * r * Math.cos(t), r * Math.sin(t)]); }
  for (let i = 24; i >= 0; i--) { const t = -Math.PI / 2 + (Math.PI * i) / 24; pts.push([s * k * r * Math.cos(t), r * Math.sin(t)]); }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "-12 -12 24 24"); svg.setAttribute("width", 22); svg.setAttribute("height", 22);
  svg.innerHTML = `<circle r="${r}" fill="#2a2633" stroke="${color}" stroke-opacity=".55"/><path d="M${pts.map((p) => p.map((v) => v.toFixed(2)).join(" ")).join("L")}Z" fill="${color}"/>`;
  return svg;
}

function calendarView() {
  const c = L.calendar;
  document.title = `Calendar · ${L.name}`;
  return [el("div.today", el("div.small", "Today in the world"), el("div.today-date", c.today),
    el("div.moons", c.moons.map((m) => el("span.moon", moon(m.f, m.color), el("span", el("b", m.name), el("small", m.phase)))))),
  el("div.grid2",
    el("article.card", el("h2", "Months"), el("ol", c.months.map((m) => el("li", m))), el("h2", "Days of the week"), el("p", c.weekdays.join(" · "))),
    el("article.card", el("h2", "Holidays"), c.holidays.length ? el("ul", c.holidays.map((h) => el("li", el("b", h.name), " — ", h.date, h.note ? el("div.small.muted", h.note) : null))) : el("p.muted", "None yet."))),
  c.events.length ? el("article.card", el("h2", "Events"), el("ul.events", c.events.map((e) => el("li", el("span.muted", e.date + (e.end ? ` to ${e.end}` : "")), " ",
    e.page ? el("a", { href: "#/page/" + encodeURIComponent(e.page) }, e.title) : el("b", e.title), e.note ? el("div.small.muted", e.note) : null)))) : null];
}

function clockSvg(c) {
  const n = c.segments, r = 48, ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "-52 -52 104 104"); svg.setAttribute("width", 84); svg.setAttribute("height", 84);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * 2 * Math.PI, a1 = ((i + 1) / n) * 2 * Math.PI;
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", `M0 0L${(Math.sin(a0) * r).toFixed(2)} ${(-Math.cos(a0) * r).toFixed(2)}A${r} ${r} 0 0 1 ${(Math.sin(a1) * r).toFixed(2)} ${(-Math.cos(a1) * r).toFixed(2)}Z`);
    p.setAttribute("fill", i < c.filled ? c.color : "var(--empty)"); p.setAttribute("stroke", "var(--card)"); p.setAttribute("stroke-width", "2.5");
    svg.append(p);
  }
  return svg;
}

function clocksView() {
  document.title = `Rumours & threats · ${L.name}`;
  return [el("h1.title", "Rumours & threats"), el("div.clocks", L.clocks.map((c) => el("article.card.clock", clockSvg(c),
    el("div", el("h2", c.name), el("div.muted.small", `${c.filled} of ${c.segments}`), c.note ? el("p", c.note) : null,
      c.page ? el("a", { href: "#/page/" + encodeURIComponent(c.page) }, "Read more") : null))))];
}

function timelineView() {
  document.title = `Timeline · ${L.name}`;
  return [el("h1.title", "Timeline"), el("ol.history", L.timeline.map((b) => el("li", { style: { "--c": b.color } },
    el("div.when", b.label), el("div.what", b.page ? el("a", { href: "#/page/" + encodeURIComponent(b.page) }, b.title) : el("b", b.title),
      el("span.lane", b.lane), b.note ? el("div.small.muted", b.note) : null))))];
}

function searchView(q) {
  document.title = `Search · ${L.name}`;
  const needle = q.toLowerCase().trim();
  const tag = needle.startsWith("#") ? needle.slice(1) : null;
  const hits = Object.entries(L.pages).map(([id, p]) => {
    if (tag) return p.tags.some((t) => t.toLowerCase() === tag) ? { id, p, score: 1, snip: "" } : null;
    const t = p.title.toLowerCase(), b = p.body.toLowerCase();
    const score = (t.includes(needle) ? 10 : 0) + (p.aliases.some((a) => a.toLowerCase().includes(needle)) ? 6 : 0) + (b.includes(needle) ? 1 : 0);
    if (!score) return null;
    const i = b.indexOf(needle);
    return { id, p, score, snip: i >= 0 ? p.body.slice(Math.max(0, i - 60), i + 100).replace(/[#*_>[\]`]/g, "") : "" };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
  const recapHits = tag ? [] : L.recaps.filter((r) => r.body.toLowerCase().includes(needle) || r.title.toLowerCase().includes(needle));
  return [el("h1.title", `Search: ${q}`), hits.length || recapHits.length ? el("div.results",
    hits.map((x) => el("a.result", { href: "#/page/" + encodeURIComponent(x.id) }, el("b", x.p.title), x.snip ? el("span.muted", "…" + x.snip + "…") : null)),
    recapHits.map((r) => el("a.result", { href: "#/recaps/" + encodeURIComponent(r.id) }, el("b", `Session ${r.number ?? ""}: ${r.title}`), el("span.muted", "Recap"))))
    : el("p.muted", "Nothing found.")];
}

function notFound() { return [el("h1.title", "Not found"), el("p.muted", "That page isn't in the lore book.")]; }

function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  const [kind, ...rest] = parts;
  const arg = decodeURIComponent(rest.join("/"));
  let view;
  if (!kind) view = L.home ? pageView(L.home) : recapsView();
  else if (kind === "page") view = pageView(arg);
  else if (kind === "recaps") view = recapsView(arg);
  else if (kind === "maps") view = mapsView(arg);
  else if (kind === "handouts") view = handoutsView();
  else if (kind === "calendar" && L.calendar) view = calendarView();
  else if (kind === "clocks") view = clocksView();
  else if (kind === "timeline" && (L.timeline || []).length) view = timelineView();
  else if (kind === "search") view = searchView(arg);
  else view = notFound();
  const main = $("#main");
  main.replaceChildren(...[view].flat(Infinity).filter(Boolean));
  main.classList.toggle("wide", kind === "maps" && !!arg);
  document.body.classList.remove("nav-open");
  if (kind === "recaps" && arg) document.getElementById("r-" + arg)?.scrollIntoView({ block: "start" });
  else window.scrollTo(0, 0);
  markActive();
}

if (L.theme) {
  const r = document.documentElement.style;
  r.setProperty("--accent", L.theme.accent);
  r.setProperty("--accent-text-light", L.theme.accent_text);
  r.setProperty("--accent-soft-light", L.theme.accent_soft);
}
$("#brand-name").textContent = L.name;
$("#built").textContent = "Updated " + L.built.slice(0, 10);
document.title = L.name;
drawNav();
$("#q").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.value.trim()) go("search/" + encodeURIComponent(e.target.value.trim())); });
$("#menu").addEventListener("click", () => document.body.classList.toggle("nav-open"));
const themeBtn = $("#theme");
const syncTheme = () => { themeBtn.textContent = document.documentElement.dataset.theme === "dark" ? "Light mode" : "Dark mode"; };
themeBtn.addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme !== "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  try { localStorage.setItem("lb-theme", dark ? "dark" : "light"); } catch (e) { /* private mode */ }
  syncTheme();
});
syncTheme();
addEventListener("hashchange", route);
route();
