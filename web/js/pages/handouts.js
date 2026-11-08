// Handouts: letters, posters, portraits and maps to give the players, in Foundry or on Discord.
import { api } from "../api.js";
import { h, btn, card, clear, empty, toast, toastError, modal, confirmBox } from "../dom.js";
import { icon } from "../icons.js";
import { switchEl } from "../components.js";
import { render } from "../markdown.js";
import { chooseImage } from "./maps.js";

/** Show a handout in Foundry (it pops up for every player). */
export async function showInFoundry(x) {
  try {
    await api.handout_foundry(x.id, true);
    const st = await api.foundry_status();
    if (st.connected) toast(`Showing “${x.title}”`, "It pops up for everyone in Foundry.", "good", "dice", 4000);
    else toast(`“${x.title}” is waiting for Foundry`, "It's shown as soon as your world is open with the Lore Studio Bridge enabled.", "info", "dice", 7000);
    return true;
  } catch (e) { toastError(e); return false; }
}

/** Preview, edit and post a handout to Discord. */
export async function postHandout(x) {
  const cfg = await api.discord_config();
  if (!(cfg.webhooks || []).length) return toast("Add a Discord webhook first", "Settings → Discord", "warn", "share");
  const sel = h("select.select", cfg.webhooks.map((w, i) => h("option", { value: i }, w.name || `Webhook ${i + 1}`)));
  const text = h("textarea.input", { rows: 6, value: x.text || "" });
  const ok = await modal(`Post “${x.title}” to Discord`, h("div.stack",
    h("div.discord-preview",
      h("div.dp-embed", h("div.dp-title", x.title), h("div.dp-body", { "data-live": "" }, render(x.text || "")), x.image_url ? h("img.dp-img", { src: x.image_url }) : null)),
    h("div.field", h("label", "Text (edit before posting)"), text),
    h("div.field", h("label", "Channel"), sel)),
  [{ label: "Cancel", kind: "ghost", value: false }, { label: "Post it", kind: "primary", icon: "share", value: true }], { wide: true });
  if (!ok) return false;
  try { await api.handout_discord(x.id, text.value, Number(sel.value)); toast("Posted to Discord", x.title, "good", "check", 3000); return true; } catch (e) { toastError(e); return false; }
}

export async function editHandout(x = {}) {
  const isNew = !x.id;
  const titles = await api.page_titles();
  const sessions = await api.sessions();
  const title = h("input.input", { value: x.title || "", placeholder: "e.g. Wanted: John Doe" });
  const text = h("textarea.input", { rows: 6, value: x.text || "", placeholder: "What the players read (Markdown). Leave empty for a picture-only handout." });
  const page = h("input.input", { value: titles.find((t) => t.id === x.page)?.title || "", list: "ho-pages", placeholder: "Optional" });
  const dl = h("datalist#ho-pages", titles.map((t) => h("option", { value: t.title })));
  const sess = h("select.select", h("option", { value: "" }, "Any session"), sessions.map((s) => h("option", { value: s.id, selected: s.id === x.session }, `Session ${s.number ?? "?"}: ${s.title}`)));
  const gmNote = h("input.input", { value: x.gm_note || "", placeholder: "When to give it, what it means (GM only)" });
  let image = null, removeImage = false;
  const preview = h("div.banner-preview.ho-preview", { style: x.image_url ? { backgroundImage: `url("${x.image_url}")` } : {} },
    x.image_url ? null : h("span.small.faint", "Choose a picture, paste one (Ctrl+V), or drop one here"));
  const show = (img, src) => { image = img; removeImage = false; clear(preview); preview.style.backgroundImage = `url("${src}")`; };
  const fromFile = (f) => {
    if (!f || !f.type.startsWith("image/")) return;
    const r = new FileReader(); r.onload = () => show({ data_url: r.result }, r.result); r.readAsDataURL(f);
  };
  const onPaste = (e) => { const f = [...(e.clipboardData?.files || [])].find((y) => y.type.startsWith("image/")); if (f) { e.preventDefault(); fromFile(f); } };
  preview.addEventListener("dragover", (e) => { e.preventDefault(); preview.classList.add("over"); });
  preview.addEventListener("dragleave", () => preview.classList.remove("over"));
  preview.addEventListener("drop", (e) => { e.preventDefault(); preview.classList.remove("over"); fromFile(e.dataTransfer.files[0]); });
  document.addEventListener("paste", onPaste);
  let revealed = !!x.revealed;
  const res = await modal(isNew ? "New handout" : "Edit handout", h("div.stack",
    h("div.field", h("label", "Title"), title),
    h("div.field", h("label", "Picture"), preview, h("div.row", { style: { gap: "8px", marginTop: "6px" } },
      btn("Choose a file…", { icon: "folder", size: "sm", onclick: async () => {
        const img = await chooseImage({ boot: window.ctx.boot });
        if (!img) return;
        if (img.data_url) show(img, img.data_url); else { image = img; clear(preview, h("span.small", "✓ " + img.path.split(/[\\/]/).pop())); preview.style.backgroundImage = ""; }
      } }),
      x.image_url ? btn("Remove picture", { size: "sm", kind: "ghost", onclick: () => { removeImage = true; image = null; preview.style.backgroundImage = ""; clear(preview, h("span.small.faint", "No picture")); } }) : null)),
    h("div.field", h("label", "Text"), text),
    h("div.grid.c2", h("div.field", h("label", "For session"), sess), h("div.field", h("label", "Lore page"), page, dl)),
    h("div.field", h("label", "GM note"), gmNote),
    switchEl(revealed, (v) => { revealed = v; }, "Revealed (players have it, so the player lore book shows it)")),
  [isNew ? null : { label: "Delete", kind: "ghost danger", value: "delete" }, { label: "Cancel", kind: "ghost", value: false }, { label: isNew ? "Create" : "Save", kind: "primary", value: true }].filter(Boolean), { wide: true });
  document.removeEventListener("paste", onPaste);
  if (res === "delete") {
    if (await confirmBox(`Delete “${x.title}”?`, "Copies already in Foundry or Discord stay there.", "Delete", true)) { await api.handout_delete(x.id).catch(toastError); return "deleted"; }
    return null;
  }
  if (!res) return null;
  try {
    return await api.handout_save({ ...x, title: title.value.trim(), text: text.value, session: sess.value || null, gm_note: gmNote.value.trim(), revealed,
      page: titles.find((t) => t.title === page.value.trim())?.id || null, remove_image: removeImage }, image);
  } catch (e) { toastError(e); return null; }
}

export function handoutCard(ctx, x, { compact = false, onChange = null } = {}) {
  const shownTo = [...new Set((x.shown || []).map((s) => s.to.startsWith("discord") ? "Discord" : "Foundry"))];
  return h("div.ho-card", { class: compact ? "compact" : "" },
    x.image_url ? h("div.ho-img", { style: { backgroundImage: `url("${x.image_url}")` }, onclick: () => window.open(x.image_url, "_blank") }) : h("div.ho-img.text", icon("scroll")),
    h("div.ho-body",
      h("div.row.nowrap", h("b.grow.ellipsis", x.title), x.revealed ? h("span.chip.good", icon("eye"), "Revealed") : null),
      compact ? null : x.text ? h("div.small.muted.ho-text", x.text.replace(/[#*_>`[\]]/g, "").slice(0, 160)) : null,
      compact || !x.gm_note ? null : h("div.tiny.faint", icon("lock"), " ", x.gm_note),
      shownTo.length ? h("div.tiny.faint", "Shown in " + shownTo.join(" and ")) : null,
      h("div.row", { style: { gap: "6px", marginTop: "auto" } },
        btn("Show in Foundry", { icon: "dice", size: "sm", kind: "primary", onclick: async () => { if (await showInFoundry(x)) onChange?.(); } }),
        compact ? null : btn("", { icon: "share", size: "sm", title: "Post to Discord", onclick: async () => { if (await postHandout(x)) onChange?.(); } }),
        compact ? null : h("div.spacer"),
        compact ? null : btn("", { icon: "edit", size: "sm", kind: "ghost", title: "Edit", onclick: async () => { if (await editHandout(x)) onChange?.(); } }))));
}

export default {
  id: "handouts", label: "Handouts", icon: "scroll2",

  async mount(ctx, params, root) {
    const all = await api.handouts();
    const sessions = await api.sessions();
    const filter = params.f || "all";
    const shown = all.filter((x) => filter === "all" || (filter === "revealed" ? x.revealed : filter === "hidden" ? !x.revealed : x.session === filter));
    const newBtn = () => btn("New handout", { icon: "plus", kind: "primary", onclick: async () => { if (await editHandout({ session: sessions.find((s) => s.id === filter)?.id })) ctx.reload(); } });
    ctx.side(h("h2", "Handouts"),
      [["all", "All", "scroll2"], ["hidden", "Not given yet", "lock"], ["revealed", "Revealed", "eye"]].map(([k, l, ic]) =>
        h("button.side-item", { class: filter === k ? "active" : "", onclick: () => ctx.go("handouts", { f: k }) }, icon(ic), h("span.grow", l),
          h("span.count", all.filter((x) => k === "all" || (k === "revealed" ? x.revealed : !x.revealed)).length))),
      sessions.filter((s) => all.some((x) => x.session === s.id)).length ? h("div.group-label", "By session") : null,
      sessions.filter((s) => all.some((x) => x.session === s.id)).map((s) => h("button.side-item", { class: filter === s.id ? "active" : "", onclick: () => ctx.go("handouts", { f: s.id }) },
        icon("scroll"), h("span.grow.ellipsis", `${s.number ?? ""}. ${s.title}`))));
    root.append(ctx.header({ title: "Handouts", subtitle: "Letters, posters, portraits and maps for the players. Show them in Foundry with one click, or post them to Discord.", icon: "scroll2", actions: [newBtn()] }));
    if (!shown.length) {
      root.append(card(null, empty("scroll2", all.length ? "Nothing here" : "No handouts yet",
        "Add a picture, some text, or both. In play, “Show in Foundry” pops it up on every player's screen. Put {handout:Title} in a session plan to show it straight from live mode.", newBtn())));
      return;
    }
    root.append(h("div.ho-grid", shown.map((x) => handoutCard(ctx, x, { onChange: () => ctx.reload() }))));
  },
};
