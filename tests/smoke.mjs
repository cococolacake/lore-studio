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
const monster = await call("monster_new", "srd", "goblin");
const pc = (await call("party")).party[0] || await call("party_save", { character: "Jane Roe", player: "Alex" });
const enc = await call("encounter_save", { name: "Ambush", session: sessionId, groups: [{ kind: "monster", ref: monster.id, count: 3 }, { kind: "srd", ref: "wolf", count: 2 }] });
const routes = [
  ["monsters", {}], ["monsters", { id: monster.id }], ["monsters", { enc: enc.id }], ["party", {}], ["party", { id: pc.id }], ["live", { id: sessionId }],
  ["home", {}], ["sessions", {}], ["lore", { id: "index" }], ["lore", { id: "Characters/John Doe" }],
  ["lore", { id: "Characters/John Doe", edit: true }], ["lore", { q: "#character" }], ["graph", {}],
  ["live", {}], ["maps", {}], ["threads", {}], ["threads", { view: "review" }], ["threads", { view: "resolved" }],
  ["sessions", { id: sessionId, tab: "recap" }], ["sessions", { id: sessionId, tab: "transcript" }], ["sessions", { id: sessionId, tab: "notes" }], ["sessions", { id: sessionId, tab: "files" }],
  ["settings", { section: "campaign" }], ["settings", { section: "claude" }], ["settings", { section: "transcription" }],
  ["settings", { section: "obs" }], ["settings", { section: "foundry" }], ["settings", { section: "discord" }], ["settings", { section: "appearance" }], ["settings", { section: "reading" }],
  ["settings", { section: "about" }], ["chat", {}], ["calendar", {}], ["calendar", { tab: "setup" }], ["clocks", {}], ["handouts", {}], ["settings", { section: "playersite" }], ["timeline", {}], ["boards", {}], ["stats", {}], ["welcome", {}],
];
for (const [id, params] of routes) {
  await page.evaluate(([i, p]) => window.ctx.go(i, p), [id, params]);
  await page.waitForTimeout(500);
  console.log("ok", id, JSON.stringify(params));
}
// On the Party page, a card with a shorter header shows more of its backstory
const story = "They left home after a storm took the family boat and never looked back. ".repeat(6);
await call("party_save", { character: "Pip", player: "Lee", backstory: story });
await call("party_save", { character: "Mira Vance of the Long Salt Road, Warden of the Grey Marsh and the Sunken Chapel", player: "Sam", backstory: story });
await page.evaluate(() => window.ctx.go("party", {}));
await page.waitForTimeout(800);
const clamps = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".pc-card > .clamp3")].map((p) => [p.parentElement.querySelector("b").textContent, getComputedStyle(p).webkitLineClamp])));
if (!(Number(clamps.Pip) > 3)) errors.push(`The short Party card didn't fill its spare room: ${JSON.stringify(clamps)}`);
// A chosen portrait shows on the Party page, and comes off again with Remove portrait
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const pip = (await call("party")).party.find((x) => x.character === "Pip");
await call("party_set_portrait", pip.id, { data_url: png });
await page.evaluate((id) => window.ctx.go("party", { id }), pip.id);
await page.waitForTimeout(800);
if (!(await page.$('.pc-portrait-btn img[src^="/c/party/"]'))) errors.push("The chosen portrait doesn't show on the character page");
await page.getByRole("button", { name: "Remove portrait" }).click();
await page.waitForTimeout(800);
if (await page.$(".pc-portrait-btn img")) errors.push("Remove portrait didn't remove it");
// Session notes in the app take on the theme in use, CSS theme included, and follow a switch to light or dark
await call("add_css_theme", "Smoke", "html[data-notes] h1 { --smoke: 1; }");
await call("save_settings", { theme: { style: "glass", base: "dark", family: "default", css: "Smoke" } });
await call("start_plan", sessionId);
await page.goto(url);
await page.waitForTimeout(800);
await page.evaluate((id) => window.ctx.go("sessions", { id, tab: "notes" }), sessionId);
await page.waitForTimeout(1200);
const notesTheme = () => page.evaluate(() => {
  const doc = document.querySelector("iframe.plan-preview")?.contentDocument;
  return doc ? { notes: doc.documentElement.hasAttribute("data-notes"), base: doc.documentElement.dataset.base,
    css: doc.getElementById("app-css-theme")?.textContent || "",
    // custom.css comes after the theme, so it still wins inside the notes
    customLast: !!doc.querySelector('#app-css-theme ~ link[href$="custom.css"]'),
    // the notes' text colour is the theme's, in dark as well as light
    fgMatches: getComputedStyle(doc.documentElement).getPropertyValue("--fg").trim() === getComputedStyle(doc.documentElement).getPropertyValue("--text").trim() } : null;
});
let seen = await notesTheme();
if (!seen?.notes || seen.base !== "dark" || !seen.css.includes("--smoke") || !seen.fgMatches || !seen.customLast) errors.push(`The plan preview didn't take on the theme: ${JSON.stringify(seen)}`);
await page.evaluate(() => { document.documentElement.dataset.base = "light"; });
await page.waitForTimeout(300);
seen = await notesTheme();
if (seen?.base !== "light" || !seen.fgMatches) errors.push("The plan preview didn't follow the switch to light");
await call("save_settings", { theme: { style: "glass", base: "light", family: "default", css: "" } });
// Timeline: blocks on nearly the same date never draw their labels over each other or over the lane name
for (let d = 1; d <= 6; d++) await call("timeline_save_block", { title: `A block with a fairly long name ${d}`, start: { y: 1, m: 0, d } });
await page.evaluate(() => localStorage.removeItem("ls:timelineCam"));
await page.evaluate(() => window.ctx.go("timeline", {}));
await page.waitForTimeout(800);
const clashes = await page.evaluate(() => {
  const boxes = (sel) => [...document.querySelectorAll(sel)].map((el) => el.getBoundingClientRect());
  const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  const labels = boxes(".tl-block .tl-text"), names = boxes(".tl-lane-name");
  let n = 0;
  labels.forEach((a, i) => { labels.slice(i + 1).forEach((b) => { if (hit(a, b)) n++; }); names.forEach((b) => { if (hit(a, b)) n++; }); });
  return { n, labels: labels.length };
});
if (clashes.labels < 6 || clashes.n) errors.push(`Timeline labels overlap: ${JSON.stringify(clashes)}`);
// the today line sits under the blocks, so it never cuts through a label
const layers = await page.evaluate(() => [".tl-block", ".tl-now"].map((q) => Number(getComputedStyle(document.querySelector(q)).zIndex)));
if (!(layers[0] > layers[1])) errors.push(`The today line is drawn over timeline labels: ${JSON.stringify(layers)}`);
// A CSS theme's category colours reach colours the app picks itself, like the encounter difficulty bar (#73)
await call("party_save", { character: "Kai", player: "Bo", level: 1 });   // the meter needs party levels
await call("add_css_theme", "Cats", ":root { --corner-shape: bevel; --cat-1: rgb(1, 1, 1); --cat-2: rgb(2, 2, 2); --cat-3: rgb(3, 3, 3); --cat-4: rgb(4, 4, 4); } html[data-style][data-family][data-base] { --bg: rgb(5, 5, 5); --bg2: rgb(5, 5, 5); }");
await call("save_settings", { theme: { style: "glass", base: "dark", family: "default", css: "Cats" } });
await page.goto(url);
await page.waitForTimeout(800);
await page.evaluate((id) => window.ctx.go("monsters", { enc: id }), enc.id);
await page.waitForTimeout(800);
const diff = await page.evaluate(() => {
  const el = document.querySelector(".enc-fill");
  return el ? { kind: [...el.classList].find((c) => c !== "enc-fill"), bg: getComputedStyle(el).backgroundColor } : null;
});
const slot = { easy: 4, medium: 3, hard: 2, deadly: 1 }[diff?.kind];
if (!slot || diff.bg !== `rgb(${slot}, ${slot}, ${slot})`) errors.push(`The difficulty bar ignored the theme's --cat-${slot}: ${JSON.stringify(diff)}`);
// the selector the wiki gives for colours really beats the built-in ones
const pageBg = await page.evaluate(() => getComputedStyle(document.body).backgroundImage);
if (!pageBg.includes("rgb(5, 5, 5)")) errors.push(`A CSS theme's --bg didn't reach the page: ${pageBg}`);
// the graph redraws on a theme switch without errors
await page.evaluate(() => window.ctx.go("graph", {}));
await page.waitForTimeout(600);
// no control inside another one in the graph's tag list
if (!(await page.$(".legend .colour-pick")) || await page.$(".legend button input, .legend button label")) errors.push("The graph's colour picker is missing or inside the tag's button");
// hiding a tag from the keyboard keeps focus on its toggle
await page.focus(".legend-toggle"); await page.keyboard.press("Space");
if (!(await page.evaluate(() => document.activeElement?.matches(".legend-toggle")))) errors.push("Toggling a graph tag loses keyboard focus");
await page.keyboard.press("Space");
// a theme's --corner-shape reaches the app's corners, and circles stay round (#85)
const shapes = await page.evaluate(() => CSS.supports("corner-shape", "bevel") && [".input", ".legend-row .ball"].map((q) => getComputedStyle(document.querySelector(q)).getPropertyValue("corner-top-left-shape")));
if (shapes && (shapes[0] !== "superellipse(0)" || shapes[1] !== "superellipse(1)"))   // how Chrome reports bevel and round errors.push(`The theme's corner shape didn't apply, or a circle lost its shape: ${JSON.stringify(shapes)}`);
await page.evaluate(() => { document.documentElement.dataset.base = "light"; });
await page.waitForTimeout(300);
await call("save_settings", { theme: { style: "glass", base: "light", family: "default", css: "" } });
// With AI switched off, the AI pages and buttons are gone and nothing breaks
await call("save_settings", { ai_off: true });
await page.goto(url);
await page.waitForTimeout(800);
for (const [id, params] of [["sessions", { id: sessionId, tab: "recap" }], ["sessions", { id: sessionId, tab: "notes" }], ["lore", { id: "Characters/John Doe" }], ["threads", {}], ["settings", { section: "claude" }], ["chat", {}]]) {
  await page.evaluate(([i, p]) => window.ctx.go(i, p), [id, params]);
  await page.waitForTimeout(400);
  console.log("ok (AI off)", id, JSON.stringify(params));
}
if (await page.evaluate(() => window.ctx.page.id) !== "home") errors.push("The chat page still opens with AI switched off");
if (await page.$('[title="Suggest tags with AI"]')) errors.push("Tag suggestions still show with AI switched off");
await call("save_settings", { ai_off: false });
await browser.close();
if (errors.length) {
  console.error("Page errors:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("All pages opened without errors.");
