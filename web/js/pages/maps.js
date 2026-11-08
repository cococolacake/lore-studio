// Maps: pan and zoom, pins linked to lore pages and to other maps, GM-only pins, a player view.
import { api } from "../api.js";
import { h, btn, card, clear, empty, toast, toastError, modal, confirmBox, promptBox, store } from "../dom.js";
import { icon } from "../icons.js";
import { switchEl, seg } from "../components.js";
import { PIN_ICONS, pinIcon } from "../pinicons.js";

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
  const layersKey = `mapLayersOff:${mid}`;
  let layersOff = new Set(store.get(layersKey, []));
  const layerNames = () => [...new Set(m.pins.map((p) => p.layer || "").filter(Boolean))].sort();
  const layerBtn = btn("Layers", { icon: "list", size: "sm", title: "Show or hide groups of pins", onclick: (e) => {
    e.stopPropagation();
    const names = ["", ...layerNames()];
    clear(pop, h("b", "Layers"),
      names.length === 1 ? h("div.small.faint", "Give pins a layer (like Towns or Dungeons) in their settings to group them here.") : null,
      names.map((n) => h("label.check", h("input", { type: "checkbox", checked: !layersOff.has(n), onchange: (ev) => {
        ev.target.checked ? layersOff.delete(n) : layersOff.add(n); store.set(layersKey, [...layersOff]); drawPins();
      } }), h("span", n || "No layer"), h("span.tiny.faint", ` ${m.pins.filter((p) => (p.layer || "") === n).length}`))));
    const r = e.currentTarget.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(sr.width - 250, r.left - sr.left)) + "px";
    pop.style.top = "8px";
    pop.classList.remove("hidden");
  } });
  const bar = h("div.map-bar",
    h("div.grow", h("h1.page-title", { style: { margin: 0, fontSize: "24px" } }, m.name),
      h("div.small.faint", `${m.pins.length} pins` + (m.page ? " · " : ""), m.page ? h("button.linkish", { onclick: () => ctx.go("lore", { id: m.page }) }, titleOf(m.page)) : null)),
    m.remote ? btn("Save image offline", { icon: "download", size: "sm", kind: "ghost", title: "The image still loads from LegendKeeper. Save a copy into your campaign.",
      onclick: async (e) => { e.currentTarget.disabled = true; try { await api.download_map_image(mid); toast("Map image saved", "", "good", "check"); ctx.go("maps", { id: mid }); } catch (err) { toastError(err); e.currentTarget.disabled = false; } } }) : null,
    layerBtn, labelBtn, viewBtn, editBtn,
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
  let fitK = 1;
  const zoomRel = () => cam.k / fitK;     // 1 = the whole map fits
  const zoomVis = () => {
    const z = zoomRel();
    for (const el of pinLayer.children) {
      const lo = Number(el.dataset.zmin || 0), hi = Number(el.dataset.zmax || 0);
      el.classList.toggle("zoom-hidden", (lo && z < lo - 1e-6) || (hi && z > hi + 1e-6));
    }
  };
  const apply = () => {
    inner.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`;
    inner.style.setProperty("--k", cam.k);
    zoomVis();
  };
  const fit = () => {
    const r = stage.getBoundingClientRect();
    cam.k = fitK = Math.min(r.width / W, r.height / H) * 0.96;
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

  const visiblePins = () => m.pins.filter((p) => !(player && p.gm) && !layersOff.has(p.layer || ""));
  const drawPins = () => {
    clear(pinLayer, visiblePins().map((p) => {
      const cls = [p.gm ? "gm" : "", p.id === params.pin ? "hl" : "", `size-${p.size || "m"}`, p.label === "always" ? "lbl" : "", p.icon ? "has-icon" : ""].join(" ");
      const el = h("button.pin", { class: cls, "data-zmin": p.zmin || "", "data-zmax": p.zmax || "",
        style: { left: p.x * 100 + "%", top: p.y * 100 + "%", "--pin": p.color || "#9381FF" }, title: p.name },
        h("span.pin-dot", p.icon ? pinIcon(p.icon) : p.map ? icon("map") : null), h("span.pin-label", p.name));
      el.addEventListener("pointerdown", (e) => startPinDrag(e, p, el));
      return el;
    }));
    zoomVis();
  };

  // ---- popover
  const showPop = (p, el) => {
    const r = el.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    clear(pop,
      h("div.row.nowrap", h("span.ball", { style: { background: p.color, color: "#fff" } }, p.icon ? pinIcon(p.icon) : null), h("b.grow", p.name || "Unnamed pin"),
        p.layer ? h("span.chip", p.layer) : null, p.gm ? h("span.chip.warn", icon("lock"), "GM") : null),
      p.page ? h("button.linkrow", { onclick: () => ctx.go("lore", { id: p.page }) }, icon("book"), h("span", titleOf(p.page))) : null,
      p.map ? h("button.linkrow", { onclick: () => ctx.go("maps", { id: p.map }) }, icon("map"), h("span", "Open " + (allMaps.find((x) => x.id === p.map)?.name || "map"))) : null,
      p.note ? h("div.small", { style: { whiteSpace: "pre-wrap" } }, p.note) : null,
      !p.page && !p.map && !p.note ? h("div.small.faint", "Not linked to a page yet.") : null,
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
    let color = p.color || "#9381FF", gm = !!p.gm, ico = p.icon || "", size = p.size || "m", label = p.label || "hover";
    let zmin = p.zmin || null, zmax = p.zmax || null;
    const preview = h("span.pin-preview");
    const drawPreview = () => clear(preview, h("span.pin.static", { class: `size-${size}`, style: { "--pin": color } }, h("span.pin-dot", ico ? pinIcon(ico) : null)));
    const sw = h("div.row", { style: { gap: "6px" } }, COLORS.map((c) => h("button.color-dot", { style: { background: c }, class: c === color ? "on" : "",
      onclick: (e) => { color = c; sw.querySelectorAll(".color-dot").forEach((d) => d.classList.remove("on")); e.currentTarget.classList.add("on"); drawPreview(); } })),
      h("input.color-in", { type: "color", value: /^#[0-9a-f]{6}$/i.test(color) ? color : "#9381ff", title: "Any colour",
        oninput: (e) => { color = e.target.value; sw.querySelectorAll(".color-dot").forEach((d) => d.classList.remove("on")); drawPreview(); } }));
    const icons = h("div.icon-grid", [["", null], ...Object.keys(PIN_ICONS).map((k) => [k, k])].map(([k]) =>
      h("button.icon-pick", { class: k === ico ? "on" : "", title: k || "Plain dot", type: "button",
        onclick: (e) => { ico = k; icons.querySelectorAll(".icon-pick").forEach((d) => d.classList.remove("on")); e.currentTarget.classList.add("on"); drawPreview(); } },
        k ? pinIcon(k) : h("span.plain-dot"))));
    const layer = h("input.input", { value: p.layer || "", placeholder: "e.g. Towns, Dungeons, Quests", list: "pin-layers" });
    const ldl = h("datalist#pin-layers", layerNames().map((n) => h("option", { value: n })));
    const zText = (v) => (v ? `${Math.round(v * 10) / 10}×` : "");
    const zminTxt = h("span.small"), zmaxTxt = h("span.small");
    const drawZ = () => {
      zminTxt.textContent = zmin ? `Appears at ${zText(zmin)} zoom and closer` : "Shows at every zoom";
      zmaxTxt.textContent = zmax ? `Hides when zoomed in past ${zText(zmax)}` : "Never hides when zoomed in";
    };
    drawZ();
    const now = () => Math.round(zoomRel() * 100) / 100;
    q.addEventListener("change", () => { if (!name.value.trim()) name.value = q.value; });
    const note = h("textarea.input", { rows: 2, value: p.note || "", placeholder: "Shown when the pin is clicked (optional)" });
    drawPreview();
    const ok = await modal(isNew ? "New pin" : "Edit pin", h("div.stack.pin-editor",
      h("div.grid.c2",
        h("div.field", h("label", "Name"), name),
        h("div.field", h("label", "Lore page"), q, dl)),
      h("div.field", h("label", h("span", "Icon"), preview), icons),
      h("div.grid.c2",
        h("div.field", h("label", "Colour"), sw),
        h("div.field", h("label", "Size"), seg([["s", "Small"], ["m", "Medium"], ["l", "Large"], ["xl", "Huge"]], size, (v) => { size = v; drawPreview(); }))),
      h("div.grid.c2",
        h("div.field", h("label", "Name on the map"), seg([["hover", "On hover"], ["always", "Always"]], label, (v) => { label = v; })),
        h("div.field", h("label", "Layer"), layer, ldl)),
      h("div.field", h("label", "When it shows"),
        h("div.zoom-row", zminTxt, h("div.row", { style: { gap: "6px" } },
          btn("From this zoom", { size: "sm", title: "Hide it when zoomed out further than the map is now", onclick: () => { zmin = now(); drawZ(); } }),
          zmin ? btn("", { size: "sm", kind: "ghost", icon: "x", title: "Clear", onclick: () => { zmin = null; drawZ(); } }) : null)),
        h("div.zoom-row", zmaxTxt, h("div.row", { style: { gap: "6px" } },
          btn("Up to this zoom", { size: "sm", title: "Hide it when zoomed in closer than the map is now", onclick: () => { zmax = now(); drawZ(); } }),
          zmax ? btn("", { size: "sm", kind: "ghost", icon: "x", title: "Clear", onclick: () => { zmax = null; drawZ(); } }) : null)),
        h("div.help", `Zoom the map to where you want it, then open the pin. The map is at ${zText(now())} now (1× = whole map).`)),
      h("div.grid.c2",
        h("div.field", h("label", "Opens a map"), sub),
        h("div.field", h("label", "Note"), note)),
      switchEl(gm, (v) => { gm = v; }, "GM only (hidden in player view)")),
    [{ label: "Cancel", kind: "ghost", value: false }, { label: isNew ? "Add pin" : "Save", kind: "primary", value: true }]);
    if (!ok) return;
    const page = titles.find((t) => t.title === q.value.trim())?.id || null;
    if (zmin && zmax && zmax < zmin) [zmin, zmax] = [zmax, zmin];
    try {
      m = await api.save_pin(mid, { ...p, name: name.value.trim() || q.value.trim(), page, map: sub.value || null, color, gm,
        icon: ico, size, label, layer: layer.value.trim(), zmin, zmax, note: note.value.trim() });
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
    if (!e.target.closest(".map-bar")) pop.classList.add("hidden");
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
    if (target) { focusPin(target); setTimeout(() => { const el = [...pinLayer.children][visiblePins().indexOf(target)]; if (el) showPop(target, el); }, 50); }
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

/** A map shown inside a lore page: the whole image with its pins. Click a pin to go to its page or sub-map. */
export async function mapPreview(ctx, mid, { playerView = false } = {}) {
  const m = await api.map(mid);
  const pins = m.pins.filter((p) => !(playerView && p.gm) && !(p.zmin && p.zmin > 1.01));
  const frame = h("div.map-preview-frame");
  const img = h("img.map-preview-img", { src: m.image_url, alt: m.name, draggable: false });
  const layer = h("div.map-preview-pins", pins.map((p) => h("button.pin", {
    class: [p.gm ? "gm" : "", `size-${p.size || "m"}`, p.label === "always" ? "lbl" : "", p.icon ? "has-icon" : ""].join(" "),
    style: { left: p.x * 100 + "%", top: p.y * 100 + "%", "--pin": p.color || "#9381FF" }, title: p.note ? `${p.name}\n${p.note}` : p.name,
    onclick: () => { if (p.page) ctx.go("lore", { id: p.page }); else if (p.map) ctx.go("maps", { id: p.map }); else ctx.go("maps", { id: mid, pin: p.id }); } },
  h("span.pin-dot", p.icon ? pinIcon(p.icon) : p.map ? icon("map") : null), h("span.pin-label", p.name))));
  frame.append(img, layer);
  img.onerror = () => clear(frame, h("div.small.faint", { style: { padding: "30px", textAlign: "center" } },
    m.remote ? "The map image is still on LegendKeeper's servers and didn't load. Open the map and use “Save image offline”." : "The map image is missing."));
  return h("div.map-preview",
    h("div.row", { style: { marginBottom: "10px" } }, h("b.grow", icon("map"), " ", m.name), h("span.small.faint", `${pins.length} pin${pins.length === 1 ? "" : "s"}`),
      btn("Open the map", { icon: "external", size: "sm", onclick: () => ctx.go("maps", { id: mid }) })),
    frame);
}
