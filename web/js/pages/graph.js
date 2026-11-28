// Connection graph: every page (and optionally every session) as a dot, a line wherever one mentions another.
// With "Link by tags" on, each tag is a small ring joined by dashed lines to everything that carries it.
// Relationships (ally, rival, member of…) are coloured lines. Drag to pan, scroll to zoom, drag a dot to move it
// (it stays where you put it), click a dot to open it. Colours follow each page's first tag, or the colours you pick.
import { api } from "../api.js";
import { h, btn, clear, store, toast, toastError } from "../dom.js";
import { icon } from "../icons.js";
import { switchEl, seg, rangeEl } from "../components.js";
import { relInfo } from "../relations.js";
import { cat, resolve, onThemeChange } from "../themecolors.js";

// tags have no meaning of their own, so with a theme's category colours they go round the rainbow in order
const PALETTE = [cat(1, "#9381FF"), cat(2, "#FF94BE"), cat(3, "#75C97F"), cat(4, "#FFB48A"), cat(5, "#7DB7FF"), cat(6, "#F2D46B"), cat(7, "#C9A4FF"), cat(8, "#5CC8C2"), cat(1, "#E5626A"), cat(2, "#A3B59F"), cat(3, "#2F6BFF"), cat(4, "#D09A44")];
const PLACE = ["location", "place", "region", "city", "town", "village", "dungeon", "landmark"];
const GROUP = ["organization", "organisation", "faction", "guild", "group", "family", "house"];

export default {
  id: "graph", label: "Graph", icon: "graph",

  async mount(ctx, params, root) {
    const data = await api.graph();
    const camp = ctx.boot.campaign?.path || "";
    const key = (k) => `${k}:${camp}`;
    const opts = {
      sessions: store.get("graphSessions", true), orphans: store.get("graphOrphans", true), hidden: new Set(store.get("graphHidden", [])),
      tagLinks: store.get("graphTagLinks", true), rels: store.get("graphRels", true),
      size: store.get("graphSize", "links"), labels: store.get("graphLabels", "auto"), shapes: store.get("graphShapes", true),
      spacing: store.get("graphSpacing", 1), tagPull: store.get("graphTagPull", 1),
      colors: store.get(key("graphColors"), {}), pins: store.get(key("graphPins"), {}),
      focus: data.nodes.some((n) => n.id === params.focus) ? params.focus : null, depth: Number(params.depth) || 1, asOf: null,
    };
    const save = (k, v, perCampaign) => store.set(perCampaign ? key(k) : k, v);

    const tagCount = {};
    for (const n of data.nodes) { if (n.kind === "tag") continue; const t = n.tags[0] || "untagged"; tagCount[t] = (tagCount[t] || 0) + 1; }
    const tagList = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).map(([t]) => t);
    // tags that are never anyone's first tag still get their own colour for their ring on the graph
    const colourOrder = [...tagList, ...data.nodes.filter((n) => n.kind === "tag" && !tagList.includes(n.tags[0])).map((n) => n.tags[0])];
    const colorOf = (t) => opts.colors[t] || PALETTE[Math.max(0, colourOrder.indexOf(t)) % PALETTE.length];
    const relKinds = [...new Set((data.rel_edges || []).map((e) => e[2]))];
    const sessionNumbers = [...new Set(data.nodes.filter((n) => n.kind === "session" && n.number != null).map((n) => n.number))].sort((a, b) => a - b);
    const titleOf = (id) => data.nodes.find((n) => n.id === id)?.title || id;

    const find = h("input.input", { placeholder: "Highlight a name…", oninput: () => view.draw() });
    const legend = h("div.legend");
    const drawLegend = () => {
      // redrawing replaces every control, so put keyboard focus back where it was
      const a = document.activeElement;
      const keep = legend.contains(a) && a.dataset.tag ? `${a.tagName}[data-tag="${CSS.escape(a.dataset.tag)}"]` : null;
      clear(legend, tagList.map((t) => {
      const off = opts.hidden.has(t);
      const picker = h("input.colour-pick", { type: "color", "data-tag": t, value: resolve(colorOf(t)), title: `Colour for #${t}`,
        oninput: (e) => { opts.colors[t] = e.target.value; save("graphColors", opts.colors, true); ball.style.background = e.target.value; view.draw(); } });
      const ball = t === "session" ? h("span.ball", { style: { background: "var(--text-3)" } })
        : h("label.ball.pickable", { style: { background: colorOf(t) }, title: "Pick a colour" }, picker);
      // the dot and the name are separate controls: a picker inside the hide button trips up keyboards and screen readers
      return h("div.legend-row", { class: off ? "off" : "" }, ball,
        h("button.legend-toggle", { "data-tag": t, "aria-pressed": String(!off), onclick: () => {
          off ? opts.hidden.delete(t) : opts.hidden.add(t);
          save("graphHidden", [...opts.hidden]);
          drawLegend(); view.filter();
        } }, h("span.grow", "#" + t), h("b.faint.nums", tagCount[t])));
    }), Object.keys(opts.colors).length ? h("button.linkish.small", { style: { margin: "var(--s2) var(--s3) 0", textAlign: "left" },
      onclick: () => { opts.colors = {}; save("graphColors", {}, true); drawLegend(); view.draw(); } }, "Reset colours") : null);
      if (keep) legend.querySelector(keep)?.focus();
    };

    const relLegend = relKinds.length ? h("div.legend", relKinds.map((k) => h("div.legend-row.static",
      h("span.rel-line", { style: { background: relInfo(k).color } }), h("span.grow", relInfo(k).out),
      h("b.faint.nums", data.rel_edges.filter((e) => e[2] === k).length)))) : null;

    const focusBox = h("div");
    const drawFocus = () => clear(focusBox, opts.focus ? h("div.graph-focus",
      h("div.small", "Around ", h("b", titleOf(opts.focus))),
      seg([[1, "1 step"], [2, "2 steps"]], opts.depth, (v) => { opts.depth = v; view.filter(); }),
      h("button.linkish.small", { onclick: () => { opts.focus = null; drawFocus(); view.filter(); } }, "Show everything")) : null);
    drawFocus();

    const asOf = sessionNumbers.length ? h("select.select.sm", { onchange: (e) => { opts.asOf = e.target.value ? Number(e.target.value) : null; view.filter(); setTimeout(view.fit, 450); } },
      h("option", { value: "" }, "All sessions"), sessionNumbers.map((n) => h("option", { value: n }, `As of session ${n}`))) : null;

    ctx.side(h("h2", "Graph"),
      h("div.search.side-search", icon("search"), find),
      focusBox,
      h("div.stack.sm", { style: { padding: "var(--s1) var(--s2) var(--s2)" } },
        switchEl(opts.sessions, (v) => { opts.sessions = v; save("graphSessions", v); view.filter(); }, "Show sessions"),
        switchEl(opts.tagLinks, (v) => { opts.tagLinks = v; save("graphTagLinks", v); view.filter(); }, "Link by tags"),
        relKinds.length ? switchEl(opts.rels, (v) => { opts.rels = v; save("graphRels", v); view.filter(); }, "Show relationships") : null,
        switchEl(opts.orphans, (v) => { opts.orphans = v; save("graphOrphans", v); view.filter(); }, "Show unlinked pages"),
        asOf ? h("div.field", { title: "Only sessions up to then, and the pages their recaps mention." }, asOf) : null),
      h("details.graph-look", h("summary.group-label", "Look"),
        h("div.stack.sm", { style: { padding: "var(--s1) var(--s2) var(--s2)" } },
          h("div.field", h("label.small", "Dot size"), seg([["links", "By links"], ["same", "Equal"]], opts.size, (v) => { opts.size = v; save("graphSize", v); view.draw(); })),
          h("div.field", h("label.small", "Names"), seg([["auto", "Auto"], ["always", "All"], ["hover", "Hover"]], opts.labels, (v) => { opts.labels = v; save("graphLabels", v); view.draw(); })),
          switchEl(opts.shapes, (v) => { opts.shapes = v; save("graphShapes", v); view.draw(); }, "Shapes by kind"),
          opts.shapes ? h("p.tiny.faint", { style: { margin: "-4px 0 0 52px" } }, "Places ◆ · groups ▲ · sessions ■") : null,
          h("div.field", h("label.small", "Spacing"), rangeEl(opts.spacing, 0.5, 2, 0.05, (v) => { opts.spacing = v; save("graphSpacing", v); view.reheat(); })),
          h("div.field", h("label.small", "Tag pull"), rangeEl(opts.tagPull, 0, 2.5, 0.05, (v) => { opts.tagPull = v; save("graphTagPull", v); view.reheat(); })))),
      h("div.group-label", "Tags · click to hide, dot for a colour"), legend,
      relLegend ? [h("div.group-label", "Relationships"), relLegend] : null);

    const canvas = h("canvas.graph-canvas");
    const tip = h("div.graph-tip.hidden");
    const pinBtn = btn("", { icon: "x", title: "Let every dot move again", size: "sm", onclick: () => { view.unpin(); } });
    const wrap = h("div.graph-wrap", canvas, tip,
      h("div.graph-tools.row", { style: { gap: "var(--s2)" } },
        btn("", { icon: "download", title: "Save the graph as a picture", size: "sm", onclick: () => exportImage() }),
        btn("", { icon: "fit", title: "Fit everything in view", size: "sm", onclick: () => view.fit() }),
        pinBtn,
        btn("", { icon: "refresh", title: "Shake it up", size: "sm", onclick: () => view.reheat(true) })));
    root.classList.add("graph-page");
    root.append(ctx.header({ title: "Connections", subtitle: `${data.nodes.filter((n) => n.kind === "page").length} pages, ${data.edges.length} links${relKinds.length ? `, ${data.rel_edges.length} relationships` : ""} and ${data.nodes.filter((n) => n.kind === "tag").length} shared tags`, icon: "graph" }), wrap);

    const view = graphView(canvas, tip, data, opts, colorOf, find, (n) => n.kind === "session" ? ctx.go("sessions", { id: n.id.slice(8) }) : n.kind === "tag" ? ctx.go("lore", { q: n.title }) : ctx.go("lore", { id: n.id }),
      (pins) => { save("graphPins", pins, true); pinBtn.style.display = Object.keys(pins).length ? "" : "none"; });
    pinBtn.style.display = Object.keys(opts.pins).length ? "" : "none";
    drawLegend();
    const offLegend = onThemeChange(drawLegend);   // the pickers show the theme's colours, so they need the new ones
    ctx.onLeave(() => { view.stop(); offLegend(); });

    async function exportImage() {
      try {
        const path = await api.save_export_image("Connection graph", view.snapshot());
        toast("Saved the graph", path, "good", "image", 8000);
        api.open_folder(path).catch(() => {});
      } catch (e) { toastError(e); }
    }
  },
};

function graphView(canvas, tip, data, opts, colorOf, find, open, savePins) {
  const css = getComputedStyle(document.documentElement);
  const col = (v) => css.getPropertyValue(v).trim();
  const nodes = data.nodes.map((n, i) => {
    const pin = opts.pins[n.id];
    return { ...n, x: pin ? pin[0] : Math.cos(i * 2.4) * (60 + i * 3), y: pin ? pin[1] : Math.sin(i * 2.4) * (60 + i * 3), vx: 0, vy: 0, pinned: !!pin };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // [a, b, kind]: kind is "link", "tag" or a relationship kind
  const edges = [...data.edges.map(([a, b]) => [byId.get(a), byId.get(b), "link"]),
    ...(data.tag_edges || []).map(([a, b]) => [byId.get(a), byId.get(b), "tag"]),
    ...(data.rel_edges || []).map(([a, b, k]) => [byId.get(a), byId.get(b), "rel:" + k])].filter(([a, b]) => a && b);
  const neighbours = new Map(nodes.map((n) => [n, new Set()]));
  for (const [a, b, k] of edges) if (k !== "tag") { neighbours.get(a).add(b); neighbours.get(b).add(a); }
  const relCount = new Map();
  for (const [a, b, k] of edges) if (k.startsWith("rel:")) { relCount.set(a, (relCount.get(a) || 0) + 1); relCount.set(b, (relCount.get(b) || 0) + 1); }

  let shown = [], shownEdges = [];
  let cam = { x: 0, y: 0, k: 1 };
  let alpha = 1, raf = null, hover = null, drag = null, panning = null, moved = false;
  const dpr = window.devicePixelRatio || 1;

  function filter() {
    shown = nodes.filter((n) => (opts.sessions || n.kind !== "session") && (opts.tagLinks || n.kind !== "tag") && !opts.hidden.has(n.tags[0] || "untagged"));
    // as of session N: only the sessions up to then, and the pages their recaps mention
    if (opts.asOf != null) {
      const sess = new Set(nodes.filter((n) => n.kind === "session" && n.number != null && n.number <= opts.asOf));
      const known = new Set();
      for (const [a, b, k] of edges) if (k === "link") { if (sess.has(a)) known.add(b); if (sess.has(b)) known.add(a); }
      shown = shown.filter((n) => n.kind === "tag" || (n.kind === "session" ? sess.has(n) : known.has(n)));
    }
    // around a page: only what's within a step or two of it
    if (opts.focus && byId.has(opts.focus)) {
      let ring = new Set([byId.get(opts.focus)]);
      const near = new Set(ring);
      for (let d = 0; d < opts.depth; d++) {
        const next = new Set();
        for (const n of ring) for (const m of neighbours.get(n)) if (!near.has(m)) { near.add(m); next.add(m); }
        ring = next;
      }
      shown = shown.filter((n) => n.kind === "tag" || near.has(n));
    }
    let set = new Set(shown);
    shownEdges = edges.filter(([a, b, k]) => set.has(a) && set.has(b) && (opts.rels || !k.startsWith("rel:")));
    // a tag only links things when at least two of them are showing
    const uses = new Map();
    for (const [, b, k] of shownEdges) if (k === "tag") uses.set(b, (uses.get(b) || 0) + 1);
    shown = shown.filter((n) => n.kind !== "tag" || (uses.get(n) || 0) >= 2);
    set = new Set(shown);
    shownEdges = shownEdges.filter(([a, b]) => set.has(a) && set.has(b));
    if (!opts.orphans) {
      const linked = new Set(shownEdges.flatMap(([a, b]) => [a, b]));
      shown = shown.filter((n) => linked.has(n) || n.id === opts.focus);
    }
    reheat();
  }

  function reheat(shake) {
    if (shake) for (const n of shown) if (!n.pinned) { n.x += (Math.random() - 0.5) * 80; n.y += (Math.random() - 0.5) * 80; }
    alpha = 1;
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function step() {
    const N = shown.length, sp = opts.spacing;
    const push = 2600 * sp * sp;
    for (let i = 0; i < N; i++) {
      const a = shown[i];
      for (let j = i + 1; j < N; j++) {
        const b = shown[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy || 0.01;
        if (d2 > 250000 * sp * sp) continue;
        const f = (push / d2) * alpha;
        const d = Math.sqrt(d2);
        dx /= d; dy /= d;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
    }
    for (const [a, b, k] of shownEdges) {
      const tag = k === "tag";
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = ((d - (tag ? 110 : 85) * sp) / d) * (tag ? 0.012 * opts.tagPull : 0.035) * alpha;
      a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
    }
    for (const n of shown) {
      n.vx -= n.x * 0.004 * alpha; n.vy -= n.y * 0.004 * alpha;
      if (n === drag || n.pinned) { n.vx = n.vy = 0; continue; }
      n.x += n.vx; n.y += n.vy;
      n.vx *= 0.6; n.vy *= 0.6;
    }
    alpha *= 0.985;
  }

  function radius(n) {
    if (opts.size === "same") return n.kind === "tag" ? 4.5 : n.kind === "session" ? 4.5 : 5.5;
    return n.kind === "tag" ? 4 + Math.sqrt(n.degree) * 0.8 : (n.kind === "session" ? 3.5 : 4.5) + Math.sqrt(n.degree + (relCount.get(n) || 0)) * 1.6;
  }

  function shapeOf(n) {
    if (!opts.shapes || n.kind === "tag") return "circle";
    if (n.kind === "session") return "square";
    if (n.tags.some((t) => PLACE.includes(t))) return "diamond";
    if (n.tags.some((t) => GROUP.includes(t))) return "triangle";
    return "circle";
  }

  function pathFor(g, n, r) {
    const s = shapeOf(n);
    g.beginPath();
    if (s === "square") { const q = r * 0.9; g.roundRect ? g.roundRect(n.x - q, n.y - q, q * 2, q * 2, q * 0.35) : g.rect(n.x - q, n.y - q, q * 2, q * 2); }
    else if (s === "diamond") { const q = r * 1.25; g.moveTo(n.x, n.y - q); g.lineTo(n.x + q, n.y); g.lineTo(n.x, n.y + q); g.lineTo(n.x - q, n.y); g.closePath(); }
    else if (s === "triangle") { const q = r * 1.3; g.moveTo(n.x, n.y - q); g.lineTo(n.x + q * 0.92, n.y + q * 0.6); g.lineTo(n.x - q * 0.92, n.y + q * 0.6); g.closePath(); }
    else g.arc(n.x, n.y, r, 0, Math.PI * 2);
  }

  function draw(background) {
    const w = canvas.clientWidth, hgt = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== hgt * dpr) { canvas.width = w * dpr; canvas.height = hgt * dpr; }
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);
    if (background) { g.fillStyle = background; g.fillRect(0, 0, w, hgt); }
    g.translate(w / 2 + cam.x, hgt / 2 + cam.y);
    g.scale(cam.k, cam.k);
    const q = find.value.trim().toLowerCase();
    const focus = hover ? neighbours.get(hover) : null;
    const lit = (n) => (!focus && !q) || n === hover || (focus && focus.has(n)) || (q && n.title.toLowerCase().includes(q));
    for (const [a, b, k] of shownEdges) {
      const on = hover && (a === hover || b === hover);
      const tag = k === "tag", rel = k.startsWith("rel:");
      g.lineWidth = (rel ? 2 : 1) / cam.k;
      g.strokeStyle = rel ? resolve(relInfo(k.slice(4)).color) : on ? col("--accent") : tag ? resolve(colorOf(b.tags[0])) : col("--line-strong");
      g.globalAlpha = on ? 0.95 : (focus || q ? 0.15 : tag ? 0.35 : rel ? 0.85 : 0.8);
      g.setLineDash(tag ? [4 / cam.k, 4 / cam.k] : []);
      g.beginPath();
      if (rel) {
        // a gentle curve, so a relationship and a plain mention between the same two pages don't overlap
        const mx = (a.x + b.x) / 2 - (b.y - a.y) * 0.12, my = (a.y + b.y) / 2 + (b.x - a.x) * 0.12;
        g.moveTo(a.x, a.y); g.quadraticCurveTo(mx, my, b.x, b.y);
      } else { g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); }
      g.stroke();
    }
    g.setLineDash([]);
    g.globalAlpha = 1;
    g.lineWidth = 1 / cam.k;
    const textCol = col("--text"), quiet = col("--text-3");
    for (const n of shown) {
      const r = radius(n);
      const on = lit(n);
      g.globalAlpha = on ? 1 : 0.2;
      if (n.kind === "tag") {
        // a ring, so tags read as groupings rather than pages
        g.fillStyle = col("--surface") || "#000";
        g.strokeStyle = resolve(colorOf(n.tags[0]));
        g.lineWidth = 2 / cam.k;
        pathFor(g, n, r); g.fill(); g.stroke();
        g.lineWidth = 1 / cam.k;
      } else {
        g.fillStyle = n.kind === "session" ? quiet : resolve(colorOf(n.tags[0] || "untagged"));
        pathFor(g, n, r); g.fill();
      }
      if (n.gm) { g.strokeStyle = col("--warn"); g.lineWidth = 2 / cam.k; g.stroke(); g.lineWidth = 1 / cam.k; }
      if (n.id === opts.focus) { g.strokeStyle = col("--accent"); g.lineWidth = 2.5 / cam.k; pathFor(g, n, r + 4 / cam.k); g.stroke(); g.lineWidth = 1 / cam.k; }
      const near = n === hover || (focus && focus.has(n)) || (q && on) || n.id === opts.focus;
      const auto = cam.k > 1.6 || (n.kind === "page" && n.degree >= Math.max(4, 8 / cam.k)) || (n.kind === "tag" && cam.k > 0.8);
      const showLabel = near || (opts.labels === "always" && n.kind !== "tag") || (opts.labels === "always" && n.kind === "tag" && cam.k > 0.8) || (opts.labels === "auto" && auto);
      if (showLabel) {
        g.font = `${n === hover ? 600 : 500} ${12 / cam.k}px ${col("--font")}`;
        g.fillStyle = n === hover ? textCol : quiet;
        g.textAlign = "center";
        g.fillText(n.title, n.x, n.y + r * (shapeOf(n) === "circle" ? 1 : 1.3) + 13 / cam.k);
      }
    }
    g.globalAlpha = 1;
  }

  function tick() {
    raf = null;
    if (alpha > 0.02) { step(); raf = requestAnimationFrame(tick); }
    draw();
  }

  function fit() {
    if (!shown.length) return;
    const xs = shown.map((n) => n.x), ys = shown.map((n) => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = canvas.clientWidth || 800, hgt = canvas.clientHeight || 600;
    const k = Math.min(4, Math.max(0.25, Math.min(w / (maxX - minX + 120), hgt / (maxY - minY + 120))));
    cam = { k, x: -((minX + maxX) / 2) * k, y: -((minY + maxY) / 2) * k };
    draw();
  }

  const toWorld = (e) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left - rect.width / 2 - cam.x) / cam.k, y: (e.clientY - rect.top - rect.height / 2 - cam.y) / cam.k };
  };
  const hit = (p) => {
    let best = null, bd = Infinity;
    for (const n of shown) {
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < radius(n) + 5 / cam.k && d < bd) { best = n; bd = d; }
    }
    return best;
  };

  const relText = (n) => {
    const out = [];
    for (const [a, b, k] of shownEdges) {
      if (!k.startsWith("rel:")) continue;
      const info = relInfo(k.slice(4));
      if (a === n) out.push(`${info.out.toLowerCase()} ${b.title}`);
      else if (b === n) out.push(`${info.in.toLowerCase()} ${a.title}`);
    }
    return out.length ? " · " + out.slice(0, 3).join(", ") + (out.length > 3 ? "…" : "") : "";
  };

  canvas.addEventListener("mousedown", (e) => {
    moved = false;
    const n = hit(toWorld(e));
    if (n) { drag = n; reheat(); } else panning = { x: e.clientX - cam.x, y: e.clientY - cam.y };
  });
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  function onMove(e) {
    if (drag) { const p = toWorld(e); drag.x = p.x; drag.y = p.y; moved = true; alpha = Math.max(alpha, 0.3); if (!raf) raf = requestAnimationFrame(tick); return; }
    if (panning) { cam.x = e.clientX - panning.x; cam.y = e.clientY - panning.y; moved = true; draw(); return; }
    if (e.target !== canvas) return;
    const n = hit(toWorld(e));
    if (n !== hover) {
      hover = n;
      canvas.style.cursor = n ? "pointer" : "grab";
      tip.classList.toggle("hidden", !n);
      if (n) tip.textContent = n.kind === "tag" ? `${n.title} · on ${n.degree} pages and sessions · click to list them`
        : `${n.title}${n.kind === "session" ? (n.own_tags?.length ? " · " + n.own_tags.map((t) => "#" + t).join(" ") : "") : " · " + (n.tags.map((t) => "#" + t).join(" ") || "no tags")} · ${n.degree} link${n.degree === 1 ? "" : "s"}${relText(n)}${n.pinned ? " · pinned" : ""}`;
      draw();
    }
  }
  function onUp() {
    if (drag && !moved) open(drag);
    else if (drag && moved) {
      // a dot you moved stays where you put it
      drag.pinned = true;
      opts.pins[drag.id] = [Math.round(drag.x), Math.round(drag.y)];
      savePins(opts.pins);
    }
    drag = null; panning = null;
  }
  canvas.addEventListener("dblclick", (e) => {
    const n = hit(toWorld(e));
    if (n && n.pinned) { n.pinned = false; delete opts.pins[n.id]; savePins(opts.pins); reheat(); }
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left - rect.width / 2, my = e.clientY - rect.top - rect.height / 2;
    const k = Math.min(4, Math.max(0.25, cam.k * Math.exp(-e.deltaY * 0.0015)));
    cam.x = mx - ((mx - cam.x) * k) / cam.k;
    cam.y = my - ((my - cam.y) * k) / cam.k;
    cam.k = k;
    draw();
  }, { passive: false });
  const ro = new ResizeObserver(() => draw());
  ro.observe(canvas);

  filter();
  // settle quietly before the first frame so it doesn't fly around
  for (let i = 0; i < 160; i++) step();
  draw();
  setTimeout(fit, 30);

  const offTheme = onThemeChange(() => draw());   // the canvas reads theme colours only when it draws
  return {
    draw: () => draw(), reheat, fit,
    filter() { filter(); if (opts.focus) setTimeout(fit, 400); },
    unpin() { for (const n of nodes) n.pinned = false; opts.pins = {}; savePins({}); reheat(true); },
    snapshot() { draw(col("--bg") || col("--surface") || "#fff"); const url = canvas.toDataURL("image/png"); draw(); return url; },
    stop() { cancelAnimationFrame(raf); raf = null; ro.disconnect(); offTheme(); window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); },
  };
}
