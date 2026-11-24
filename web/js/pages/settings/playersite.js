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
      toast("Player lore book ready", "Preview it, then upload the folder to share it.", "good", "check", 5000);
    } catch (err) { toastError(err); }
    b.disabled = false;
  } });
  const missing = info.sessions_without_player_recap;
  root.append(ctx.header({ title: "Player lore book", subtitle: "A website of everything your players are allowed to see, to share with a link.", icon: "globe" }),
    h("div.stack",
      card({ title: "Your lore book", actions: h("div.row", { style: { gap: "6px" } }, previewBtn, buildBtn) }, h("div.stack.sm",
        status,
        h("div.notice.small", icon("lock"), h("div.grow", `GM-only pages (${info.gm_pages}), GM blocks, GM map pins, GM clocks, GM calendar events and handouts you haven't revealed are left out before anything is written, so they're not in the website at all. Everything else is in, so mark secrets as GM-only first.`)),
        h("div", btn("Open the folder", { icon: "folder", size: "sm", kind: "ghost", onclick: () => api.player_site_open().catch(toastError) })))),
      card({ title: "What to include" }, h("div.stack.sm",
        switchEl(o.maps, (v) => save({ maps: v }), "Maps (without GM pins)"),
        switchEl(o.handouts, (v) => save({ handouts: v }), "Handouts you've marked as revealed"),
        switchEl(o.calendar, (v) => save({ calendar: v }), "Calendar: today's date, holidays and events that aren't GM-only"),
        switchEl(o.clocks, (v) => save({ clocks: v }), "Clocks that aren't GM-only, as “Rumours & threats”"),
        switchEl(o.timeline, (v) => save({ timeline: v }), "Timeline blocks and lanes that aren't GM-only"),
        switchEl(o.gm_recaps, (v) => save({ gm_recaps: v }), "For sessions without a player recap, use the main recap (GM blocks removed)"),
        missing.length ? h("p.tiny.faint", { style: { margin: 0 } }, `${missing.length} session${missing.length === 1 ? " has" : "s have"} a recap but no player recap (${missing.slice(0, 12).join(", ")}${missing.length > 12 ? "…" : ""}). Main recaps can mention GM things outside GM blocks, like a “For the GM” section, so check them before turning this on.`) : null,
        h("div.grid.c2",
          h("div.field", h("label", "Title"), h("input.input", { value: o.title || "", placeholder: ctx.boot.campaign.name, onchange: (e) => save({ title: e.target.value.trim() }) })),
          h("div.field", h("label", "Folder"), pathInput(o.out_dir || "", (v) => save({ out_dir: v }), { folder: true, placeholder: info.default }))))),
      card({ title: "Sharing it" }, h("div.stack.sm",
        h("p.small.muted", { style: { margin: 0 } }, "The lore book is a plain folder of files, so any free static host can put it online. Rebuild and upload again after each session."),
        h("ol.setup",
          h("li", h("b", "Quickest: Netlify Drop. "), "Go to app.netlify.com/drop and drag the folder onto the page. You get a link at once; make a free account to keep it and to update it by dragging again."),
          h("li", h("b", "GitHub Pages. "), "Make a repository, upload the folder's contents, then Settings → Pages → deploy from the main branch. The link looks like you.github.io/your-repo."),
          h("li", h("b", "Neocities, a shared Google Drive or Dropbox folder, or a zip on Discord "), "work too: players open index.html.")),
        h("p.tiny.faint", { style: { margin: 0 } }, "Anyone with the link can read it, so treat it like anything else you post for the players.")))));
}
