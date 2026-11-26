// Settings → Foundry → Music: download YouTube links as mp3s into a folder Foundry can play from.
import { api } from "../../api.js";
import { h, btn, card, toast, toastError, clear } from "../../dom.js";
import { icon } from "../../icons.js";
import { checkEl, pathInput, logView } from "../../components.js";

/** Poll a task into a log, showing its progress line. Resolves with the final snapshot. */
async function follow(tid, log) {
  let since = 0;
  for (;;) {
    const t = await api.task(tid, since);
    if (!t) return null;
    log.append(t.lines);
    since = t.total;
    log.progress(t.status === "running" ? t.progress?.msg || "" : "");
    if (t.status !== "running") return t;
    await new Promise((r) => setTimeout(r, 600));
  }
}

export function musicCard(ctx) {
  const box = h("div.stack.sm");
  const draw = async () => {
    let info;
    try { info = await api.music_info(); } catch (e) { return clear(box, h("p.small.muted", String(e.message || e))); }
    const log = logView(160);
    log.el.classList.add("hidden");
    const result = h("div");
    let playlist = false;

    // what's missing, and how to get it
    const missing = [];
    if (!info.ytdlp) missing.push(h("div.notice.warn.small", icon("alert"), h("div.grow",
      h("b", "yt-dlp isn't installed. "), "It does the downloading. Lore Studio can install it for you.",
      h("div", { style: { marginTop: "6px" } }, btn("Install yt-dlp", { icon: "download", size: "sm", onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true;
        log.el.classList.remove("hidden"); log.clear();
        try {
          const t = await follow(await api.music_install_ytdlp(), log);
          if (t?.status === "done") { toast("yt-dlp installed", "", "good", "check", 3000); return draw(); }
          toast("Installing yt-dlp didn't work", "See the log.", "bad", "alert");
        } catch (err) { toastError(err); }
        b.disabled = false;
      } })))));
    if (!info.ffmpeg) missing.push(h("div.notice.warn.small", icon("alert"), h("div.grow",
      h("b", "ffmpeg isn't installed. "), "yt-dlp needs it to make mp3s. ",
      info.platform === "windows"
        ? ["Open PowerShell and run ", h("code", "winget install Gyan.FFmpeg"), ", then click Check again."]
        : ["Install it with your package manager (for example ", h("code", "sudo apt install ffmpeg"), "), then click Check again."],
      h("div", { style: { marginTop: "6px" } }, btn("Check again", { icon: "refresh", size: "sm", kind: "ghost", onclick: draw })))));

    const links = h("textarea.input.mono", { rows: 4, placeholder: "https://www.youtube.com/watch?v=...\nOne link per line. Paste as many as you like." });
    const go = btn("Download", { icon: "download", kind: "primary", disabled: !info.ytdlp || !info.ffmpeg, onclick: async () => {
      if (!links.value.trim()) return toast("Paste a link first", "", "warn", "alert");
      go.disabled = true;
      log.el.classList.remove("hidden"); log.clear(); result.replaceChildren();
      try {
        const t = await follow(await api.music_download(links.value, playlist), log);
        if (t?.status === "done") {
          const r = t.result || {};
          const n = (r.files || []).length;
          toast(n ? `Downloaded ${n} song${n === 1 ? "" : "s"}` : "Nothing new to download", r.folder || "", "good", "check", 5000);
          if (!(r.failed || []).length) links.value = "";
          else links.value = r.failed.join("\n");   // leave the ones that didn't work, to fix and try again
          result.replaceChildren(h("div.stack.sm",
            n ? h("div.small", h("b", "Saved: "), r.files.join(", ")) : null,
            (r.failed || []).length ? h("div.small", { style: { color: "var(--bad)" } }, `${r.failed.length} link${r.failed.length === 1 ? "" : "s"} didn't work. They're left in the box: check them and try again.`) : null));
        } else if (t) {
          toast("The download didn't work", t.lines?.slice(-1)[0] || "Check the link and try again.", "bad", "alert", 8000);
        }
      } catch (e) { toastError(e); }
      go.disabled = false;
    } });

    clear(box,
      h("p.small.muted", { style: { margin: 0 } }, "Paste YouTube links and Lore Studio saves them as mp3s in your music folder. Then add them to a playlist in Foundry. Only download music you're allowed to use."),
      missing,
      h("div.field", h("label", "Links"), links),
      checkEl(playlist, (v) => { playlist = v; }, "If a link is a playlist, download every song in it (into a folder named after the playlist)"),
      h("div.field", h("label", "Save mp3s in"), pathInput(info.folder, async (v) => {
        try { info = await api.music_set_folder(v); toast("Saved", "", "good", "check", 1500); } catch (e) { toastError(e); }
      }, { folder: true, placeholder: info.default_folder }), h("div.help", "Pick a folder inside Foundry's Data folder so Foundry can play the files. Leave it empty for the default.")),
      h("div.row", go, btn("Open the folder", { icon: "folder", size: "sm", kind: "ghost", onclick: () => api.music_open_folder().catch(toastError) })),
      log.el, result);
  };
  draw();
  return card({ title: "Music" }, box);
}
