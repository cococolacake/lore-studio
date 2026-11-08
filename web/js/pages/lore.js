// Lore vault: page tree + search + tags in the side panel; a page reader and editor in the main area.
import { api } from "../api.js";
import { h, btn, card, chip, clear, empty, toast, toastError, promptBox, confirmBox, modal, store } from "../dom.js";
import { icon } from "../icons.js";
import { chooseImage } from "./maps.js";
import { clocksCard } from "./clocks.js";
import { seg } from "../components.js";
import { render } from "../markdown.js";

export default {
  id: "lore", label: "Lore", icon: "book",

  async mount(ctx, params, root) {
    const [tree, tags] = await Promise.all([api.lore_tree(), api.tags()]);
    drawSide(ctx, params, tree, tags);
    if (params.q) return results(ctx, root, params.q);
    return pageView(ctx, root, params.id || "index", params);
  },
};

// ---- side panel -------------------------------------------------------------

function drawSide(ctx, params, tree, tags) {
  const open = new Set(store.get("loreOpen", []));
  const current = params.id || (params.q ? null : "index");
  // keep the path to the current page open
  if (current) {
    const parts = current.split("/");
    for (let i = 1; i < parts.length; i++) open.add(parts.slice(0, i).join("/") + "/index");
  }
  const toggle = (id) => { open.has(id) ? open.delete(id) : open.add(id); store.set("loreOpen", [...open]); };

  const search = h("input.input", { placeholder: "Search, or #tag", value: params.q || "",
    onkeydown: (e) => { if (e.key === "Enter") { const q = e.target.value.trim(); if (q) ctx.go("lore", { q }); } } });

  const node = (n, depth) => {
    const hasKids = n.children.length > 0;
    const isOpen = open.has(n.id);
    const kids = h("div.tree-kids", { class: isOpen ? "" : "hidden" }, hasKids ? n.children.map((c) => node(c, depth + 1)) : null);
    const caret = hasKids ? h("span.caret", { onclick: (e) => { e.stopPropagation(); toggle(n.id); kids.classList.toggle("hidden"); caret.classList.toggle("open"); }, class: isOpen ? "open" : "" }, icon("right")) : h("span.caret.none");
    const row = h("button.tree-row", { class: n.id === current ? "active" : "", style: { paddingLeft: 6 + depth * 14 + "px" },
      onclick: () => n.id ? ctx.go("lore", { id: n.id }) : null },
      caret, h("span.tree-title", n.title), n.gm ? icon("lock") : null);
    return h("div.tree-node", row, kids);
  };

  ctx.side(
    h("h2", "Lore"),
    h("div.search.side-search", icon("search"), search),
    h("div.row.side-actions",
      btn("New page", { icon: "plus", size: "sm", onclick: () => newPage(ctx, null) }),
      btn("", { icon: "globe", size: "sm", title: "Player lore book: share what the players may see", onclick: () => ctx.go("settings", { section: "playersite" }) })),
    tree.home ? h("button.tree-row.home", { class: current === "index" ? "active" : "", onclick: () => ctx.go("lore", { id: "index" }) }, h("span.caret.none"), icon("home"), h("span.tree-title", tree.home.title)) : null,
    h("div.tree", tree.children.map((n) => node(n, 0))),
    tags.length ? [h("div.group-label", "Tags"), h("div.side-tags", tags.map((t) =>
      h("button.tag.click", { class: params.q === "#" + t.tag ? "on" : "", onclick: () => ctx.go("lore", { q: "#" + t.tag }) }, "#" + t.tag, h("b", t.count))))] : null);
}

// ---- search -----------------------------------------------------------------

async function results(ctx, root, q) {
  const hits = await api.search(q);
  const isTag = q.trim().startsWith("#") && !q.trim().includes(" ");
  root.append(ctx.header({ title: isTag ? q.trim() : `“${q}”`, subtitle: `${hits.length} result${hits.length === 1 ? "" : "s"}`, icon: isTag ? "hash" : "search" }));
  if (!hits.length) return root.append(card(null, empty("search", "Nothing found", "Try a shorter word, a name, or a #tag.")));
  root.append(card(null, h("div.list", hits.map((r) =>
    h("div.list-row.click", { onclick: () => r.kind === "session" ? ctx.go("sessions", { id: r.id }) : ctx.go("lore", { id: r.id }) },
      h("div.ic", icon(r.kind === "session" ? "scroll" : "book")),
      h("div.main-col", h("div.title", r.title), r.snippet ? h("div.meta.snippet", r.snippet) : null),
      r.tags?.length ? h("div.row.nowrap", r.tags.slice(0, 3).map((t) => h("span.tag.small", "#" + t))) : null)))));
}

// ---- page view --------------------------------------------------------------

async function pageView(ctx, root, id, params) {
  let page;
  try { page = await api.lore_page(id); } catch (e) {
    root.append(card(null, empty("book", "Page not found", e.message, btn("Back to the landing page", { onclick: () => ctx.go("lore", { id: "index" }) }))));
    return;
  }
  if (params.edit) return editor(ctx, root, page);
  const playerView = !!store.get("playerView", false);
  const names = ctx.boot.settings.auto_link !== false ? await ctx.linkNames() : [];
  const meta = page.meta;
  const tags = asList(meta.tags);
  const aliases = asList(meta.aliases);

  const head = h("header.page-head", { class: meta.banner ? "with-banner" : "" },
    meta.banner ? bannerEl(ctx, id, meta) : null,
    h("div.page-head-body",
      h("div.crumbs", h("button.linkish", { onclick: () => ctx.go("lore", { id: "index" }) }, "Lore"),
        page.crumbs.map((c) => [h("span.faint", "/"), h("button.linkish", { onclick: () => ctx.go("lore", { id: c.id }) }, c.title)])),
      h("div.row.nowrap", { style: { alignItems: "flex-start" } },
        h("h1.page-title", meta.title),
        h("div.spacer"),
        h("div.row.nowrap.page-actions",
          btn("", { icon: "eye", kind: playerView ? "primary" : "", title: playerView ? "Showing what players see. Click for the GM view." : "Preview what players see",
            onclick: () => { store.set("playerView", !playerView); ctx.go("lore", { id }); } }),
          btn("Edit", { icon: "edit", onclick: () => ctx.go("lore", { id, edit: true }) }),
          meta.banner ? null : btn("", { icon: "image", title: "Add a header image", onclick: () => bannerDialog(ctx, id, meta) }),
          btn("", { icon: "dice", title: meta.visibility === "gm" ? "Send to Foundry as a GM-only journal" : "Send to Foundry as a journal players can read (GM-only blocks removed)",
            onclick: () => sendToFoundry(() => api.foundry_send_page(id, meta.visibility !== "gm"), "Page") }),
          btn("", { icon: "plus", title: "Add a subpage", onclick: () => newPage(ctx, id) }))),
      h("div.row.page-chips",
        meta.visibility === "gm" ? chip("GM only", "warn", "lock") : null,
        tags.map((t) => h("button.tag.click", { onclick: () => ctx.go("lore", { q: "#" + t }) }, "#" + t)),
        aliases.length ? h("span.small.faint", "Also called " + aliases.join(", ")) : null)));

  const article = render(page.body, { autoLink: true, linkNames: names, selfId: id, playerView });
  if (!page.body.trim()) article.append(empty("feather", "This page is empty", "Click Edit to start writing.", btn("Edit", { icon: "edit", kind: "primary", onclick: () => ctx.go("lore", { id, edit: true }) })));
  await fillEmbeds(ctx, article, page);

  const back = page.backlinks;
  const linked = card({ title: "Mentioned in" },
    back.pages.length || back.sessions.length ? h("div.stack.sm",
      back.pages.length ? h("div.link-list", back.pages.map((p) => h("button.linkrow", { onclick: () => ctx.go("lore", { id: p.id }) }, icon("book"), h("span", p.title)))) : null,
      back.sessions.length ? h("div.link-list", back.sessions.map((s) => h("button.linkrow", { onclick: () => ctx.go("sessions", { id: s.id }) }, icon("scroll"), h("span", `${s.number}. ${s.title}`)))) : null)
      : h("p.small.faint", { style: { margin: 0 } }, "No other page or recap mentions this one yet."));
  const onMaps = await api.pins_for_page(id).catch(() => []);
  const mapCard = onMaps.length ? card({ title: "On the map" }, h("div.link-list", onMaps.filter((x) => !(playerView && x.gm)).map((x) =>
    h("button.linkrow", { onclick: () => ctx.go("maps", { id: x.map, pin: x.pin || undefined }) }, icon("map"), h("span", x.pin ? x.name : `${x.name} (this page's map)`))))) : null;
  const clockBox = clocksCard(api.clocks_for_page(id), { playerView });
  const kids = page.children.length ? card({ title: "Subpages" }, h("div.link-list", page.children.map((c) =>
    h("button.linkrow", { onclick: () => ctx.go("lore", { id: c.id }) }, icon("book"), h("span", c.title))))) : null;
  const details = card({ title: "Page" }, h("div.stack.sm",
    h("div.small.faint.mono.break", page.path),
    h("div.row",
      btn("Show in folder", { icon: "folder", size: "sm", kind: "ghost", onclick: () => api.open_folder(page.path).catch(toastError) }),
      id !== "index" ? btn("Delete", { icon: "trash", size: "sm", kind: "ghost danger", onclick: async () => {
        if (!await confirmBox(`Delete “${meta.title}”?`, page.children.length ? "Its subpages go with it. Everything is moved to the campaign's .trash folder, so it can be recovered." : "It's moved to the campaign's .trash folder, so it can be recovered.", "Delete", true)) return;
        try { await api.delete_page(id); ctx.links = null; ctx.go("lore", { id: page.crumbs.length ? page.crumbs[page.crumbs.length - 1].id : "index" }); } catch (e) { toastError(e); }
      } }) : null)));

  root.append(head, h("div.lore-grid", h("article.card.article", playerView ? h("div.notice.small", icon("eye"), h("div", "Player view: GM-only blocks are hidden.")) : null, article),
    h("aside.stack", mapCard, clockBox, linked, kids, details)));
}

async function fillEmbeds(ctx, el, page) {
  for (const slot of el.querySelectorAll(".md-embed")) {
    if (slot.dataset.embed === "children") {
      slot.replaceWith(page.children.length ? h("div.embed-grid", page.children.map((c) =>
        h("button.embed-tile", { onclick: () => ctx.go("lore", { id: c.id }) }, icon("book"), h("span", c.title)))) : h("span"));
    } else if (slot.dataset.embed === "sessions") {
      const list = await api.sessions();
      slot.replaceWith(h("div.link-list", list.map((s) => h("button.linkrow", { onclick: () => ctx.go("sessions", { id: s.id }) },
        icon("scroll"), h("span", `${s.number}. ${s.title}`)))));
    }
  }
}

async function newPage(ctx, parentId) {
  const title = await promptBox(parentId ? "New subpage" : "New page", "Page name", "");
  if (!title) return;
  try {
    const r = await api.new_page(parentId, title);
    ctx.links = null;
    ctx.go("lore", { id: r.id, edit: true });
  } catch (e) { toastError(e); }
}

const asList = (v) => (Array.isArray(v) ? v : v ? String(v).split(",") : []).map((x) => String(x).trim()).filter(Boolean);

// ---- editor -----------------------------------------------------------------

async function editor(ctx, root, page) {
  const meta = { ...page.meta };
  const title = h("input.input.title-input", { value: meta.title || "" });
  const tags = h("input.input", { value: asList(meta.tags).join(", "), placeholder: "character, westmarch" });
  const aliases = h("input.input", { value: asList(meta.aliases).join(", "), placeholder: "Other names people use" });
  let visibility = meta.visibility === "gm" ? "gm" : "players";
  const ta = h("textarea.input.editor", { value: page.body, spellcheck: true });
  const preview = h("div.editor-preview");
  const titles = await api.page_titles();
  let dirty = false;

  const refresh = () => clear(preview, render(ta.value, { selfId: page.id }));
  let t = null;
  ta.addEventListener("input", () => { dirty = true; clearTimeout(t); t = setTimeout(refresh, 250); suggest(); });
  refresh();

  const save = async () => {
    const out = { ...meta, title: title.value.trim() || meta.title, tags: asList(tags.value).map((x) => x.replace(/^#/, "").toLowerCase().replace(/\s+/g, "-")),
      aliases: asList(aliases.value), visibility: visibility === "gm" ? "gm" : "" };
    try {
      await api.save_page(page.id, out, ta.value, page.mtime);
      dirty = false;
      ctx.links = null;
      toast("Saved", out.title, "good", "check", 1500);
      ctx.go("lore", { id: page.id });
    } catch (e) { toastError(e); }
  };
  const cancel = async () => {
    if (dirty && !await confirmBox("Discard your changes?", "You have edits that aren't saved.", "Discard", true)) return;
    ctx.go("lore", { id: page.id });
  };
  ta.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); }
    if (pop && !pop.classList.contains("hidden")) {
      const items = [...pop.querySelectorAll("button")];
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items.forEach((b, i) => b.classList.toggle("on", i === sel));
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (items[sel]) { e.preventDefault(); items[sel].click(); }
      } else if (e.key === "Escape") pop.classList.add("hidden");
    }
  });
  window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); } });

  // [[ autocomplete
  const pop = h("div.wl-pop.hidden");
  let sel = 0;
  function suggest() {
    const before = ta.value.slice(0, ta.selectionStart);
    const m = before.match(/\[\[([^\]\n|]*)$/);
    if (!m) return pop.classList.add("hidden");
    const q = m[1].toLowerCase();
    const hits = titles.filter((p) => p.title.toLowerCase().includes(q) || p.aliases.some((a) => a.toLowerCase().includes(q))).slice(0, 8);
    if (!hits.length) return pop.classList.add("hidden");
    sel = 0;
    clear(pop, hits.map((p, i) => h("button", { type: "button", class: i === 0 ? "on" : "", onmousedown: (e) => {
      e.preventDefault();
      const start = ta.selectionStart - m[1].length;
      const after = ta.value.slice(ta.selectionStart).replace(/^[^\]\n]*\]\]/, "");
      ta.value = ta.value.slice(0, start) + p.title + "]]" + after;
      ta.selectionStart = ta.selectionEnd = start + p.title.length + 2;
      pop.classList.add("hidden");
      dirty = true;
      refresh();
      ta.focus();
    } }, icon("book"), p.title)));
    pop.classList.remove("hidden");
  }

  root.append(
    h("div.row.editor-bar",
      h("h2", { style: { margin: 0 } }, "Editing"), h("span.faint", page.meta.title), h("div.spacer"),
      btn("Cancel", { kind: "ghost", onclick: cancel }),
      btn("Save", { icon: "save", kind: "primary", onclick: save })),
    card(null, h("div.stack",
      h("div.grid.c2",
        h("div.field", h("label", "Title"), title),
        h("div.field", h("label", "Who can see it"), seg([["players", "Players", "eye"], ["gm", "GM only", "lock"]], visibility, (v) => { visibility = v; dirty = true; }))),
      h("div.grid.c2",
        h("div.field", h("label", "Tags"), tags, h("div.help", "Comma-separated. Search them with #tag.")),
        h("div.field", h("label", "Also known as"), aliases, h("div.help", "Aliases also count as mentions of this page."))))),
    h("div.editor-split",
      h("div.editor-wrap", ta, pop,
        h("p.tiny.faint", "Markdown. [[Page name]] links a page · :::gm … ::: hides a block from players · {{children}} lists subpages · Ctrl+S saves.")),
      h("div.card.article.editor-preview-card", h("div.card-head", h("h3.card-title", "Preview")), preview)));
  ta.focus();
}

/** Queue a journal for Foundry and say what happens next. */
export async function sendToFoundry(call, what) {
  try {
    await call();
    const st = await api.foundry_status();
    if (st.connected) toast(`${what} sent to Foundry`, "It appears in the Journal tab in a few seconds.", "good", "dice", 5000);
    else toast(`${what} is waiting for Foundry`, "It's sent as soon as your world is open with the Lore Studio Bridge module enabled (Settings → Foundry).", "info", "dice", 8000);
  } catch (e) { toastError(e); }
}

// ---- header images ------------------------------------------------------------------------

export function bannerUrl(b) {
  b = String(b || "");
  return /^https?:\/\//.test(b) ? b : "/c/" + b.split("/").map(encodeURIComponent).join("/");
}

function bannerEl(ctx, id, meta) {
  let y = Number.isFinite(Number(meta.banner_y)) && meta.banner_y !== "" && meta.banner_y != null ? Number(meta.banner_y) : 40;
  const el = h("div.page-banner", { style: { backgroundImage: `url("${bannerUrl(meta.banner).replace(/"/g, "%22")}")`, backgroundPosition: `center ${y}%` } });
  const done = btn("Done", { size: "sm", kind: "primary", onclick: async (e) => {
    e.stopPropagation();
    try { await api.set_banner(id, null, y); } catch (err) { toastError(err); }
    el.classList.remove("moving"); tools.hidden = false; done.hidden = true;
  } });
  done.hidden = true;
  const tools = h("div.banner-tools",
    btn("Change", { icon: "image", size: "sm", onclick: () => bannerDialog(ctx, id, meta) }),
    btn("Reposition", { icon: "move", size: "sm", onclick: () => { el.classList.add("moving"); tools.hidden = true; done.hidden = false; } }),
    btn("", { icon: "trash", size: "sm", title: "Remove the header image", onclick: async () => {
      try { await api.set_banner(id, null, null, true); ctx.go("lore", { id }); } catch (err) { toastError(err); }
    } }));
  el.append(tools, h("div.banner-done", done), h("div.banner-hint", "Drag to choose which part shows"));
  // drag up/down to move the image while repositioning
  el.addEventListener("pointerdown", (e) => {
    if (!el.classList.contains("moving") || e.target.closest("button")) return;
    el.setPointerCapture(e.pointerId);
    const startY = e.clientY, start = y;
    const img = new Image();
    img.src = bannerUrl(meta.banner);
    const move = (ev) => {
      // how far the image can travel depends on how much taller it is than the strip once it covers the width
      const scaled = img.naturalWidth ? (el.clientWidth / img.naturalWidth) * img.naturalHeight : el.clientHeight * 3;
      const travel = Math.max(1, scaled - el.clientHeight);
      y = Math.max(0, Math.min(100, start - ((ev.clientY - startY) / travel) * 100));
      el.style.backgroundPosition = `center ${y}%`;
    };
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  });
  return el;
}

async function bannerDialog(ctx, id, meta) {
  const url = h("input.input", { placeholder: "https://… (an image link)" });
  const preview = h("div.banner-preview", { style: meta.banner ? { backgroundImage: `url("${bannerUrl(meta.banner).replace(/"/g, "%22")}")` } : {} },
    meta.banner ? null : h("span.small.faint", "Choose a file, paste an image (Ctrl+V), or drop one here"));
  let picked = null;
  const show = (img, src) => { picked = img; clear(preview); preview.style.backgroundImage = `url("${src}")`; };
  const fromFile = (f) => {
    if (!f || !f.type.startsWith("image/")) return toast("That isn't an image", "", "warn", "alert");
    const r = new FileReader();
    r.onload = () => show({ data_url: r.result }, r.result);
    r.readAsDataURL(f);
  };
  const onPaste = (e) => {
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/"));
    if (f) { e.preventDefault(); fromFile(f); }
  };
  preview.addEventListener("dragover", (e) => { e.preventDefault(); preview.classList.add("over"); });
  preview.addEventListener("dragleave", () => preview.classList.remove("over"));
  preview.addEventListener("drop", (e) => { e.preventDefault(); preview.classList.remove("over"); fromFile(e.dataTransfer.files[0]); });
  url.addEventListener("change", () => { const u = url.value.trim(); if (/^https?:\/\//.test(u)) show({ url: u }, u); });
  document.addEventListener("paste", onPaste);
  const ok = await modal(meta.banner ? "Change the header image" : "Add a header image", h("div.stack",
    preview,
    h("div.row", { style: { gap: "8px" } },
      btn("Choose a file…", { icon: "folder", onclick: async () => {
        const img = await chooseImage(ctx);
        if (!img) return;
        if (img.data_url) show(img, img.data_url);
        else { picked = img; clear(preview, h("span.small", "✓ " + img.path.split(/[\\/]/).pop())); preview.style.backgroundImage = ""; }
      } }),
      h("span.small.faint", "or")),
    h("div.field", h("label", "Image link"), url),
    h("p.tiny.faint", { style: { margin: 0 } }, "The image is copied into your campaign folder (assets/banners), so it works offline. Wide images look best; you can reposition it afterwards.")),
  [{ label: "Cancel", kind: "ghost", value: false }, { label: "Use this image", kind: "primary", icon: "check", value: true }]);
  document.removeEventListener("paste", onPaste);
  if (!ok) return;
  if (!picked && /^https?:\/\//.test(url.value.trim())) picked = { url: url.value.trim() };
  if (!picked) return toast("No image chosen", "", "warn", "alert");
  try { await api.set_banner(id, picked); ctx.go("lore", { id }); } catch (e) { toastError(e); }
}
