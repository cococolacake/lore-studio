// Settings → Player lore book.
import { api } from "../../api.js";
import { h, btn, card, toast, toastError } from "../../dom.js";
import { icon } from "../../icons.js";
import { switchEl, pathInput } from "../../components.js";
import { campaign } from "./campaign.js";

// ---------------------------------------------------------------------------
export async function playersite(ctx, root) {
  if (!ctx.boot.campaign) return campaign(ctx, root);
  let info = await api.player_site();
  const o = { ...info.options };
  const save = async (patch) => { Object.assign(o, patch); try { info = await api.player_site_save(patch); } catch (e) { toastError(e); } };
  const status = h("div.small.muted");
  const drawStatus = () => { status.textContent = info.built ? `Last built ${info.built}, in ${info.path}` : `Not built yet. It goes in ${info.path}`; };
  drawStatus();
  const previewBtn = btn("Preview", { icon: "eye", size: "sm", disabled: !info.preview && !info.built, onclick: () => {
    if (info.preview) window.open(info.preview, "_blank");
    else api.player_site_open().catch(toastError);
  } });
  const buildBtn = btn(info.built ? "Update the lore book" : "Build the lore book", { icon: "refresh", kind: "primary", onclick: async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      const tid = await api.player_site_build();
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const st = await api.task(tid).catch(() => null);
        if (!st || st.status !== "running") {
          if (st?.status === "error" || st?.status === "failed") throw new Error((st.lines || []).slice(-1)[0] || "Building the lore book failed.");
          break;
        }
      }
      info = await api.player_site(); drawStatus();
      previewBtn.disabled = false;
      toast("Player lore book ready", "", "good", "check", 5000);
    } catch (err) { toastError(err); }
    b.disabled = false;
  } });
  const missing = info.sessions_without_player_recap;
  root.append(ctx.header({ title: "Player lore book", icon: "globe" }),
    h("div.stack",
      card({ title: "Your lore book", actions: h("div.row", { style: { gap: "6px" } }, previewBtn, buildBtn) }, h("div.stack.sm",
        status,
        h("div.notice.small", icon("lock"), h("div.grow", `Left out: GM-only pages (${info.gm_pages}), blocks, map pins, clocks and calendar events, and unrevealed handouts. Everything else is included.`)),
        h("div", btn("Open the folder", { icon: "folder", size: "sm", kind: "ghost", onclick: () => api.player_site_open().catch(toastError) })))),
      card({ title: "What to include" }, h("div.stack.sm",
        switchEl(o.maps, (v) => save({ maps: v }), "Maps"),
        switchEl(o.handouts, (v) => save({ handouts: v }), "Revealed handouts"),
        switchEl(o.calendar, (v) => save({ calendar: v }), "Calendar"),
        switchEl(o.clocks, (v) => save({ clocks: v }), "Clocks (as “Rumours & threats”)"),
        switchEl(o.timeline, (v) => save({ timeline: v }), "Timeline"),
        switchEl(o.gm_recaps, (v) => save({ gm_recaps: v }), "Use the main recap when a session has no player recap"),
        missing.length ? h("p.tiny.faint", { style: { margin: 0 } }, `No player recap: ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? "…" : ""}. Main recaps can mention GM details outside GM blocks.`) : null,
        h("div.grid.c2",
          h("div.field", h("label", "Title"), h("input.input", { value: o.title || "", placeholder: ctx.boot.campaign.name, onchange: (e) => save({ title: e.target.value.trim() }) })),
          h("div.field", h("label", "Folder"), pathInput(o.out_dir || "", (v) => save({ out_dir: v }), { folder: true, placeholder: info.default }))))),
      card({ title: "Sharing" }, h("div.stack.sm",
        h("ol.setup",
          h("li", h("b", "Netlify Drop: "), "drag the folder onto app.netlify.com/drop. Make a free account to keep the link."),
          h("li", h("b", "GitHub Pages: "), "upload the folder's contents to a repository, then Settings → Pages → deploy from main."),
          h("li", h("b", "Anywhere else: "), "Neocities, a shared Drive or Dropbox folder, or a zip. Players open index.html."))))));
}
