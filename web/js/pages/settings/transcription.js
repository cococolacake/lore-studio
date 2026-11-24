// Settings → Transcription: the faster-whisper environment, speaker detection and spellings.
import { api } from "../../api.js";
import { h, btn, card, toast, toastError } from "../../dom.js";
import { icon } from "../../icons.js";
import { seg, switchEl, logView, followTask } from "../../components.js";
import { saveKey, secretInput } from "./helpers.js";

// ---------------------------------------------------------------------------
export async function transcription(ctx, root) {
  const s = ctx.boot.settings;
  const st = await api.transcription_status();
  const log = logView(200);
  log.el.classList.add("hidden");
  const install = async (diar) => {
    log.el.classList.remove("hidden");
    log.clear();
    try {
      const tid = await api.install_transcription(diar);
      followTask(tid, log, (t) => {
        if (t.status === "done") { toast("Transcription is ready", "", "good", "check"); ctx.go("settings", { section: "transcription" }); }
        else toast("Install didn't finish", "See the log.", "bad", "alert");
      });
    } catch (e) { toastError(e); }
  };
  root.append(ctx.header({ title: "Transcription", subtitle: "Runs on your PC with faster-whisper. Nothing is uploaded.", icon: "file" }),
    h("div.stack",
      card({ title: "Engine" }, h("div.stack.sm",
        h("div.row",
          st.installed ? h("span.chip.good", icon("circleCheck"), "Installed") : h("span.chip.warn", icon("alert"), "Not installed"),
          st.gpu ? h("span.chip", "NVIDIA GPU found") : h("span.chip", "No NVIDIA GPU: CPU only, much slower"),
          st.diarization ? h("span.chip.good", "Speaker detection installed") : null),
        h("p.small.muted", { style: { margin: 0 } }, "Installs into its own environment (", h("span.mono", st.path), "), so the app itself stays small. About 1 to 2 GB with the GPU libraries; the Whisper model downloads on first use."),
        h("div.row",
          btn(st.installed ? "Update" : "Install transcription", { icon: "download", kind: st.installed ? "" : "primary", onclick: () => install(false) }),
          st.installed && !st.diarization ? btn("Add speaker detection", { icon: "plus", onclick: () => install(true) }) : null),
        log.el)),
      card({ title: "Options" }, h("div.grid.c2",
        h("div.field", h("label", "Whisper model"), h("select.select", { onchange: (e) => saveKey(ctx, "whisper_model")(e.target.value) },
          [["large-v3-turbo", "large-v3-turbo (fast, accurate: recommended)"], ["large-v3", "large-v3 (slowest, most accurate)"], ["medium", "medium"], ["small", "small (for CPUs)"]]
            .map(([v, l]) => h("option", { value: v, selected: v === s.whisper_model }, l)))),
        h("div.field", h("label", "Run on"), seg([["auto", "Auto"], ["cuda", "GPU"], ["cpu", "CPU"]], s.whisper_device || "auto", saveKey(ctx, "whisper_device"))),
        h("div.field", h("label", "Batch size"), h("input.input.nums", { type: "number", min: 1, max: 64, value: s.whisper_batch, onchange: (e) => saveKey(ctx, "whisper_batch")(Number(e.target.value) || 16) }),
          h("div.help", "16 fits comfortably in 16 GB of VRAM. Lower it if you run out of memory.")),
        h("div.field", h("label", "Language"), h("input.input", { value: s.whisper_language, placeholder: "en (blank = detect)", onchange: (e) => saveKey(ctx, "whisper_language")(e.target.value.trim()) })),
        h("div.span2", switchEl(s.auto_transcribe !== false, saveKey(ctx, "auto_transcribe"), "Start transcribing as soon as OBS stops recording")))),
      card({ title: "Speaker detection (optional)" }, h("div.stack.sm",
        h("p.small.muted", { style: { margin: 0 } }, "Tells the players apart on the Discord track, using pyannote's community-1 model. It needs a free Hugging Face token, and you must accept the model's terms once at huggingface.co/pyannote/speaker-diarization-community-1."),
        h("div.field", h("label", "Hugging Face token"), secretInput(ctx, "hf_token", "hf_…")),
        switchEl(s.diarize_players !== false, saveKey(ctx, "diarize_players"), "Tell voices apart on the players' track by default")))));
}
