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
      h("b", "yt-dlp isn't installed."),
      h("div", { style: { marginTop: "var(--s2)" } }, btn("Install yt-dlp", { icon: "download", size: "sm", onclick: async (e) => {
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
      h("b", "ffmpeg isn't installed. "),
      info.platform === "windows"
        ? ["Open PowerShell and run ", h("code", "winget install Gyan.FFmpeg"), ", then click Check again."]
        : ["Install it with your package manager (for example ", h("code", "sudo apt install ffmpeg"), "), then click Check again."],
      h("div", { style: { marginTop: "var(--s2)" } }, btn("Check again", { icon: "refresh", size: "sm", kind: "ghost", onclick: draw })))));

    const links = h("textarea.input.mono", { rows: 4, placeholder: "https://www.youtube.com/watch?v=...\nOne per line" });
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
            (r.failed || []).length ? h("div.small", { style: { color: "var(--bad)" } }, `${r.failed.length} link${r.failed.length === 1 ? "" : "s"} failed and ${r.failed.length === 1 ? "is" : "are"} still in the box.`) : null));
        } else if (t) {
          toast("The download didn't work", t.lines?.slice(-1)[0] || "", "bad", "alert", 8000);
        }
      } catch (e) { toastError(e); }
      go.disabled = false;
    } });

    clear(box,
      missing,
      h("div.field", h("label", "YouTube links"), links),
      checkEl(playlist, (v) => { playlist = v; }, "Download whole playlists"),
      h("div.field", h("label", "Save mp3s in"), pathInput(info.folder, async (v) => {
        try { info = await api.music_set_folder(v); toast("Saved", "", "good", "check", 1500); } catch (e) { toastError(e); }
      }, { folder: true, placeholder: info.default_folder }), h("div.help", "Must be inside Foundry's Data folder.")),
      h("div.row", go, btn("Open the folder", { icon: "folder", size: "sm", kind: "ghost", onclick: () => api.music_open_folder().catch(toastError) })),
      log.el, result);
  };
  draw();
  return card({ title: "Music downloads" }, box);
}
