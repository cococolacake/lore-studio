// Settings → Discord: webhooks and how posts look.
import { api } from "../../api.js";
import { h, btn, card, toast, toastError, clear } from "../../dom.js";
import { icon } from "../../icons.js";
import { seg, switchEl } from "../../components.js";
import { campaign } from "./campaign.js";

// ---------------------------------------------------------------------------
export async function discord(ctx, root) {
  if (!ctx.boot.campaign) return campaign(ctx, root);
  const cfg = await api.discord_config();
  const hooks = h("div.stack.sm");
  const drawHooks = () => clear(hooks,
    cfg.webhooks.map((w, i) => h("div.hook-row",
      h("input.input", { value: w.name || "", placeholder: "#recaps", oninput: (e) => { w.name = e.target.value; } }),
      h("input.input.mono", { value: w.url || "", placeholder: "https://discord.com/api/webhooks/…", oninput: (e) => { w.url = e.target.value.trim(); } }),
      btn("", { icon: "trash", kind: "ghost", onclick: () => { cfg.webhooks.splice(i, 1); drawHooks(); } }))),
    h("div", btn("Add a channel", { icon: "plus", size: "sm", kind: "ghost", onclick: () => { cfg.webhooks.push({ name: "", url: "" }); drawHooks(); } })));
  drawHooks();
  const text = (key, ph) => h("input.input", { value: cfg[key] || "", placeholder: ph, oninput: (e) => { cfg[key] = e.target.value; } });
  const save = btn("Save Discord settings", { icon: "save", kind: "primary", onclick: async () => {
    try { Object.assign(cfg, await api.save_discord_config(cfg)); toast("Saved", "", "good", "check", 1500); } catch (e) { toastError(e); }
  } });
  root.append(ctx.header({ title: "Discord", icon: "share", actions: [save] }),
    h("div.stack",
      card({ title: "Channels" }, h("div.stack.sm",
        h("p.small.muted", { style: { margin: 0 } }, "Channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL. Keep the URL private."),
        hooks)),
      card({ title: "How posts look" }, h("div.stack",
        h("div.grid.c2",
          h("div.field", h("label", "Post as"), text("username", "The Chronicler")),
          h("div.field", h("label", "Avatar image URL"), text("avatar_url", "https://…/avatar.png"))),
        h("div.grid.c3",
          h("div.field", h("label", "Style"), seg([["embed", "Card"], ["plain", "Plain text"]], cfg.style, (v) => { cfg.style = v; })),
          h("div.field", h("label", "Card colour"), h("input.color-in", { type: "color", value: cfg.color || "#9381FF", oninput: (e) => { cfg.color = e.target.value; } })),
          h("div.field", h("label", "Spoiler tags"), switchEl(!!cfg.spoiler, (v) => { cfg.spoiler = v; }, "Hide the text until clicked"))),
        h("div.grid.c3",
          h("div.field", h("label", "Title"), text("title", "Session {number}: {title}")),
          h("div.field", h("label", "Line above"), text("header", "Previously, in {campaign}…")),
          h("div.field", h("label", "Footer"), text("footer", "{campaign} · {date}"))),
        h("div.help", "Placeholders: {number}, {title}, {campaign}, {date}, {world_date}"),
        h("div.field", h("label", "Role to ping"), text("ping_role", "Role ID"),
          h("div.help", "With Developer Mode on: Server settings → Roles → right-click the role → Copy Role ID."))))));
}
