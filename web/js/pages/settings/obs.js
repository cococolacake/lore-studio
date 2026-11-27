// Settings → OBS: connecting to OBS for recording.
import { api } from "../../api.js";
import { h, btn, card, toast, toastError } from "../../dom.js";
import { switchEl } from "../../components.js";
import { saveKey, secretInput } from "./helpers.js";

// ---------------------------------------------------------------------------
export function obs(ctx, root) {
  const s = ctx.boot.settings;
  const trackSel = (key) => h("select.select", { onchange: (e) => saveKey(ctx, key)(Number(e.target.value)) },
    [0, 1, 2, 3, 4, 5, 6].map((n) => h("option", { value: n, selected: Number(s[key]) === n }, n ? `Track ${n}` : "None")));
  root.append(ctx.header({ title: "OBS", icon: "play" }),
    h("div.stack",
      card({ title: "Connection" }, h("div.stack",
        switchEl(!!s.obs_enabled, async (v) => { await saveKey(ctx, "obs_enabled")(v); }, "Control OBS from Lore Studio"),
        h("div.grid.c3",
          h("div.field", h("label", "Host"), h("input.input", { value: s.obs_host, onchange: (e) => saveKey(ctx, "obs_host")(e.target.value.trim() || "127.0.0.1") })),
          h("div.field", h("label", "Port"), h("input.input.nums", { type: "number", value: s.obs_port, onchange: (e) => saveKey(ctx, "obs_port")(Number(e.target.value) || 4455) })),
          h("div.field", h("label", "Password"), secretInput(ctx, "obs_password", "From OBS"))),
        h("div", btn("Test the connection", { icon: "zap", size: "sm", onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true;
          try { const r = await api.obs_test(); toast("Connected to OBS", `OBS ${r.obs}, WebSocket ${r.websocket}${r.recording ? " · recording now" : ""}`, "good", "check", 6000); } catch (err) { toastError(err); }
          b.disabled = false;
        } })))),
      card({ title: "Audio tracks" }, h("div.stack.sm",
        h("div.grid.c2",
          h("div.field", h("label", "Your mic (GM)"), trackSel("obs_gm_track")),
          h("div.field", h("label", "Discord (players)"), trackSel("obs_players_track"))))),
      card({ title: "Craig recordings" }, h("p.small.muted", { style: { margin: 0 } },
        "On a session's Transcript tab, choose ", h("b", "Attach one file per person"),
        " and pick Craig's .zip or unzipped folder.")),
      card({ title: "One-time setup in OBS" }, h("ol.setup",
        h("li", "Tools → WebSocket Server Settings → tick ", h("b", "Enable WebSocket server"), ", then Show Connect Info and copy the password here."),
        h("li", "Settings → Output → Recording: set the format to ", h("b", "Hybrid MP4"), " (marked moments become chapters, and the file survives a crash)."),
        h("li", "Edit → Advanced Audio Properties: put ", h("b", "your mic"), " only on track 2 and ", h("b", "Discord"), " only on track 3. (No Discord source yet? Add an ", h("b", "Application Audio Capture"), " source and pick Discord, so other sounds stay out of the players' track.) Keep both on track 1 too, for the video's normal sound."),
        h("li", "Settings → Output → Recording: tick Audio Track ", h("b", "1, 2 and 3"), ". If they're round buttons you can't tick, Recording Quality is set to “Same as stream”, which records one track only: pick ", h("b", "High Quality, Medium File Size"), " instead (or switch Output Mode to Advanced and use its Recording tab).")))));
}
