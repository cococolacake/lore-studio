// Settings → Foundry: the bridge module, and the music downloader.
import { api } from "../../api.js";
import { h, btn, card, toast, toastError, confirmBox, clear } from "../../dom.js";
import { icon } from "../../icons.js";
import { pathInput } from "../../components.js";
import { musicCard } from "./music.js";

// ---------------------------------------------------------------------------
export async function foundry(ctx, root) {
  const info = await api.foundry_info();
  let dataDir = info.data_dirs[0] || "";
  const statusLine = h("div.small");
  const drawStatus = (st) => {
    clear(statusLine);
    statusLine.append(st.connected
      ? h("span.chip.good", icon("check"), ` Connected${st.world ? ` to ${st.world}` : ""}${st.user ? ` as ${st.user}` : ""}`)
      : h("span.chip", "Not connected. Open your world in Foundry as the GM with the module enabled."));
    if (st.connected && st.system) statusLine.append(h("span.muted", ` · Foundry ${st.foundry}, ${st.system}`));
  };
  drawStatus(info.status);
  const timer = setInterval(async () => {
    if (!statusLine.isConnected) return clearInterval(timer);
    try { drawStatus(await api.foundry_status()); } catch { /* ignore */ }
  }, 4000);
  const copy = (text, what) => navigator.clipboard.writeText(text).then(() => toast(`${what} copied`, "", "good", "check", 2500), toastError);
  const tokenBox = h("input.input.mono", { value: info.token, readonly: true, type: "password" });
  root.append(ctx.header({ title: "Foundry VTT", subtitle: "Send rolls, chat and combat to the session log, and lore pages and recaps to Foundry journals.", icon: "dice" }),
    h("div.stack",
      card({ title: "Status" }, statusLine),
      card({ title: "Install the module" }, h("div.stack.sm",
        h("p.small.muted", { style: { margin: 0 } }, `Lore Studio Bridge ${info.module_version}. Pick Foundry's Data folder (the one containing modules and worlds) and Lore Studio copies the module in. Installing again updates it.`),
        h("div.field", h("label", "Foundry Data folder"), pathInput(dataDir, (v) => { dataDir = v; }, { folder: true, placeholder: "C:/Users/you/AppData/Local/FoundryVTT/Data" })),
        h("div", btn("Install module", { icon: "download", size: "sm", onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true;
          try { const where = await api.foundry_install(dataDir); toast("Module installed", where, "good", "check", 6000); } catch (err) { toastError(err); }
          b.disabled = false;
        } })))),
      card({ title: "Connect" }, h("div.stack.sm",
        h("div.grid.c2",
          h("div.field", h("label", "Lore Studio address"), h("div.input-wrap", h("input.input.mono", { value: info.url, readonly: true }),
            btn("", { icon: "copy", title: "Copy", onclick: () => copy(info.url, "Address") }))),
          h("div.field", h("label", "Token"), h("div.input-wrap", tokenBox,
            btn("", { icon: "eye", title: "Show", onclick: () => { tokenBox.type = tokenBox.type === "password" ? "text" : "password"; } }),
            btn("", { icon: "copy", title: "Copy", onclick: () => copy(info.token, "Token") })))),
        h("div", btn("New token", { size: "sm", kind: "ghost", onclick: async () => {
          if (!(await confirmBox("Make a new token?", "Foundry will stop connecting until you paste the new token into the module settings."))) return;
          const r = await api.foundry_new_token(); tokenBox.value = r.token; info.token = r.token;
        } })))),
      card({ title: "One-time setup in Foundry" }, h("ol.setup",
        h("li", "Install the module above, then start Foundry and open your world."),
        h("li", "Game Settings → Manage Modules → tick ", h("b", "Lore Studio Bridge"), "."),
        h("li", "Game Settings → Configure Settings → Lore Studio Bridge: paste the ", h("b", "address"), " and ", h("b", "token"), " from this page."),
        h("li", "Keep Lore Studio open while you play. Only the GM's browser talks to it, and only on this computer."))),
      musicCard(ctx)));
}
