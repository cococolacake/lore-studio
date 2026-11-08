// Browser smoke test: open every page of a small campaign and fail on any page error.
// Used by .github/workflows/checks.yml:  SMOKE_URL=http://127.0.0.1:8765 SMOKE_CAMPAIGN=/tmp/camp node tests/smoke.mjs
import { chromium } from "playwright";

const url = process.env.SMOKE_URL || "http://127.0.0.1:8765";
const campaignPath = process.env.SMOKE_CAMPAIGN || "/tmp/smoke_campaign";
const call = async (method, ...args) => {
  const r = await fetch(`${url}/api/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ args }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error}`);
  return j.result;
};

await call("create_campaign", campaignPath, "Smoke Test");
await call("new_page", null, "Characters");
await call("new_page", "Characters", "John Doe");
const sessionId = await call("new_session", "The Better Job", 0);
await call("foundry_send_page", "Characters/John Doe", true);
await call("add_thread", "Who sent the letter?", "Unsigned, smells of brine.", "question");

const browser = await chromium.launch(process.env.SMOKE_CHANNEL ? { channel: process.env.SMOKE_CHANNEL } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(url);
await page.waitForTimeout(800);
const routes = [
  ["home", {}], ["sessions", {}], ["lore", { id: "index" }], ["lore", { id: "Characters/John Doe" }],
  ["lore", { id: "Characters/John Doe", edit: true }], ["lore", { q: "#character" }], ["graph", {}],
  ["live", {}], ["maps", {}], ["threads", {}], ["threads", { view: "review" }], ["threads", { view: "resolved" }],
  ["sessions", { id: sessionId, tab: "recap" }], ["sessions", { id: sessionId, tab: "transcript" }], ["sessions", { id: sessionId, tab: "notes" }], ["sessions", { id: sessionId, tab: "files" }],
  ["settings", { section: "campaign" }], ["settings", { section: "claude" }], ["settings", { section: "transcription" }],
  ["settings", { section: "obs" }], ["settings", { section: "foundry" }], ["settings", { section: "discord" }], ["settings", { section: "appearance" }], ["settings", { section: "reading" }],
  ["settings", { section: "about" }], ["chat", {}], ["calendar", {}], ["calendar", { tab: "setup" }], ["clocks", {}], ["welcome", {}],
];
for (const [id, params] of routes) {
  await page.evaluate(([i, p]) => window.ctx.go(i, p), [id, params]);
  await page.waitForTimeout(500);
  console.log("ok", id, JSON.stringify(params));
}
await browser.close();
if (errors.length) {
  console.error("Page errors:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("All pages opened without errors.");
