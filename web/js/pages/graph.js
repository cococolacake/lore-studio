// Connection graph: every page (and optionally every session) as a dot, a line wherever one mentions another.
// With "Link by tags" on, each tag is a small ring joined by dashed lines to everything that carries it.
// Drag to pan, scroll to zoom, drag a dot to move it, click a dot to open it. Colours follow each page's first tag.
import { api } from "../api.js";
import { h, btn, clear, store } from "../dom.js";
import { icon } from "../icons.js";
import { switchEl } from "../components.js";

const PALETTE = ["#9381FF", "#FF94BE", "#75C97F", "#FFB48A", "#7DB7FF", "#F2D46B", "#C9A4FF", "#5CC8C2", "#E5626A", "#A3B59F", "#2F6BFF", "#D09A44"];

export default {
  id: "graph", label: "Graph", icon: "graph",

  async mount(ctx, params, root) {
    const data = await api.graph();
    const opts = { sessions: store.get("graphSessions", true), orphans: store.get("graphOrphans", true), hidden: new Set(store.get("graphHidden", [])),
      tagLinks: store.get("graphTagLinks", true) };

    const tagCount = {};
    for (const n of data.nodes) { if (n.kind === "tag") continue; const t = n.tags[0] || "untagged"; tagCount[t] = (tagCount[t] || 0) + 1; }
    const tagList = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).map(([t]) => t);
    // tags that are never anyone's first tag still get their own colour for their ring on the graph
    const colourOrder = [...tagList, ...data.nodes.filter((n) => n.kind === "tag" && !tagList.includes(n.tags[0])).map((n) => n.tags[0])];
    const colorOf = (t) => PALETTE[Math.max(0, colourOrder.indexOf(t)) % PALETTE.length];

    const find = h("input.input", { placeholder: "Highlight a name…", oninput: () => view.draw() });
    const legend = h("div.legend");
    const drawLegend = () => clear(legend, tagList.map((t) => {
      const off = opts.hidden.has(t);
      return h("button.legend-row", { class: off ? "off" : "", onclick: () => {
        off ? opts.hidden.delete(t) : opts.hidden.add(t);
        store.set("graphHidden", [...opts.hidden]);
        drawLegend(); view.filter();
      } }, h("span.ball", { style: { background: t === "session" ? "var(--text-3)" : colorOf(t) } }), h("span.grow", "#" + t), h("b.faint.nums", tagCount[t]));
    }));

    ctx.side(h("h2", "Graph"),
      h("div.search.side-search", icon("search"), find),
      h("div.stack.sm", { style: { padding: "4px 8px 8px" } },
        switchEl(opts.sessions, (v) => { opts.sessions = v; store.set("graphSessions", v); view.filter(); }, "Show sessions"),
        switchEl(opts.tagLinks, (v) => { opts.tagLinks = v; store.set("graphTagLinks", v); view.filter(); }, "Link by tags"),
        switchEl(opts.orphans, (v) => { opts.orphans = v; store.set("graphOrphans", v); view.filter(); }, "Show unlinked pages")),
      h("div.group-label", "Tags · click to hide"), legend);

    const canvas = h("canvas.graph-canvas");
    const tip = h("div.graph-tip.hidden");
    const wrap = h("div.graph-wrap", canvas, tip,
      h("div.graph-tools", btn("", { icon: "refresh", title: "Shake it up", size: "sm", onclick: () => view.reheat(true) })));
    root.classList.add("graph-page");
    root.append(ctx.header({ title: "Connections", subtitle: `${data.nodes.filter((n) => n.kind === "page").length} pages, ${data.edges.length} links and ${data.nodes.filter((n) => n.kind === "tag").length} shared tags. Click a dot to open it.`, icon: "graph" }), wrap);

    const view = graphView(canvas, tip, data, opts, colorOf, find, (n) => n.kind === "session" ? ctx.go("sessions", { id: n.id.slice(8) }) : n.kind === "tag" ? ctx.go("lore", { q: n.title }) : ctx.go("lore", { id: n.id }));
    drawLegend();
    ctx.onLeave(() => view.stop());
  },
};

function graphView(canvas, tip, data, opts, colorOf, find, open) {
  const css = getComputedStyle(document.documentElement);
  const col = (v) => css.getPropertyValue(v).trim();
  const nodes = data.nodes.map((n, i) => ({ ...n, x: Math.cos(i * 2.4) * (60 + i * 3), y: Math.sin(i * 2.4) * (60 + i * 3), vx: 0, vy: 0 }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = [...data.edges.map(([a, b]) => [byId.get(a), byId.get(b), false]),
    ...(data.tag_edges || []).map(([a, b]) => [byId.get(a), byId.get(b), true])].filter(([a, b]) => a && b);
  const neighbours = new Map(nodes.map((n) => [n, new Set()]));
  for (const [a, b] of edges) { neighbours.get(a).add(b); neighbours.get(b).add(a); }

  let shown = [], shownEdges = [];
  let cam = { x: 0, y: 0, k: 1 };
  let alpha = 1, raf = null, hover = null, drag = null, panning = null, moved = false;
  const dpr = window.devicePixelRatio || 1;

  function filter() {
    shown = nodes.filter((n) => (opts.sessions || n.kind !== "session") && (opts.tagLinks || n.kind !== "tag") && !opts.hidden.has(n.tags[0] || "untagged"));
    let set = new Set(shown);
    shownEdges = edges.filter(([a, b]) => set.has(a) && set.has(b));
    // a tag only links things when at least two of them are showing
    const uses = new Map();
    for (const [, b, t] of shownEdges) if (t) uses.set(b, (uses.get(b) || 0) + 1);
    shown = shown.filter((n) => n.kind !== "tag" || (uses.get(n) || 0) >= 2);
    set = new Set(shown);
    shownEdges = shownEdges.filter(([a, b]) => set.has(a) && set.has(b));
    if (!opts.orphans) {
      const linked = new Set(shownEdges.flat());
      shown = shown.filter((n) => linked.has(n));
    }
    reheat();
  }

  function reheat(shake) {
    if (shake) for (const n of shown) { n.x += (Math.random() - 0.5) * 80; n.y += (Math.random() - 0.5) * 80; }
    alpha = 1;
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function step() {
    const N = shown.length;
    for (let i = 0; i < N; i++) {
      const a = shown[i];
      for (let j = i + 1; j < N; j++) {
        const b = shown[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy || 0.01;
        if (d2 > 250000) continue;
        const f = (2600 / d2) * alpha;
        const d = Math.sqrt(d2);
        dx /= d; dy /= d;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
    }
    for (const [a, b, t] of shownEdges) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = ((d - (t ? 110 : 85)) / d) * (t ? 0.012 : 0.035) * alpha;
      a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
    }
    for (const n of shown) {
      n.vx -= n.x * 0.004 * alpha; n.vy -= n.y * 0.004 * alpha;
      if (n === drag) { n.vx = n.vy = 0; continue; }
      n.x += n.vx; n.y += n.vy;
      n.vx *= 0.6; n.vy *= 0.6;
    }
    alpha *= 0.985;
  }

  function radius(n) { return n.kind === "tag" ? 4 + Math.sqrt(n.degree) * 0.8 : (n.kind === "session" ? 3.5 : 4.5) + Math.sqrt(n.degree) * 1.6; }

  function draw() {
    const w = canvas.clientWidth, hgt = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== hgt * dpr) { canvas.width = w * dpr; canvas.height = hgt * dpr; }
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);
    g.translate(w / 2 + cam.x, hgt / 2 + cam.y);
    g.scale(cam.k, cam.k);
    const q = find.value.trim().toLowerCase();
    const focus = hover ? neighbours.get(hover) : null;
    const lit = (n) => (!focus && !q) || n === hover || (focus && focus.has(n)) || (q && n.title.toLowerCase().includes(q));
    g.lineWidth = 1 / cam.k;
    for (const [a, b, t] of shownEdges) {
      const on = hover && (a === hover || b === hover);
      g.strokeStyle = on ? col("--accent") : t ? colorOf(b.tags[0]) : col("--line-strong");
      g.globalAlpha = on ? 0.9 : (focus || q ? 0.15 : t ? 0.35 : 0.8);
      g.setLineDash(t ? [4 / cam.k, 4 / cam.k] : []);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    g.setLineDash([]);
    g.globalAlpha = 1;
    const textCol = col("--text"), quiet = col("--text-3");
    for (const n of shown) {
      const r = radius(n);
      const on = lit(n);
      g.globalAlpha = on ? 1 : 0.2;
      if (n.kind === "tag") {
        // a ring, so tags read as groupings rather than pages
        g.fillStyle = col("--surface") || "#000";
        g.strokeStyle = colorOf(n.tags[0]);
        g.lineWidth = 2 / cam.k;
        g.beginPath(); g.arc(n.x, n.y, r, 0, Math.PI * 2); g.fill(); g.stroke();
        g.lineWidth = 1 / cam.k;
      } else {
        g.fillStyle = n.kind === "session" ? quiet : colorOf(n.tags[0] || "untagged");
        g.beginPath(); g.arc(n.x, n.y, r, 0, Math.PI * 2); g.fill();
      }
      if (n.gm) { g.strokeStyle = col("--warn"); g.lineWidth = 2 / cam.k; g.stroke(); g.lineWidth = 1 / cam.k; }
      const showLabel = n === hover || (focus && focus.has(n)) || (q && on) || cam.k > 1.6 || (n.kind === "page" && n.degree >= Math.max(4, 8 / cam.k)) || (n.kind === "tag" && cam.k > 0.8);
      if (showLabel) {
        g.font = `${n === hover ? 600 : 500} ${12 / cam.k}px ${col("--font")}`;
        g.fillStyle = n === hover ? textCol : quiet;
        g.textAlign = "center";
        g.fillText(n.title, n.x, n.y + r + 13 / cam.k);
      }
    }
    g.globalAlpha = 1;
  }

  function tick() {
    raf = null;
    if (alpha > 0.02) { step(); raf = requestAnimationFrame(tick); }
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
        : `${n.title}${n.kind === "session" ? (n.own_tags?.length ? " · " + n.own_tags.map((t) => "#" + t).join(" ") : "") : " · " + (n.tags.map((t) => "#" + t).join(" ") || "no tags")} · ${n.degree} link${n.degree === 1 ? "" : "s"}`;
      draw();
    }
  }
  function onUp() {
    if (drag && !moved) open(drag);
    drag = null; panning = null;
  }
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

  return {
    draw, filter, reheat,
    stop() { cancelAnimationFrame(raf); raf = null; ro.disconnect(); window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); },
  };
}
