// Which AI drafts recaps: Claude (Anthropic API) or a local model the GM runs (Settings → AI).
const st = () => window.ctx?.boot?.settings || {};
export const aiLocal = () => st().ai_provider === "local";
/** "Claude" or "Your local model", for the start of a sentence; aiName() for the middle of one. */
export const AI = () => (aiLocal() ? "Your local model" : "Claude");
export const aiName = () => (aiLocal() ? "your local model" : "Claude");
export const aiPossessive = () => (aiLocal() ? "Your local model's" : "Claude's");
export const aiReady = () => (aiLocal() ? !!(st().local_url || "").trim() : !!st().secrets_set?.anthropic_api_key);
export const aiSetupHint = () => (aiLocal() ? ["Add your local model's address first", "Settings → AI"] : ["Add your Anthropic API key first", "Settings → AI"]);
