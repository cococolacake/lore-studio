// Settings → Appearance (the theme engine) and Reading.
import { api } from "../../api.js";
import { h, btn, card, toast, toastError, promptBox, clear } from "../../dom.js";
import { icon } from "../../icons.js";
import { seg, switchEl } from "../../components.js";
import { applyTheme } from "../../theme.js";
import { zoomSupported, zoomLabel, stepZoom, setZoom, onZoom } from "../../zoom.js";
import { cssThemes } from "../../csstheme.js";
import { campaign } from "./campaign.js";
import { saveKey } from "./helpers.js";
import { transcription } from "./transcription.js";

// ---------------------------------------------------------------------------
export function appearance(ctx, root) {
  let theme = structuredClone(ctx.boot.settings.theme);
  let themes = ctx.boot.themes;
  let saveTimer = null;
  let offZoom = null;
  const headSlot = h("div");
  root.append(headSlot);

  const commit = (redraw = true) => {
    applyTheme(theme);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => ctx.saveSettings({ theme }).catch(toastError), 350);
    if (redraw) draw();
  };

  const body = h("div.stack");
  root.append(body);

  // CSS themes: made once (it listens for drops on the whole page), refreshed on every redraw
  const css = cssThemes(ctx, { getCurrent: () => theme.css || "", use: (name) => { theme.css = name; commit(); } });
  const cssCard = card({ title: "CSS themes" }, css.el);

  // Glass theme previews: the family's background, a panel and its button colour.
  const FAMILY = {
    default: { light: ["#E4E5E9", "#D3D5DB", "rgba(255,255,255,.75)", "#C3C6D2", "#2B2C33", "#4C4E5A"], dark: ["#2C2D33", "#212227", "#3C3E49", "#30344A", "#F2F2F5", "#C8C9D2"] },
    cool: { light: ["#DCE3EE", "#C9D2E2", "#B3C2F3", "#B8DEEC", "#5876F5", "#68BDEE"], dark: ["#252D3F", "#1B2231", "#36498F", "#246A80", "#7D96FF", "#7ED2F6"] },
    warm: { light: ["#ECE2DA", "#DDCDC2", "#F0BCA4", "#E8BCC9", "#DB7A5D", "#E097AE"], dark: ["#302723", "#241D1A", "#7A3E32", "#6A374F", "#F0997B", "#EFA8BF"] },
    lilac: { light: ["#EFE4E2", "#E2D5DD", "#DAC8F1", "#B8A6DD", "#6E5E9E", "#A48DD6"] },
    heart: { light: ["#F6E7F0", "#EAD6E6", "#FFB3D9", "#BDF5EE", "#FF5FB0", "#FF8AC8"], dark: ["#160B22", "#1D0E2C", "#FF5FB0", "#9B6BFF", "#FF5FB0", "#FF8AC8"] },
  };
  function themePreview(t) {
    const fam = FAMILY[t.family] || FAMILY.default;
    const [b1, b2, c1, c2, a1, a2] = (t.base === "dark" && fam.dark) || fam.light;
    const panel = t.base === "dark" && fam.dark ? "rgba(255,255,255,.08)" : "rgba(255,255,255,.55)";
    return h("div.tp", { style: { background: `radial-gradient(60% 90% at 10% 0%, ${c1}, transparent), radial-gradient(60% 90% at 100% 20%, ${c2}, transparent), linear-gradient(160deg, ${b1}, ${b2})` } },
      h("div.mini", { style: { background: panel, boxShadow: "inset 0 1px 0 rgba(255,255,255,.5)", border: "1px solid rgba(255,255,255,.45)" } },
        h("i", { style: { background: `linear-gradient(165deg, ${a1}, ${a2})` } }), h("b", { style: { background: t.base === "dark" && fam.dark ? "#fff" : "#17171A" } })));
  }

  function draw() {
    clear(headSlot, ctx.header({ title: "Appearance", subtitle: "Changes apply right away.", icon: "palette",
      actions: [btn("Save as theme", { icon: "save", onclick: async () => {
        const name = await promptBox("Save theme", "Theme name", theme.name && !themes.find((t) => !t.user && t.name === theme.name) ? theme.name : "My theme");
        if (!name) return;
        theme.name = name;
        themes = await api.save_theme(theme);
        ctx.boot.themes = themes;
        commit();
        toast("Theme saved", name, "good", "palette");
      } })] }));

    const isOn = (t) => t.name === theme.name && t.family === theme.family;
    const pick = (t) => { const base = theme.base; theme = structuredClone({ ...t, user: undefined }); delete theme.user; theme.base = base; commit(); };
    const gallery = card({ title: "Themes" }, h("div.theme-cards", themes.map((t) =>
      h("button.theme-card", { class: isOn(t) ? "on" : "", onclick: () => pick(t) },
        themePreview({ ...t, base: theme.base }),
        h("div.tn", t.name, h("div.spacer"), t.user ? h("span", { title: "Delete theme", style: { color: "var(--text-3)", display: "flex" },
          onclick: async (e) => { e.stopPropagation(); themes = await api.delete_theme(t.name); ctx.boot.themes = themes; draw(); } }, icon("trash")) : null)))));

    const colours = card({ title: "Mode" }, h("div.stack",
      seg([["light", "Light", "sun"], ["dark", "Dark", "moon"]], theme.base, (v) => { theme.base = v; commit(); }),
      theme.family === "lilac" && theme.base === "dark" ? h("p.small.faint", { style: { margin: 0 } }, "Lilac is a light theme, so dark mode uses Cool Glass dark.") : null));

    const effects = card({ title: "Glass effects" }, h("div.stack",
      seg([["efficient", "Efficient"], ["full", "Full"], ["off", "Off"]], theme.glass || "efficient", (v) => { theme.glass = v; commit(); }),
      h("p.small.muted", { style: { margin: 0 } }, ({
        efficient: "See-through panels over a still background. It looks almost the same as Full and is very light on your GPU. Recommended.",
        full: "Real live blur behind every panel. It's the prettiest, and it uses the most GPU power. If transcription feels slow, switch back to Efficient.",
        off: "Solid panels, no see-through or blur. The colours and layout stay the same.",
      })[theme.glass || "efficient"]),
));

    const text = card({ title: "Text" }, h("div.field", h("label", "Font"),
      seg([["geist", "Geist"], ["system", "System"]], theme.font === "system" ? "system" : "geist", (v) => { theme.font = v; commit(); })));

    const zoomTxt = h("span.zoom-val", zoomLabel());
    const zoom = card({ title: "Zoom" }, zoomSupported()
      ? h("div.stack",
          h("div.zoom-ctl",
            btn("", { icon: "minus", size: "sm", title: "Smaller (Ctrl -)", onclick: () => stepZoom(-1) }),
            zoomTxt,
            btn("", { icon: "plus", size: "sm", title: "Bigger (Ctrl +)", onclick: () => stepZoom(1) }),
            btn("Reset", { size: "sm", onclick: () => setZoom(1) })),
          h("p.small.muted", { style: { margin: 0 } }, "Makes everything in the window smaller or bigger. Shortcuts: Ctrl + and Ctrl − to zoom, Ctrl 0 to reset."))
      : h("p.small.muted", { style: { margin: 0 } }, "In a web browser, use the browser's own zoom: Ctrl + and Ctrl − (Ctrl 0 resets)."));
    offZoom?.();
    offZoom = onZoom((z) => { zoomTxt.textContent = zoomLabel(z); });

    css.refresh();
    clear(body, gallery, cssCard, colours, effects, text, zoom,
      h("div.notice", icon("info"), h("div", "Want to go further? ", h("span.mono", "web/css/custom.css"), " is yours to edit: change colours, corner roundness, anything. It's loaded last, so it wins over CSS themes too.")));
  }
  draw();
}

// ---------------------------------------------------------------------------
export function reading(ctx, root) {
  const s = ctx.boot.settings;
  const saveKey = (k) => (v) => ctx.saveSettings({ [k]: v }).then(() => { ctx.links = null; toast("Saved", "", "good", "check", 1500); }).catch(toastError);
  root.append(ctx.header({ title: "Reading", subtitle: "How pages and recaps are shown.", icon: "eye" }),
    h("div.stack",
      card({ title: "Automatic links" },
        switchEl(s.auto_link !== false, saveKey("auto_link"), "Link mentions of page names"),
        h("p.small.muted", { style: { margin: "8px 0 0" } },
          "The first time a page's name, an alias, or a character's first name appears in a page or recap, it becomes a link. Your files aren't changed; it's only how they're shown.")),
      card({ title: "Notifications" },
        switchEl(s.notify_on_finish !== false, saveKey("notify_on_finish"), "Desktop notification when a long job finishes"),
        h("div", { style: { height: "10px" } }),
        switchEl(s.watch_files !== false, saveKey("watch_files"), "Tell me when campaign files change outside Lore Studio"),
        h("p.small.muted", { style: { margin: "8px 0 0" } },
          "For when the Claude app, Obsidian or a text editor edits your pages, plans or recaps: a notification says what changed, with a button to refresh. Lore Studio's own saves don't count. The refresh button in the sidebar always works, with this on or off."))));
}
