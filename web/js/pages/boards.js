// Inspiration boards: a free canvas of pictures, sticky notes, page cards and links, joined by strings.
// Drag the background to pan, scroll to zoom, double-click to add a note, paste or drop pictures anywhere.
import { api } from "../api.js";
import { h, btn, card, clear, empty, toast, toastError, modal, confirmBox, promptBox, store } from "../dom.js";
import { icon } from "../icons.js";
import { render } from "../markdown.js";
import { chooseImage } from "./maps.js";

const NOTE_COLORS = ["#FFF1A8", "#FFD6E0", "#D7F0FF", "#DDF5D4", "#EBDDFF", "#FFE2C2", "#FFFFFF"];
const STRING_COLORS = ["#E5626A", "#4A90E2", "#4FB477", "#F0A04B", "#9381FF", "#17171A"];
const fileUrl = (rel) => "/c/" + String(rel).split("/").map(encodeURIComponent).join("/");

export default {
  id: "boards", label: "Boards", icon: "board",

  async mount(ctx, params, root) {
    const list = await api.boards();
    const bid = params.id || list[0]?.id || null;
    const newBoard = async (attach = {}) => {
      const name = await promptBox("New board", "Name", attach.name || "");
      if (name == null) return;
      try { const b = await api.board_create(name || "New board", attach.page || null, attach.session || null); ctx.go("boards", { id: b.id }); } catch (e) { toastError(e); }
    };
    ctx.side(h("h2", "Boards"),
      h("div", { style: { padding: "0 6px 10px" } }, btn("New board", { icon: "plus", size: "sm", kind: "primary", onclick: () => newBoard() })),
      list.map((b) => h("button.side-item.board-item", { class: b.id === bid ? "active" : "", onclick: () => ctx.go("boards", { id: b.id }) },
        b.cover ? h("span.board-thumb", { style: { backgroundImage: `url("${fileUrl(b.cover)}")` } }) : icon("board"),
        h("span.grow", h("span.ellipsis", b.name), h("small", `${b.items} item${b.items === 1 ? "" : "s"}`)))));
    if (params.new) return newBoard({ page: params.page, session: params.session, name: params.name });
    if (!bid) {
      root.append(ctx.header({ title: "Boards", subtitle: "Mood boards and conspiracy walls: pictures, notes, pages and links, joined by strings.", icon: "board" }),
        card(null, empty("board", "No boards yet", "Make one for a region's look, a villain's plan or a mystery arc. Paste pictures straight in, add sticky notes and page cards, and pull strings between them.",
          btn("Make a board", { icon: "plus", kind: "primary", onclick: () => newBoard() }))));
      return;
    }
    await boardView(ctx, root, bid);
  },
};

async function boardView(ctx, root, bid) {
  let b = await api.board(bid);
  const titles = await api.page_titles();
  const titleOf = (id) => titles.find((t) => t.id === id)?.title || id;
  let pageCache = {};
  const camKey = `boardCam:${bid}`;
  let cam = store.get(camKey, null) || { x: 60, y: 40, k: 1 };
  let selected = null, connectFrom = null, connectAt = null, connecting = false;
  let lastColor = "#E5626A";
  const CAPTION_H = 34;
  // older pictures always had a caption line; new ones only when you add one
  const hasCaption = (it) => it.cap === true || (it.cap === undefined && !!it.caption);

  // ---- saving: the whole board, a moment after the last change
  let saveT = null;
  const status = h("span.tiny.faint", "Saved");
  const changed = () => {
    status.textContent = "Saving…";
    clearTimeout(saveT);
    saveT = setTimeout(async () => {
      // keep editing the same board object: swapping in the saved copy would leave open pickers and drags
      // changing an object that's no longer on screen (string colours "not changing")
      try { const r = await api.board_save(b); b.updated = r.updated; status.textContent = "Saved"; } catch (e) { status.textContent = "Not saved"; toastError(e); }
    }, 500);
  };
  ctx.onLeave(() => { if (saveT) { clearTimeout(saveT); api.board_save(b).catch(() => {}); } });

  // ---- layout
  root.classList.add("map-page");
  const connectBtn = btn("String", { icon: "link", size: "sm", title: "Tie two items together: click this, then the spot on the first item, then the spot on the second. Drag a pin later to move it.",
    onclick: () => { connecting = !connecting; connectFrom = null; connectBtn.classList.toggle("primary", connecting); stage.classList.toggle("connecting", connecting); hint(); } });
  const hintEl = h("div.board-hint");
  const hint = () => { hintEl.textContent = connecting ? (connectFrom ? "Now click where it ties on the second item." : "Click where the string starts, on any item.") : ""; hintEl.hidden = !connecting; };
  const name = h("input.board-name", { value: b.name, onchange: (e) => { b.name = e.target.value.trim() || "Board"; changed(); } });
  const attachLabel = () => b.page ? `On ${titleOf(b.page)}` : b.session ? "For a session" : "";
  root.append(h("div.map-bar",
    h("div.grow", name, h("div.small.faint", status, b.page || b.session ? " · " : "", b.page ? h("button.linkish", { onclick: () => ctx.go("lore", { id: b.page }) }, attachLabel()) : b.session ? h("button.linkish", { onclick: () => ctx.go("sessions", { id: b.session }) }, attachLabel()) : null)),
    btn("Note", { icon: "edit", size: "sm", onclick: () => addNote(center()) }),
    btn("Picture", { icon: "image", size: "sm", onclick: async () => { const img = await chooseImage(ctx); if (img) addImage(img, center()); } }),
    btn("Page", { icon: "book", size: "sm", onclick: () => addPage(center()) }),
    btn("Link", { icon: "external", size: "sm", onclick: () => addLink(center()) }),
    connectBtn,
    btn("", { icon: "fit", size: "sm", title: "Fit everything", onclick: () => fit() }),
    btn("", { icon: "gear", size: "sm", kind: "ghost", title: "Board settings", onclick: () => settings() })));
  const world = h("div.board-world");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("board-strings");
  world.append(svg);
  const stage = h("div.board-stage", world, hintEl);
  root.append(stage);
  hint();

  const apply = () => { world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`; store.set(camKey, cam); };
  const toWorld = (cx, cy) => { const r = stage.getBoundingClientRect(); return { x: (cx - r.left - cam.x) / cam.k, y: (cy - r.top - cam.y) / cam.k }; };
  const center = () => { const r = stage.getBoundingClientRect(); const p = toWorld(r.left + r.width / 2, r.top + r.height / 2); return { x: p.x - 110 + Math.random() * 40, y: p.y - 80 + Math.random() * 40 }; };
  const fit = () => {
    if (!b.items.length) { cam = { x: 60, y: 40, k: 1 }; return apply(); }
    const x0 = Math.min(...b.items.map((i) => i.x)), y0 = Math.min(...b.items.map((i) => i.y));
    const x1 = Math.max(...b.items.map((i) => i.x + i.w)), y1 = Math.max(...b.items.map((i) => i.y + i.h));
    const r = stage.getBoundingClientRect();
    cam.k = Math.min(1.4, Math.min(r.width / (x1 - x0 + 120), r.height / (y1 - y0 + 120)));
    cam.x = (r.width - (x1 - x0) * cam.k) / 2 - x0 * cam.k;
    cam.y = (r.height - (y1 - y0) * cam.k) / 2 - y0 * cam.k;
    apply();
  };

  // ---- items
  const nodes = new Map();
  const itemEl = (it) => {
    let inner;
    if (it.type === "image") {
      inner = h("div.bi-img", { class: hasCaption(it) ? "" : "nocap" }, h("img", { src: fileUrl(it.src), draggable: false, alt: "" }),
        hasCaption(it) ? h("input.bi-caption", { value: it.caption || "", placeholder: "Caption…", onchange: (e) => { it.caption = e.target.value; changed(); } }) : null);
    } else if (it.type === "note") {
      const ta = h("textarea.bi-note-text", { value: it.text || "", placeholder: "Write…", spellcheck: true,
        oninput: (e) => { it.text = e.target.value; changed(); } });
      inner = h("div.bi-note", { style: { background: it.color || NOTE_COLORS[0] } }, ta);
    } else if (it.type === "page") {
      const body = h("div.bi-page-body");
      const load = async () => {
        if (!pageCache[it.page]) pageCache[it.page] = await api.lore_page(it.page).catch(() => null);
        const p = pageCache[it.page];
        clear(body, p ? [p.meta.banner ? h("div.bi-page-banner", { style: { backgroundImage: `url("${/^https?:/.test(p.meta.banner) ? p.meta.banner : fileUrl(p.meta.banner)}")` } }) : null,
          h("div.bi-page-title", icon("book"), p.meta.title), render(p.body.slice(0, 600))] : h("div.small.faint", "That page is gone."));
      };
      load();
      inner = h("div.bi-page", { ondblclick: (e) => { e.stopPropagation(); ctx.go("lore", { id: it.page }); }, title: "Double-click to open the page" }, body);
    } else if (it.type === "link") {
      inner = h("a.bi-link", { href: it.url, target: "_blank", rel: "noopener", onclick: (e) => { if (!e.ctrlKey && !e.metaKey) e.preventDefault(); }, title: "Ctrl+click to open" },
        icon("external"), h("div", h("b", it.title || it.url), h("div.tiny.faint.ellipsis", it.url)));
    }
    const el = h("div.bi", { class: `bt-${it.type}${selected === it.id ? " sel" : ""}`, "data-id": it.id,
      style: { left: it.x + "px", top: it.y + "px", width: it.w + "px", height: it.h + "px", transform: it.rot ? `rotate(${it.rot}deg)` : "" } },
      inner, h("div.bi-resize"), h("div.bi-tools",
        it.type === "note" ? NOTE_COLORS.map((c) => h("button.color-dot", { style: { background: c }, title: "Colour", onclick: (e) => { e.stopPropagation(); it.color = c; redraw(); changed(); } })) : null,
        it.type === "image" ? h("button.bi-tool", { title: hasCaption(it) ? "Remove the caption" : "Add a caption", onclick: (e) => {
          e.stopPropagation();
          const on = !hasCaption(it);
          it.cap = on;
          if (!on) it.caption = "";
          it.h = Math.max(50, it.h + (on ? CAPTION_H : -CAPTION_H));
          redraw(); changed();
          if (on) setTimeout(() => nodes.get(it.id)?.querySelector(".bi-caption")?.focus(), 30);
        } }, icon("edit"), hasCaption(it) ? "No caption" : "Caption") : null,
        h("button.bi-del", { title: "Remove", onclick: (e) => { e.stopPropagation(); removeItem(it.id); } }, icon("x"))));
    el.addEventListener("pointerdown", (e) => itemDown(e, it, el));
    return el;
  };
  const redraw = () => {
    [...world.querySelectorAll(".bi")].forEach((n) => n.remove());
    nodes.clear();
    for (const it of b.items) { const el = itemEl(it); nodes.set(it.id, el); world.append(el); }
    drawStrings();
  };
  const drawStrings = () => {
    svg.innerHTML = "";
    for (const [i, l] of b.links.entries()) {
      const a = b.items.find((x) => x.id === l.from), c = b.items.find((x) => x.id === l.to);
      if (!a || !c) continue;
      const p = anchorPoint(a, l.fa), q = anchorPoint(c, l.ta);
      const sag = Math.min(80, Math.hypot(q.x - p.x, q.y - p.y) * 0.12);
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M${p.x} ${p.y} Q${(p.x + q.x) / 2} ${(p.y + q.y) / 2 + sag} ${q.x} ${q.y}`);
      path.setAttribute("stroke", l.color || "#E5626A");
      path.classList.add("string");
      path.addEventListener("click", async (e) => {
        e.stopPropagation();
        const res = await modal("String", h("div.stack.sm", h("div.row", { style: { gap: "6px" } }, STRING_COLORS.map((col) => h("button.color-dot", { style: { background: col }, class: col === l.color ? "on" : "",
          onclick: (ev) => { l.color = col; lastColor = col; ev.currentTarget.parentElement.querySelectorAll(".color-dot").forEach((d) => d.classList.remove("on")); ev.currentTarget.classList.add("on"); drawStrings(); changed(); } })))),
        [{ label: "Cut it", kind: "ghost danger", value: "cut" }, { label: "Done", kind: "primary", value: true }]);
        if (res === "cut") b.links.splice(i, 1);
        drawStrings(); changed();
      });
      svg.append(path);
      for (const [pt, end, item] of [[p, "fa", a], [q, "ta", c]]) {
        const pin = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        pin.setAttribute("cx", pt.x); pin.setAttribute("cy", pt.y); pin.setAttribute("r", 5); pin.setAttribute("fill", l.color || "#E5626A");
        pin.classList.add("string-pin");
        const tip = document.createElementNS("http://www.w3.org/2000/svg", "title");
        tip.textContent = "Drag to move where the string is pinned";
        pin.append(tip);
        pin.addEventListener("pointerdown", (e) => pinDrag(e, l, end, item));
        svg.append(pin);
      }
    }
  };
  // where a string is pinned: a spot on the item, as fractions of its width and height (turning with the item)
  const turn = (x, y, deg) => { const r = (deg || 0) * Math.PI / 180; return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) }; };
  const anchorPoint = (it, a) => {
    const fx = a ? a.x : 0.5, fy = a ? a.y : Math.min(26, it.h / 2) / it.h;
    const v = turn(fx * it.w - it.w / 2, fy * it.h - it.h / 2, it.rot);
    return { x: it.x + it.w / 2 + v.x, y: it.y + it.h / 2 + v.y };
  };
  const anchorAt = (it, world) => {
    const v = turn(world.x - (it.x + it.w / 2), world.y - (it.y + it.h / 2), -(it.rot || 0));
    const clamp = (n) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
    return { x: clamp((v.x + it.w / 2) / it.w), y: clamp((v.y + it.h / 2) / it.h) };
  };
  function pinDrag(e, l, end, item) {
    e.stopPropagation(); e.preventDefault();
    let moved = false;
    const move = (ev) => { moved = true; l[end] = anchorAt(item, toWorld(ev.clientX, ev.clientY)); drawStrings(); };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); if (moved) changed(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const removeItem = (id) => {
    b.items = b.items.filter((x) => x.id !== id);
    b.links = b.links.filter((l) => l.from !== id && l.to !== id);
    selected = null; redraw(); changed();
  };
  const addItem = (it) => { it.id = "i" + Math.random().toString(36).slice(2, 10); b.items.push(it); selected = it.id; redraw(); changed(); return it; };
  const addNote = (at) => {
    const it = addItem({ type: "note", x: at.x, y: at.y, w: 200, h: 170, color: NOTE_COLORS[b.items.filter((x) => x.type === "note").length % 5], text: "", rot: Math.round((Math.random() - 0.5) * 4) });
    setTimeout(() => nodes.get(it.id)?.querySelector("textarea")?.focus(), 30);
  };
  const addImage = async (img, at) => {
    try {
      const src = await api.board_add_image(img);
      const probe = new Image();
      probe.onload = () => {
        const w = Math.min(360, probe.naturalWidth || 300), hgt = (w - 16) * ((probe.naturalHeight || 200) / (probe.naturalWidth || 300)) + 16;
        addItem({ type: "image", x: at.x, y: at.y, w, h: hgt, src, caption: "", cap: false });
      };
      probe.onerror = () => addItem({ type: "image", x: at.x, y: at.y, w: 300, h: 200, src, caption: "", cap: false });
      probe.src = fileUrl(src);
    } catch (e) { toastError(e); }
  };
  const addPage = async (at) => {
    const q = h("input.input", { list: "board-pages", placeholder: "Page title…" });
    const dl = h("datalist#board-pages", titles.map((t) => h("option", { value: t.title })));
    setTimeout(() => q.focus(), 50);
    const ok = await modal("Add a page card", h("div.field", h("label", "Lore page"), q, dl), [{ label: "Cancel", kind: "ghost", value: false }, { label: "Add", kind: "primary", value: true }]);
    const id = ok && titles.find((t) => t.title === q.value.trim())?.id;
    if (id) addItem({ type: "page", x: at.x, y: at.y, w: 260, h: 220, page: id });
  };
  const addLink = async (at) => {
    const url = h("input.input", { placeholder: "https://…" }), title = h("input.input", { placeholder: "Optional" });
    setTimeout(() => url.focus(), 50);
    const ok = await modal("Add a link", h("div.stack.sm", h("div.field", h("label", "Address"), url), h("div.field", h("label", "Title"), title)),
      [{ label: "Cancel", kind: "ghost", value: false }, { label: "Add", kind: "primary", value: true }]);
    if (ok && /^https?:\/\//.test(url.value.trim())) addItem({ type: "link", x: at.x, y: at.y, w: 260, h: 70, url: url.value.trim(), title: title.value.trim() });
  };

  // ---- interaction
  function itemDown(e, it, el) {
    if (e.target.closest("textarea, input, button, a.bi-link") && !connecting) { select(it.id, el); return; }
    e.stopPropagation();
    if (connecting) {
      const at = anchorAt(it, toWorld(e.clientX, e.clientY));
      if (!connectFrom) { connectFrom = it.id; connectAt = at; el.classList.add("from"); hint(); return; }
      if (connectFrom !== it.id) {
        b.links.push({ from: connectFrom, to: it.id, color: lastColor, fa: connectAt, ta: at }); changed();
      }
      connectFrom = null; connectAt = null; connecting = false; connectBtn.classList.remove("primary"); stage.classList.remove("connecting"); hint(); redraw();
      return;
    }
    select(it.id, el);
    const resize = e.target.classList.contains("bi-resize");
    const sx = e.clientX, sy = e.clientY, ox = it.x, oy = it.y, ow = it.w, oh = it.h;
    el.setPointerCapture(e.pointerId);
    el.onpointermove = (ev) => {
      const dx = (ev.clientX - sx) / cam.k, dy = (ev.clientY - sy) / cam.k;
      if (resize) { it.w = Math.max(80, ow + dx); it.h = Math.max(50, oh + dy); el.style.width = it.w + "px"; el.style.height = it.h + "px"; }
      else { it.x = ox + dx; it.y = oy + dy; el.style.left = it.x + "px"; el.style.top = it.y + "px"; }
      drawStrings();
    };
    el.onpointerup = () => {
      el.onpointermove = el.onpointerup = null;
      if (it.x !== ox || it.y !== oy || it.w !== ow || it.h !== oh) {
        // bring to front
        b.items = [...b.items.filter((x) => x.id !== it.id), it];
        world.append(el);
        changed();
      }
    };
  }
  function select(id, el) {
    selected = id;
    world.querySelectorAll(".bi.sel").forEach((n) => n.classList.remove("sel"));
    el?.classList.add("sel");
  }
  let pan = null;
  stage.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".bi") || e.target.closest(".string")) return;
    select(null);
    if (connecting) { connecting = false; connectFrom = null; connectBtn.classList.remove("primary"); stage.classList.remove("connecting"); hint(); redraw(); }
    pan = { x: e.clientX - cam.x, y: e.clientY - cam.y };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove", (e) => { if (!pan) return; cam.x = e.clientX - pan.x; cam.y = e.clientY - pan.y; apply(); });
  stage.addEventListener("pointerup", () => { pan = null; });
  stage.addEventListener("wheel", (e) => {
    if (e.target.closest("textarea")) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top;
    const k = Math.min(3, Math.max(0.12, cam.k * Math.exp(-e.deltaY * 0.0015)));
    cam.x = cx - ((cx - cam.x) * k) / cam.k; cam.y = cy - ((cy - cam.y) * k) / cam.k; cam.k = k; apply();
  }, { passive: false });
  stage.addEventListener("dblclick", (e) => { if (!e.target.closest(".bi")) { const p = toWorld(e.clientX, e.clientY); addNote({ x: p.x - 100, y: p.y - 30 }); } });
  stage.addEventListener("dragover", (e) => { e.preventDefault(); stage.classList.add("over"); });
  stage.addEventListener("dragleave", () => stage.classList.remove("over"));
  stage.addEventListener("drop", (e) => {
    e.preventDefault(); stage.classList.remove("over");
    const at = toWorld(e.clientX, e.clientY);
    [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/")).forEach((f, i) => {
      const r = new FileReader(); r.onload = () => addImage({ data_url: r.result }, { x: at.x + i * 30, y: at.y + i * 30 }); r.readAsDataURL(f);
    });
    const url = e.dataTransfer.getData("text/uri-list");
    if (url && !e.dataTransfer.files.length && /^https?:/.test(url)) addItem({ type: "link", x: at.x, y: at.y, w: 260, h: 70, url, title: "" });
  });
  const onPaste = (e) => {
    if (!stage.isConnected) return document.removeEventListener("paste", onPaste);
    if (e.target.closest?.("textarea, input")) return;
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/"));
    if (f) { e.preventDefault(); const r = new FileReader(); r.onload = () => addImage({ data_url: r.result }, center()); r.readAsDataURL(f); return; }
    const text = e.clipboardData?.getData("text/plain")?.trim();
    if (text) { e.preventDefault(); if (/^https?:\/\/\S+$/.test(text)) addItem({ type: "link", ...center(), w: 260, h: 70, url: text, title: "" }); else addItem({ type: "note", ...center(), w: 220, h: 170, color: NOTE_COLORS[0], text }); }
  };
  document.addEventListener("paste", onPaste);
  const onKey = (e) => {
    if (!stage.isConnected) return document.removeEventListener("keydown", onKey);
    if ((e.key === "Delete" || e.key === "Backspace") && selected && !e.target.closest("textarea, input")) { e.preventDefault(); removeItem(selected); }
  };
  document.addEventListener("keydown", onKey);
  ctx.onLeave(() => { document.removeEventListener("paste", onPaste); document.removeEventListener("keydown", onKey); });

  async function settings() {
    const sessions = await api.sessions();
    const page = h("input.input", { value: b.page ? titleOf(b.page) : "", list: "bs-pages", placeholder: "None" });
    const dl = h("datalist#bs-pages", titles.map((t) => h("option", { value: t.title })));
    const sess = h("select.select", h("option", { value: "" }, "None"), sessions.map((s) => h("option", { value: s.id, selected: s.id === b.session }, `Session ${s.number ?? "?"}: ${s.title}`)));
    const res = await modal("Board settings", h("div.stack",
      h("div.field", h("label", "Shows on this lore page"), page, dl),
      h("div.field", h("label", "For this session (shown in live mode)"), sess)),
    [{ label: "Delete board", kind: "ghost danger", value: "delete" }, { label: "Cancel", kind: "ghost", value: false }, { label: "Save", kind: "primary", value: true }]);
    if (res === "delete") {
      if (await confirmBox(`Delete “${b.name}”?`, "It's moved to the campaign's .trash folder.", "Delete", true)) { clearTimeout(saveT); saveT = null; await api.board_delete(bid).catch(toastError); ctx.go("boards", {}); }
      return;
    }
    if (!res) return;
    b.page = titles.find((t) => t.title === page.value.trim())?.id || null;
    b.session = sess.value || null;
    changed();
    ctx.reload();
  }

  redraw();
  apply();
  if (!store.get(camKey, null) && b.items.length) requestAnimationFrame(fit);
  if (!b.items.length) toast("An empty board", "Double-click for a note, or paste or drop pictures anywhere.", "", "board", 5000);
}

/** "Boards" card for lore pages and sessions: open or make one. */
export function boardsCard(ctx, list, attach) {
  const box = h("div");
  Promise.resolve(list).then((items) => {
    clear(box, card({ title: "Boards", actions: btn("", { icon: "plus", size: "sm", kind: "ghost", title: "New board", onclick: () => ctx.go("boards", { new: 1, ...attach }) }) },
      items.length ? h("div.link-list", items.map((b) => h("button.linkrow", { onclick: () => ctx.go("boards", { id: b.id }) },
        b.cover ? h("span.board-thumb", { style: { backgroundImage: `url("${fileUrl(b.cover)}")` } }) : icon("board"), h("span", b.name))))
        : h("p.small.faint", { style: { margin: 0 } }, "No board yet. Make one for pictures and ideas.")));
  }).catch(() => {});
  return box;
}
