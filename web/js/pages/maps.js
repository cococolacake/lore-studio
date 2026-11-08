// Maps: pan and zoom, pins linked to lore pages and to other maps, GM-only pins, a player view.
import { api } from "../api.js";
import { h, btn, card, clear, empty, toast, toastError, modal, confirmBox, promptBox, store } from "../dom.js";
import { icon } from "../icons.js";
import { switchEl, seg } from "../components.js";

const COLORS = ["#9381FF", "#E5626A", "#F0A04B", "#E9C64A", "#4FB477", "#3FA9A3", "#4A90E2", "#2629EA", "#B06AD9", "#17171A"];

export default {
  id: "maps", label: "Maps", icon: "map",

  async mount(ctx, params, root) {
    const list = await api.maps();
    const current = params.id || store.get("lastMap") || list[0]?.id;
    ctx.side(h("h2", "Maps"),
      h("div", { style: { padding: "0 6px 12px" } }, btn("New map", { icon: "plus", size: "sm", kind: "primary", onclick: () => newMap(ctx) })),
      list.map((m) => h("button.side-item", { class: m.id === current ? "active" : "", onclick: () => ctx.go("maps", { id: m.id }) },
        icon("map"), h("span.grow", h("span", m.name), h("span.sub", `${m.pins} pin${m.pins === 1 ? "" : "s"}`)))));
    if (!list.length || !list.some((m) => m.id === current)) {
      root.append(ctx.header({ title: "Maps", subtitle: "Pin places, link them to lore pages, and nest maps inside maps.", icon: "map" }),
        card(null, empty("map", "No maps yet", "Add a map image (a world map, a region, a city) and start pinning places on it.",
          btn("New map", { icon: "plus", kind: "primary", onclick: () => newMap(ctx) }))));
      return;
    }
    store.set("lastMap", current);
    return mapView(ctx, root, current, params);
  },
};

export async function chooseImage(ctx) {
  if (ctx.boot.native) {
    const path = await api.pick_image();
    return path ? { path } : null;
  }
  return new Promise((resolve) => {
    const inp = h("input", { type: "file", accept: "image/*", style: { display: "none" }, onchange: () => {
      const f = inp.files[0];
      if (!f) return resolve(null);
      const r = new FileReader();
      r.onload = () => resolve({ data_url: r.result, filename: f.name });
      r.onerror = () => resolve(null);
      r.readAsDataURL(f);
    } });
    document.body.append(inp);
    inp.click();
    setTimeout(() => inp.remove(), 60000);
  });
}

async function newMap(ctx) {
  const name = await promptBox("New map", "Map name", "");
  if (!name) return;
  const image = await chooseImage(ctx);
  if (!image) return toast("Pick an image for the map", "", "warn", "image");
  try {
    const m = await api.new_map(name, image);
    ctx.go("maps", { id: m.id, edit: true });
  } catch (e) { toastError(e); }
}

async function mapView(ctx, root, mid, params) {
  let m = await api.map(mid);
  const titles = await api.page_titles();
  const allMaps = await api.maps();
  const titleOf = (pid) => titles.find((t) => t.id === pid)?.title || pid;
  let editing = !!params.edit;
  let player = !!store.get("mapPlayerView", false);

  // ---- toolbar
  const editBtn = btn(editing ? "Done editing" : "Edit pins", { icon: editing ? "check" : "edit", kind: editing ? "primary" : "", size: "sm" });
  let labels = !!store.get("mapLabels", false);
  const labelBtn = btn("", { icon: "tag", size: "sm", kind: labels ? "primary" : "", title: "Show all pin names", onclick: () => {
    labels = !labels; store.set("mapLabels", labels); labelBtn.classList.toggle("primary", labels); stage.classList.toggle("labels", labels);
  } });
  const viewBtn = btn("", { icon: "eye", size: "sm", kind: player ? "primary" : "", title: player ? "Showing what players see" : "Preview what players see" });
  const bar = h("div.map-bar",
    h("div.grow", h("h1.page-title", { style: { margin: 0, fontSize: "24px" } }, m.name),
      h("div.small.faint", `${m.pins.length} pins` + (m.page ? " · " : ""), m.page ? h("button.linkish", { onclick: () => ctx.go("lore", { id: m.page }) }, titleOf(m.page)) : null)),
    m.remote ? btn("Save image offline", { icon: "download", size: "sm", kind: "ghost", title: "The image still loads from LegendKeeper. Save a copy into your campaign.",
      onclick: async (e) => { e.currentTarget.disabled = true; try { await api.download_map_image(mid); toast("Map image saved", "", "good", "check"); ctx.go("maps", { id: mid }); } catch (err) { toastError(err); e.currentTarget.disabled = false; } } }) : null,
    labelBtn, viewBtn, editBtn,
    btn("", { icon: "gear", size: "sm", kind: "ghost", title: "Map settings", onclick: () => mapSettings(ctx, m, titles) }));

  // ---- stage
  const img = h("img.map-img", { src: m.image_url, alt: m.name, draggable: false });
  const pinLayer = h("div.pin-layer");
  const inner = h("div.map-inner", img, pinLayer);
  const pop = h("div.pin-pop.hidden");
  const hint = h("div.map-hint", editing ? "Click the map to add a pin. Drag pins to move them." : "");
  const stage = h("div.map-stage", { class: (editing ? "editing " : "") + (labels ? "labels" : "") }, inner, pop, hint,
    h("div.map-zoom", btn("", { icon: "plus", size: "sm", title: "Zoom in", onclick: () => zoomBy(1.4) }), btn("", { icon: "minus", size: "sm", title: "Zoom out", onclick: () => zoomBy(1 / 1.4) }), btn("", { icon: "fit", size: "sm", title: "Fit the whole map", onclick: () => fit() })));
  root.classList.add("map-page");
  root.append(bar, stage);

  let cam = { x: 0, y: 0, k: 1 };
  let W = 1, H = 1;
  const apply = () => {
    inner.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`;
    inner.style.setProperty("--k", cam.k);
  };
  const fit = () => {
    const r = stage.getBoundingClientRect();
    cam.k = Math.min(r.width / W, r.height / H) * 0.96;
    cam.x = (r.width - W * cam.k) / 2;
    cam.y = (r.height - H * cam.k) / 2;
    apply();
  };
  const zoomAt = (k, cx, cy) => {
    k = Math.min(8, Math.max(0.05, k));
    cam.x = cx - ((cx - cam.x) * k) / cam.k;
    cam.y = cy - ((cy - cam.y) * k) / cam.k;
    cam.k = k;
    apply();
  };
  const zoomBy = (f) => { const r = stage.getBoundingClientRect(); zoomAt(cam.k * f, r.width / 2, r.height / 2); };
  const focusPin = (p) => {
    const r = stage.getBoundingClientRect();
    const k = Math.max(cam.k, Math.min(r.width / W, r.height / H) * 2.2);
    cam.k = k;
    cam.x = r.width / 2 - p.x * W * k;
    cam.y = r.height / 2 - p.y * H * k;
    apply();
  };

  const drawPins = () => clear(pinLayer, m.pins.filter((p) => !(player && p.gm)).map((p) => {
    const el = h("button.pin", { class: (p.gm ? "gm " : "") + (p.id === params.pin ? "hl" : ""), style: { left: p.x * 100 + "%", top: p.y * 100 + "%", "--pin": p.color || "#9381FF" }, title: p.name },
      h("span.pin-dot", p.map ? icon("map") : null), h("span.pin-label", p.name));
    el.addEventListener("pointerdown", (e) => startPinDrag(e, p, el));
    return el;
  }));

  // ---- popover
  const showPop = (p, el) => {
    const r = el.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    clear(pop,
      h("div.row.nowrap", h("span.ball", { style: { background: p.color } }), h("b.grow", p.name || "Unnamed pin"), p.gm ? h("span.chip.warn", icon("lock"), "GM") : null),
      p.page ? h("button.linkrow", { onclick: () => ctx.go("lore", { id: p.page }) }, icon("book"), h("span", titleOf(p.page))) : null,
      p.map ? h("button.linkrow", { onclick: () => ctx.go("maps", { id: p.map }) }, icon("map"), h("span", "Open " + (allMaps.find((x) => x.id === p.map)?.name || "map"))) : null,
      !p.page && !p.map ? h("div.small.faint", "Not linked to a page yet.") : null,
      editing ? h("div.row", { style: { marginTop: "6px" } },
        btn("Edit", { size: "sm", icon: "edit", onclick: () => editPin(p) }),
        btn("Delete", { size: "sm", kind: "ghost danger", icon: "trash", onclick: async () => {
          if (!await confirmBox(`Delete the pin “${p.name}”?`, "The linked page isn't touched.", "Delete", true)) return;
          m = await api.delete_pin(mid, p.id).catch(toastError) || m; pop.classList.add("hidden"); drawPins();
        } })) : null);
    pop.style.left = Math.min(sr.width - 250, Math.max(8, r.left - sr.left + 18)) + "px";
    pop.style.top = Math.max(8, r.top - sr.top - 10) + "px";
    pop.classList.remove("hidden");
  };

  // ---- pin editor
  const editPin = async (p) => {
    const isNew = !p.id;
    const name = h("input.input", { value: p.name || "", placeholder: "Ravenford" });
    const q = h("input.input", { value: p.page ? titleOf(p.page) : "", placeholder: "Search pages…", list: "pin-pages" });
    const dl = h("datalist#pin-pages", titles.map((t) => h("option", { value: t.title })));
    const sub = h("select.select", h("option", { value: "" }, "No sub-map"),
      allMaps.filter((x) => x.id !== mid).map((x) => h("option", { value: x.id, selected: x.id === p.map }, x.name)));
    let color = p.color || "#9381FF", gm = !!p.gm;
    const sw = h("div.row", { style: { gap: "6px" } }, COLORS.map((c) => h("button.color-dot", { style: { background: c }, class: c === color ? "on" : "",
      onclick: (e) => { color = c; sw.querySelectorAll(".color-dot").forEach((d) => d.classList.remove("on")); e.currentTarget.classList.add("on"); } })));
    q.addEventListener("change", () => { if (!name.value.trim()) name.value = q.value; });
    const ok = await modal(isNew ? "New pin" : "Edit pin", h("div.stack",
      h("div.field", h("label", "Name"), name),
      h("div.field", h("label", "Lore page"), q, dl, h("div.help", "Clicking the pin opens this page. Its page also shows where it is on the map.")),
      h("div.field", h("label", "Opens a map"), sub),
      h("div.field", h("label", "Colour"), sw),
      switchEl(gm, (v) => { gm = v; }, "GM only (hidden in player view)")),
    [{ label: "Cancel", kind: "ghost", value: false }, { label: isNew ? "Add pin" : "Save", kind: "primary", value: true }]);
    if (!ok) return;
    const page = titles.find((t) => t.title === q.value.trim())?.id || null;
    try {
      m = await api.save_pin(mid, { ...p, name: name.value.trim() || q.value.trim(), page, map: sub.value || null, color, gm });
      pop.classList.add("hidden");
      drawPins();
    } catch (e) { toastError(e); }
  };

  // ---- interaction: pan, zoom, click, drag pins
  let pan = null, moved = false, dragging = null;
  const toImage = (cx, cy) => { const r = stage.getBoundingClientRect(); return { x: (cx - r.left - cam.x) / (W * cam.k), y: (cy - r.top - cam.y) / (H * cam.k) }; };
  function startPinDrag(e, p, el) {
    e.stopPropagation();
    moved = false;
    dragging = { p, el, sx: e.clientX, sy: e.clientY };
    el.setPointerCapture(e.pointerId);
    el.onpointermove = (ev) => {
      if (!editing) return;
      if (Math.hypot(ev.clientX - dragging.sx, ev.clientY - dragging.sy) > 4) moved = true;
      if (!moved) return;
      const pt = toImage(ev.clientX, ev.clientY);
      el.style.left = Math.min(1, Math.max(0, pt.x)) * 100 + "%";
      el.style.top = Math.min(1, Math.max(0, pt.y)) * 100 + "%";
    };
    el.onpointerup = async (ev) => {
      el.onpointermove = el.onpointerup = null;
      const d = dragging; dragging = null;
      if (moved && editing) {
        const pt = toImage(ev.clientX, ev.clientY);
        try { m = await api.save_pin(mid, { ...d.p, x: pt.x, y: pt.y }); drawPins(); } catch (err) { toastError(err); }
      } else showPop(d.p, el);
    };
  }
  stage.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".pin, .pin-pop, .map-zoom")) return;
    pan = { x: e.clientX - cam.x, y: e.clientY - cam.y, sx: e.clientX, sy: e.clientY };
    moved = false;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove", (e) => {
    if (!pan) return;
    if (Math.hypot(e.clientX - pan.sx, e.clientY - pan.sy) > 4) moved = true;
    cam.x = e.clientX - pan.x; cam.y = e.clientY - pan.y; apply();
  });
  stage.addEventListener("pointerup", (e) => {
    if (!pan) return;
    const wasMoved = moved; pan = null;
    if (wasMoved) return;
    pop.classList.add("hidden");
    if (editing) {
      const pt = toImage(e.clientX, e.clientY);
      if (pt.x >= 0 && pt.x <= 1 && pt.y >= 0 && pt.y <= 1) editPin({ x: pt.x, y: pt.y, color: "#9381FF" });
    }
  });
  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomAt(cam.k * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  editBtn.onclick = () => ctx.go("maps", { id: mid, edit: !editing });
  viewBtn.onclick = () => { player = !player; store.set("mapPlayerView", player); viewBtn.classList.toggle("primary", player); pop.classList.add("hidden"); drawPins(); };

  const ready = () => {
    W = img.naturalWidth || 1600; H = img.naturalHeight || 1000;
    inner.style.width = W + "px"; inner.style.height = H + "px";
    fit();
    drawPins();
    const target = m.pins.find((p) => p.id === params.pin);
    if (target) { focusPin(target); setTimeout(() => { const el = [...pinLayer.children][m.pins.filter((p) => !(player && p.gm)).indexOf(target)]; if (el) showPop(target, el); }, 50); }
  };
  if (!m.image_url) {
    stage.append(h("div.map-noimg", empty("image", "No image yet", "Add an image in the map's settings.")));
  } else if (img.complete && img.naturalWidth) ready();
  else {
    img.onload = ready;
    img.onerror = () => stage.append(h("div.map-noimg", empty("image", "The image didn't load",
      m.remote ? "It's still on LegendKeeper's servers. Check your connection, then use “Save image offline”." : "The image file is missing from the maps folder.")));
  }
  const ro = new ResizeObserver(() => { if (W > 1) fit(); });
  ro.observe(stage);
  ctx.onLeave(() => ro.disconnect());
}

async function mapSettings(ctx, m, titles) {
  const name = h("input.input", { value: m.name });
  const page = h("input.input", { value: titles.find((t) => t.id === m.page)?.title || "", list: "map-pages", placeholder: "Search pages…" });
  const dl = h("datalist#map-pages", titles.map((t) => h("option", { value: t.title })));
  let image = null;
  const imgBtn = btn("Replace image", { icon: "upload", size: "sm", onclick: async () => { image = await chooseImage(ctx); if (image) imgBtn.lastChild.textContent = "New image chosen"; } });
  const r = await modal("Map settings", h("div.stack",
    h("div.field", h("label", "Name"), name),
    h("div.field", h("label", "Page this map belongs to"), page, dl),
    h("div", imgBtn),
    h("hr.soft"),
    h("div", btn("Delete map", { icon: "trash", size: "sm", kind: "ghost danger", onclick: async () => {
      if (!await confirmBox(`Delete “${m.name}”?`, "The map and its image are moved to the campaign's .trash folder.", "Delete", true)) return;
      document.querySelectorAll(".scrim").forEach((x) => x.remove());
      await api.delete_map(m.id).catch(toastError);
      store.set("lastMap", null);
      ctx.go("maps");
    } }))),
  [{ label: "Cancel", kind: "ghost", value: false }, { label: "Save", kind: "primary", value: true }]);
  if (!r) return;
  try {
    await api.update_map(m.id, { name: name.value.trim() || m.name, page: titles.find((t) => t.title === page.value.trim())?.id || null, image });
    ctx.go("maps", { id: m.id });
  } catch (e) { toastError(e); }
}
