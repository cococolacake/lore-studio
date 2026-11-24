// Settings: campaign, appearance (theme engine), reading, about.
import { h, toastError } from "../dom.js";
import { icon } from "../icons.js";
import { campaign } from "./settings/campaign.js";
import { appearance, reading } from "./settings/appearance.js";
import { about } from "./settings/about.js";
import { claude } from "./settings/ai.js";
import { transcription } from "./settings/transcription.js";
import { obs } from "./settings/obs.js";
import { foundry } from "./settings/foundry.js";
import { playersite } from "./settings/playersite.js";
import { discord } from "./settings/discord.js";

const SECTIONS = [["campaign", "Campaign", "book"], ["claude", "AI", "feather"], ["transcription", "Transcription", "file"],
  ["obs", "OBS", "play"], ["foundry", "Foundry", "dice"], ["discord", "Discord", "share"], ["playersite", "Player lore book", "globe"], ["appearance", "Appearance", "palette"], ["reading", "Reading", "eye"], ["about", "About", "info"]];

export default {
  id: "settings", label: "Settings", icon: "gear",

  mount(ctx, params, root) {
    const section = params.section || (ctx.boot.campaign ? "campaign" : "appearance");
    ctx.side(h("h2", "Settings"), SECTIONS.map(([id, label, ic]) =>
      h("button.side-item", { class: id === section ? "active" : "", onclick: () => ctx.go("settings", { section: id }) }, icon(ic), h("span", label))));
    const fn = ({ campaign, claude, transcription, obs, foundry, discord, playersite, appearance, reading, about })[section] || campaign;
    const out = fn(ctx, root);
    if (out instanceof Promise) out.catch(toastError);
  },
};
