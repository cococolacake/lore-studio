// Settings → AI: Claude, a local model, or AI off.
import { api } from "../../api.js";
import { h, btn, card, toast, toastError, clear } from "../../dom.js";
import { seg, switchEl } from "../../components.js";
import { saveKey, secretInput } from "./helpers.js";

// ---------------------------------------------------------------------------
export async function claude(ctx, root) {
  const s = ctx.boot.settings;
  const offCard = card({ title: "AI features" }, h("div.stack.sm",
    switchEl(!s.ai_off, async (on) => { await ctx.saveSettings({ ai_off: !on }); ctx.go("settings", { section: "claude" }); }, "Show AI features")));
  if (s.ai_off) {
    root.append(ctx.header({ title: "AI", icon: "feather" }), h("div.stack", offCard));
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

  const providerCard = card({ title: "Provider" }, h("div.stack.sm",
    seg([["claude", "Claude (Anthropic API)"], ["local", "A local model"]], local ? "local" : "claude",
      async (v) => { await ctx.saveSettings({ ai_provider: v }); redraw(); }),
    local ? h("p.small.muted", { style: { margin: 0 } }, "Works with any OpenAI-compatible server: Ollama, LM Studio, llama.cpp, KoboldCpp, vLLM and others.") : null));

  let claudeCards = [];
  if (!local) {
    claudeCards = [
      card({ title: "API key" }, h("div.stack.sm",
        secretInput(ctx, "anthropic_api_key", "sk-ant-…"),
        h("p.small.muted", { style: { margin: 0 } }, "Get one at console.anthropic.com. Stored on this PC only."),
        h("div", testBtn("Test the connection")))),
      card({ title: "Model" }, h("div.field", h("select.select", { onchange: (e) => saveKey(ctx, "recap_model")(e.target.value) },
        models.map(([id, label]) => h("option", { value: id, selected: id === s.recap_model }, label)),
        known ? null : h("option", { value: s.recap_model, selected: true }, s.recap_model)))),
    ];
  }

  let localCards = [];
  if (local) {
    const url = h("input.input.mono", { value: s.local_url || "", placeholder: "http://localhost:11434/v1", onchange: (e) => saveKey(ctx, "local_url")(e.target.value.trim()) });
    const OTHER = "\u0000other";
    const saveModel = (v) => saveKey(ctx, "local_model")(v);
    const modelIn = h("input.input.mono", { value: s.local_model || "", placeholder: "Model name, e.g. gemma4:12b",
      onchange: (e) => saveModel(e.target.value.trim()) });
    const modelSel = h("select.select.mono", { hidden: true, onchange: async (e) => {
      if (e.target.value === OTHER) { modelIn.hidden = false; modelIn.focus(); return; }
      modelIn.hidden = true; modelIn.value = e.target.value; await saveModel(e.target.value);
    } });
    const found = h("div.small.muted");
    /** A dropdown of the server's models when it lists any; a text box when it doesn't, or for "Type a name". */
    const showModels = (ms) => {
      const cur = modelIn.value.trim();
      clear(modelSel);
      if (!ms.length) { modelSel.hidden = true; modelIn.hidden = false; return; }
      const onServer = !cur || ms.includes(cur);
      modelSel.append(
        cur ? null : h("option", { value: "", selected: true, disabled: true }, "Pick a model"),
        ...ms.map((m) => h("option", { value: m, selected: m === cur }, m)),
        onServer ? null : h("option", { value: cur, selected: true }, `${cur} (not on this server)`),
        h("option", { value: OTHER }, "Type a name…"));
      modelSel.hidden = false; modelIn.hidden = true;
    };
    const findModels = async (quiet) => {
      try {
        const ms = await api.local_models(url.value.trim());
        if (!modelIn.value.trim() && ms.length === 1) { modelIn.value = ms[0]; await saveModel(ms[0]); }
        showModels(ms);
        found.textContent = ms.length ? `Found ${ms.length} model${ms.length === 1 ? "" : "s"} on the server.` : "The server is running but lists no models. Load one in your server first.";
      } catch (err) { showModels([]); found.textContent = ""; if (!quiet) toastError(err); }
    };
    findModels(true);
    localCards = [
      card({ title: "Server" }, h("div.stack.sm",
        h("div.row.wrap", { style: { gap: "var(--s2)" } }, presets.map(([name, u]) => h("button.tag.click", { onclick: async () => { url.value = u; await saveKey(ctx, "local_url")(u); findModels(); } }, name))),
        h("div.field", h("label", "Address"), url),
        h("div.grid.c2",
          h("div.field", h("label", "Model"), h("div.input-wrap", modelSel, modelIn, btn("", { icon: "refresh", title: "Find models on the server", onclick: () => findModels() }))),
          h("div.field", h("label", "API key (optional)"), secretInput(ctx, "local_api_key", ""))),
        found,
        h("div", testBtn("Test the model")))),
      card({ title: "Context size" }, h("div.stack.sm",
        h("div.field",
          h("select.select", { onchange: (e) => saveKey(ctx, "local_context")(Number(e.target.value)) },
            [8192, 16384, 32768, 65536, 131072].map((n) => h("option", { value: n, selected: Number(s.local_context) === n }, `${n / 1024}k tokens`)),
            [8192, 16384, 32768, 65536, 131072].includes(Number(s.local_context)) ? null : h("option", { value: s.local_context, selected: true }, `${s.local_context} tokens`))),
        h("p.small.muted", { style: { margin: 0 } }, "For servers other than Ollama, match the server's own setting."))),
    ];
  }

  root.append(ctx.header({ title: "AI", icon: "feather" }),
    h("div.stack",
      offCard, providerCard, ...claudeCards, ...localCards,
      card({ title: "Drafting" }, h("div.stack",
        switchEl(!!s.auto_recap, saveKey(ctx, "auto_recap"), "Draft a recap after each transcript"))),
      ctx.boot.campaign ? card({ title: `Style notes for ${ctx.boot.campaign.name}` }, h("div.stack.sm", style,
        h("div", btn("Save notes", { icon: "save", size: "sm", onclick: async () => {
          try { ctx.boot.campaign = await api.save_campaign_info({ recap_style: style.value }); toast("Saved", "", "good", "check", 1500); } catch (e) { toastError(e); }
        } })))) : null));
}
