// "Post to Discord": edit the text, see exactly how it will look (split into parts), confirm, post.
import { api } from "../api.js";
import { h, btn, clear, toast, toastError, modal, confirmBox } from "../dom.js";
import { icon } from "../icons.js";

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Roughly how Discord shows its Markdown (enough for a faithful preview). */
function discordHtml(md) {
  let s = esc(md || "");
  s = s.replace(/^### (.*)$/gm, "<h5>$1</h5>").replace(/^## (.*)$/gm, "<h4>$1</h4>").replace(/^# (.*)$/gm, "<h3>$1</h3>");
  s = s.replace(/^-# (.*)$/gm, '<small class="dc-sub">$1</small>');
  s = s.replace(/^&gt; (.*)$/gm, "<blockquote>$1</blockquote>");
  s = s.replace(/\|\|([\s\S]+?)\|\|/g, '<span class="dc-spoiler">$1</span>');
  s = s.replace(/\*\*([\s\S]+?)\*\*/g, "<b>$1</b>").replace(/__([\s\S]+?)__/g, "<u>$1</u>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>");
  s = s.replace(/&lt;@&amp;(\d+)&gt;/g, '<span class="dc-mention">@role</span>');
  return s.replace(/\n/g, "<br>");
}

function previewMessage(msg, cfg, campaignName) {
  const name = msg.username || cfg.username || "Recap webhook";
  return h("div.dc-msg",
    h("div.dc-avatar", { style: msg.avatar_url ? { backgroundImage: `url("${msg.avatar_url.replace(/"/g, "")}")` } : {} }, msg.avatar_url ? null : icon("feather")),
    h("div.dc-body",
      h("div.dc-name", name, h("span.dc-bot", "APP")),
      msg.content ? h("div.dc-content", { html: discordHtml(msg.content) }) : null,
      (msg.embeds || []).map((e) => h("div.dc-embed", { style: { borderLeftColor: "#" + (e.color ?? 0x9381ff).toString(16).padStart(6, "0") } },
        e.author ? h("div.dc-author", e.author.name) : null,
        e.title ? h("div.dc-title", e.title) : null,
        h("div.dc-desc", { html: discordHtml(e.description) }),
        e.footer ? h("div.dc-footer", e.footer.text) : null))));
}

export async function postToDiscord(ctx, s, text) {
  let cfg;
  try { cfg = await api.discord_config(); } catch (e) { return toastError(e); }
  if (!cfg.webhooks?.length) {
    toast("Add a Discord webhook first", "Settings → Discord", "warn", "share");
    return ctx.go("settings", { section: "discord" });
  }
  let messages = [];
  const ta = h("textarea.input.editor.short", { value: text || "", spellcheck: true });
  const hook = h("select.select", cfg.webhooks.map((w, i) => h("option", { value: i }, w.name || `Webhook ${i + 1}`)));
  const title = h("input.input", { value: cfg.title });
  const preview = h("div.dc-preview");
  const count = h("div.small.faint");
  let timer = null;
  const refresh = async () => {
    try {
      messages = await api.discord_preview(s.id, ta.value, { title: title.value });
      clear(preview, messages.map((m) => previewMessage(m, cfg, ctx.boot.campaign.name)));
      count.textContent = `${messages.length} message${messages.length === 1 ? "" : "s"} · GM-only blocks and time markers are removed automatically`;
    } catch (e) { clear(preview, h("div.notice.bad", icon("alert"), h("div", e.message))); }
  };
  const later = () => { clearTimeout(timer); timer = setTimeout(refresh, 300); };
  ta.addEventListener("input", later);
  title.addEventListener("input", later);
  refresh();

  const body = h("div.dc-layout",
    h("div.stack.sm",
      h("div.grid.c2", h("div.field", h("label", "Channel"), hook), h("div.field", h("label", "Title"), title)),
      h("div.field", h("label", "Recap"), ta),
      h("p.tiny.faint", { style: { margin: 0 } }, "Edits here are saved to the player recap when you post. Style, name, avatar and pings are in Settings → Discord.")),
    h("div.stack.sm", h("label.label", "Preview"), preview, count));

  const ok = await modal("Post to Discord", body,
    [{ label: "Cancel", kind: "ghost", value: false }, { label: "Post", kind: "primary", icon: "share", value: true }], { wide: true });
  if (!ok) return;
  await refresh();
  const where = cfg.webhooks[Number(hook.value)]?.name || "Discord";
  if (!await confirmBox(`Post to ${where}?`, `${messages.length} message${messages.length === 1 ? "" : "s"} will be posted now. Your players will see ${messages.length === 1 ? "it" : "them"} right away.`, "Post now")) return;
  try {
    const playerSafe = ta.value.replace(/^:::[ \t]*gm\b[\s\S]*?^:::[ \t]*$\n?/gm, "").replace(/\{t:\d{1,2}:\d{2}:\d{2}\}/g, "").trim();
    await api.save_player_recap(s.id, playerSafe);
    const r = await api.discord_post(s.id, ta.value, Number(hook.value), { title: title.value });
    toast("Posted to Discord", `${r.ids.length} message${r.ids.length === 1 ? "" : "s"} in ${r.channel}`, "good", "check");
    ctx.go("sessions", { id: s.id, tab: "recap" });
  } catch (e) { toastError(e); }
}
