// Settings → AI: Claude, a local model, or AI off.
import { api } from "../../api.js";
import { h, btn, card, toast, toastError, clear } from "../../dom.js";
import { icon } from "../../icons.js";
import { seg, switchEl } from "../../components.js";
import { campaign } from "./campaign.js";
import { about } from "./about.js";
import { saveKey, secretInput } from "./helpers.js";

// ---------------------------------------------------------------------------
export async function claude(ctx, root) {
  const s = ctx.boot.settings;
  const offCard = card({ title: "AI features" }, h("div.stack.sm",
    switchEl(!s.ai_off, async (on) => { await ctx.saveSettings({ ai_off: !on }); ctx.go("settings", { section: "claude" }); }, "Show AI features"),
    h("p.small.muted", { style: { margin: 0 } }, s.ai_off
      ? "AI is hidden: no chat page, no drafting, scene ideas, tag suggestions or thread checks. Recaps, transcripts and everything else work as normal, and nothing is ever sent to an AI."
      : "Turn this off to hide chat, recap drafting, scene ideas, tag suggestions and thread checks everywhere in Lore Studio.")));
  if (s.ai_off) {
    root.append(ctx.header({ title: "AI", subtitle: "Switched off.", icon: "feather" }), h("div.stack", offCard));
    return;
  }
  const models = await api.claude_models();
  const presets = await api.local_presets();
  const known = models.some(([id]) => id === s.recap_model);
  const local = s.ai_provider === "local";
  const style = h("textarea.input", { value: ctx.boot.campaign?.info?.recap_style || "", placeholder: "e.g. Keep player recaps under 600 words. Open with an italic one-line teaser. Call the party “the Lanterns”." });
  const redraw = () => ctx.go("settings", { section: "claude" });
  const testBtn = (label) => btn(label, { icon: "zap", size: "sm", onclick: async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { const r = await api.claude_test(); toast(local ? "Your local model answered" : "Claude is connected", `${r.model}: “${r.reply}”`, "good", "check", 8000); } catch (err) { toastError(err); }
    b.disabled = false;
  } });

  const providerCard = card({ title: "Who writes the drafts" }, h("div.stack.sm",
    seg([["claude", "Claude (Anthropic API)"], ["local", "A local model"]], local ? "local" : "claude",
      async (v) => { await ctx.saveSettings({ ai_provider: v }); redraw(); }),
    h("p.small.muted", { style: { margin: 0 } }, local
      ? "Use a model running on your own computer (or your network) through any OpenAI-compatible server: Ollama, LM Studio, llama.cpp, KoboldCpp, vLLM, text-generation-webui and others. Free and private; quality and speed depend on the model and your hardware."
      : "Claude writes the best recaps. You pay Anthropic directly for what you use, usually a few cents to a quarter per session.")));

  let claudeCards = [];
  if (!local) {
    claudeCards = [
      card({ title: "API key" }, h("div.stack.sm",
        secretInput(ctx, "anthropic_api_key", "sk-ant-…"),
        h("p.small.muted", { style: { margin: 0 } }, "Create a key at console.anthropic.com. It's stored only on this PC, in Lore Studio's settings, never in your campaign folder."),
        h("div", testBtn("Test the connection")))),
      card({ title: "Model" }, h("div.field", h("select.select", { onchange: (e) => saveKey(ctx, "recap_model")(e.target.value) },
        models.map(([id, label]) => h("option", { value: id, selected: id === s.recap_model }, label)),
        known ? null : h("option", { value: s.recap_model, selected: true }, s.recap_model)))),
    ];
  }

  let localCards = [];
  if (local) {
    const url = h("input.input.mono", { value: s.local_url || "", placeholder: "http://localhost:11434/v1", onchange: (e) => saveKey(ctx, "local_url")(e.target.value.trim()) });
    const modelIn = h("input.input.mono", { value: s.local_model || "", placeholder: "e.g. qwen3:14b", list: "local-models",
      onchange: (e) => saveKey(ctx, "local_model")(e.target.value.trim()) });
    const list = h("datalist#local-models");
    const found = h("div.small.muted");
    const findModels = async (quiet) => {
      try {
        const ms = await api.local_models(url.value.trim());
        clear(list); list.append(...ms.map((m) => h("option", { value: m })));
        found.textContent = ms.length ? `Found ${ms.length} model${ms.length === 1 ? "" : "s"}: ${ms.slice(0, 8).join(", ")}${ms.length > 8 ? "…" : ""}. Click the box to pick one.` : "The server is running but lists no models. Load one in your server first.";
        if (!modelIn.value && ms.length === 1) { modelIn.value = ms[0]; await saveKey(ctx, "local_model")(ms[0]); }
      } catch (err) { found.textContent = ""; if (!quiet) toastError(err); }
    };
    findModels(true);
    localCards = [
      card({ title: "Server" }, h("div.stack.sm",
        h("div.row.wrap", { style: { gap: "6px" } }, presets.map(([name, u]) => h("button.tag.click", { onclick: async () => { url.value = u; await saveKey(ctx, "local_url")(u); findModels(); } }, name))),
        h("div.field", h("label", "Address (OpenAI-compatible, usually ends in /v1)"), url),
        h("div.grid.c2",
          h("div.field", h("label", "Model"), h("div.input-wrap", modelIn, btn("", { icon: "refresh", title: "Find models on the server", onclick: () => findModels() })), list),
          h("div.field", h("label", "API key (only if your server needs one)"), secretInput(ctx, "local_api_key", "optional"))),
        found,
        h("div", testBtn("Test the model")))),
      card({ title: "Context size" }, h("div.stack.sm",
        h("div.field", h("label", "How many tokens the model can read at once"),
          h("select.select", { onchange: (e) => saveKey(ctx, "local_context")(Number(e.target.value)) },
            [8192, 16384, 32768, 65536, 131072].map((n) => h("option", { value: n, selected: Number(s.local_context) === n }, `${n / 1024}k tokens`)),
            [8192, 16384, 32768, 65536, 131072].includes(Number(s.local_context)) ? null : h("option", { value: s.local_context, selected: true }, `${s.local_context} tokens`))),
        h("p.small.muted", { style: { margin: 0 } }, "Match what your server is set to, not just what the model supports (Ollama's default is small: set num_ctx, or OLLAMA_CONTEXT_LENGTH). When a session's transcript is too long, Lore Studio condenses it into notes part by part first, so smaller contexts still work, just more slowly."))),
      card({ title: "Picking a model" }, h("ul.small.muted", { style: { margin: 0, paddingLeft: "18px" } },
        h("li", "Recaps are long writing from long input: an instruction-tuned model of about 12B parameters or more with at least a 32k context does well."),
        h("li", "Loose threads use function calling. Models without it still work: Lore Studio asks for plain JSON instead."),
        h("li", "Reasoning models are fine; their thinking is removed from the draft."))),
    ];
  }

  root.append(ctx.header({ title: "AI", subtitle: "Recaps, player recaps, loose threads and scene ideas, drafted from your transcripts.", icon: "feather" }),
    h("div.stack",
      offCard, providerCard, ...claudeCards, ...localCards,
      card({ title: "Drafting" }, h("div.stack",
        switchEl(!!s.auto_recap, saveKey(ctx, "auto_recap"), "Draft the recap automatically when a transcript is ready"),
        h("p.small.faint", { style: { margin: 0 } }, "Drafts never replace your recap until you accept them."))),
      ctx.boot.campaign ? card({ title: `Style notes for ${ctx.boot.campaign.name}` }, h("div.stack.sm", style,
        h("div", btn("Save notes", { icon: "save", size: "sm", onclick: async () => {
          try { ctx.boot.campaign = await api.save_campaign_info({ recap_style: style.value }); toast("Saved", "", "good", "check", 1500); } catch (e) { toastError(e); }
        } })))) : null));
}
