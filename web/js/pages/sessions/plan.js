// Sessions → Plan tab: writing the plan, suggesting scenes and carrying over unplayed ones.
import { api } from "../../api.js";
import { h, btn, card, clear, empty, toast, toastError, modal } from "../../dom.js";
import { icon } from "../../icons.js";
import { pathInput } from "../../components.js";
import { AI, aiPossessive, aiReady, aiLocal, aiOff } from "../../ai.js";
import { money } from "./helpers.js";
import { themedNotes, followTheme } from "../../notestheme.js";

async function attachHtml(ctx, s) {
  let path = ctx.boot.native ? await api.pick_file("html") : null;
  if (!ctx.boot.native) {
    const r = await modal("Attach HTML notes", h("div.field", h("label", "Path to the .html file"),
      pathInput("", (v) => { path = v; }, { kind: "html", placeholder: "C:/Users/you/Documents/Session_03_The_Drowned_Chapel.html" })),
    [{ label: "Cancel", kind: "ghost", value: false }, { label: "Attach", kind: "primary", value: true }]);
    if (!r) return;
  }
  if (!path) return;
  try {
    await api.attach_session_html(s.id, path);
    toast("Notes attached", "Copied into the session folder.", "good", "check");
    ctx.go("sessions", { id: s.id, tab: "notes" });
  } catch (e) { toastError(e); }
}

const BLOCKS = [
  ["Scene", "scroll", "\n## New Scene\n"],
  ["Read aloud", "feather", "\n:::read\nDescribe what they see.\nSomeone: \"A line of dialogue.\"\n:::\n"],
  ["Divine voice", "sparkle", "\n:::divine\nSomeone: \"Words in gold.\"\n:::\n"],
  ["NPC lines", "list", "\n- **When asked about…**\n  > Something they might say.\n  > Another option.\n"],
  ["Note / secret", "lock", "\n:::note\n**Secret.** Something the players don't know yet.\n:::\n"],
  ["Character card", "heart", "\n:::pc Name\n~ Theme: what this scene asks of them\n- A beat for this character.\n:::\n"],
  ["Menu item", "box", "\n:::act Place or activity | one-line description\n:::read\nWhat they find.\n:::\n- What can happen here.\n:::\n"],
  ["Check", "check", "\n~ Wisdom (Perception) check, DC 13.\n"],
  ["Table", "columns", "\n| Item | Price | Notes |\n|---|---|---|\n| Something | 50 gp | |\n"],
];

export async function planTab(ctx, body, s) {
  let plan = await api.plan(s.id);
  if (!plan.exists) {
    if (s.html_url) {
      const frame = h("iframe.notes-frame", { src: s.html_url + "?t=" + Date.now(), title: "Session notes", sandbox: "allow-scripts allow-popups allow-popups-to-escape-sandbox" });
      clear(body, h("div.row", { style: { marginBottom: "var(--s3)" } },
        h("span.muted.small.grow", "Your HTML notes, exactly as they print."),
        btn("Edit as a plan", { icon: "edit", size: "sm", kind: "primary", onclick: async () => {
          try { await api.start_plan(s.id); toast("Converted to a plan", "The original file is kept as plan.original.html.", "good", "check"); ctx.go("sessions", { id: s.id, tab: "notes" }); } catch (e) { toastError(e); }
        } }),
        btn("Open in browser", { icon: "external", size: "sm", kind: "ghost", onclick: () => window.open(s.html_url, "_blank") }),
        btn("Replace", { icon: "upload", size: "sm", onclick: () => attachHtml(ctx, s) })), frame);
      return;
    }
    clear(body, card({ title: "Plan" }, empty("scroll", "No plan yet",
      "",
      h("div.row", { style: { justifyContent: "center" } },
        btn("Start a plan", { icon: "plus", kind: "primary", onclick: async () => { await api.start_plan(s.id).catch(toastError); ctx.go("sessions", { id: s.id, tab: "notes" }); } }),
        btn("Attach HTML notes", { icon: "upload", onclick: () => attachHtml(ctx, s) })))));
    return;
  }

  const ta = h("textarea.input.editor.plan-editor", { value: plan.text, spellcheck: true });
  const frame = h("iframe.plan-preview", { sandbox: "allow-same-origin", title: "Preview" });
  followTheme(frame);
  let dirty = false, timer = null;
  const refresh = async () => {
    try {
      const y = frame.contentWindow?.scrollY || 0;
      frame.srcdoc = themedNotes(await api.preview_plan(s.id, ta.value));
      frame.onload = () => { try { frame.contentWindow.scrollTo(0, y); } catch { /* ignore */ } };
    } catch (e) { toastError(e); }
  };
  ta.addEventListener("input", () => { dirty = true; saveBtn.disabled = false; clearTimeout(timer); timer = setTimeout(refresh, 400); });
  const insert = (text) => {
    const at = ta.selectionStart;
    ta.value = ta.value.slice(0, at) + text + ta.value.slice(ta.selectionEnd);
    ta.selectionStart = ta.selectionEnd = at + text.length;
    ta.focus();
    ta.dispatchEvent(new Event("input"));
  };
  const save = async () => {
    try { plan = await api.save_plan(s.id, ta.value); dirty = false; saveBtn.disabled = true; toast("Plan saved", "The HTML notes were updated too.", "good", "check", 1800); drawNudges(); } catch (e) { toastError(e); }
  };

  // open loose threads that involve someone or something in this plan, so nothing dangling is forgotten
  const nudgeBox = h("div");
  const drawNudges = async () => {
    const list = await api.thread_nudges(s.id, ta.value).catch(() => []);
    clear(nudgeBox, list.length ? h("details.plan-nudges", { open: list.length <= 3 },
      h("summary", icon("link"), ` ${list.length} open thread${list.length === 1 ? "" : "s"} involve${list.length === 1 ? "s" : ""} people or places in this plan`),
      h("div.stack.sm", list.map((t) => h("div.nudge",
        h("span.chip.sm", t.kind || "thread"),
        h("div.grow", h("b", t.title), t.detail ? h("span.small.faint", " · " + t.detail) : null, h("div.tiny.faint", "Shares: " + t.shared.join(", "))),
        btn("Add to plan", { icon: "plus", size: "sm", kind: "ghost", title: "Insert a GM note about this thread at the cursor",
          onclick: () => insert(`\n:::note\n**Loose thread: ${t.title}.** ${t.detail}\n:::\n`) }))))) : null);
  };
  ta.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); }
    if (e.key === "Tab") { e.preventDefault(); insert("  "); }
  });
  ctx.onLeave(() => { if (dirty && !ctx._discard) api.save_plan(s.id, ta.value).catch(() => {}); });
  ctx.guard(() => dirty);
  const saveBtn = btn("Save", { icon: "save", kind: "primary", size: "sm", disabled: true, onclick: save });

  const toolbar = h("div.plan-tools",
    BLOCKS.map(([label, ic, text]) => btn(label, { icon: ic, size: "sm", kind: "ghost", onclick: () => insert(text) })),
    h("div.spacer"),
    btn("Previously on", { icon: "history", size: "sm", kind: "ghost", title: "Insert the last recap as a read-aloud", onclick: async () => {
      const prev = await api.previously(s.id).catch(() => "");
      if (!prev) return toast("No earlier recap to use", "", "warn", "info");
      insert(`\n## Previously {tag="Recap"}\n:::read Read aloud · Previously\n${prev}\n:::\n`);
    } }),
    aiOff() ? null : btn("Suggest a scene", { icon: "feather", size: "sm", onclick: () => suggestScene(ctx, s, insert) }));

  const help = h("details.plan-help", h("summary", "How plans are written"), h("div.small.muted",
    h("p", h("b", "## Title"), " starts a scene (numbered automatically from ", h("code", "first_scene"), "). Add ", h("code", '{.branch tag="Branch"}'), " for a coloured tag, ", h("code", "{glance}"), " for the at-a-glance section."),
    h("p", h("code", ":::read"), ", ", h("code", ":::divine"), ", ", h("code", ":::note"), ", ", h("code", ":::pc Name"), ", ", h("code", ":::act Name | description"), ", ", h("code", ":::cast"), " … ", h("code", ":::"), " make the boxes. Inside read-aloud, ", h("code", 'Name: "words"'), " is dialogue and ", h("code", "~ text"), " is a check line."),
    h("p", "Everything else is GM notes in Markdown. Under a bullet, indented ", h("code", "> lines"), " are quoted options (", h("code", ">>"), " for gold). In the at-a-glance list, ", h("code", "- branch: Text | 10 min"), " adds the time.")));

  clear(body,
    h("div.row.plan-bar",
      h("span.small.faint.grow", plan.scenes.length ? `${plan.scenes.length} sections · saves to plan.md and plan.html` : "plan.md"),
      btn("Carry over…", { icon: "right", size: "sm", kind: "ghost", title: "Start the next session from scenes you didn't reach", onclick: () => carryOver(ctx, s, plan) }),
      btn("Open notes", { icon: "external", size: "sm", kind: "ghost", onclick: async () => { if (dirty) await save(); window.open(`/c/sessions/${s.id}/plan.html?t=${Date.now()}`, "_blank"); } }),
      saveBtn),
    toolbar, nudgeBox, help,
    h("div.plan-split", ta, frame));
  refresh();
  drawNudges();
}

async function suggestScene(ctx, s, insert) {
  if (!aiReady()) return toast(...aiSetupHint(), "warn", "key");
  const idea = h("textarea.input", { rows: 3, placeholder: "What should happen? (optional)" });
  const ok = await modal("Suggest a scene", h("div.stack.sm", idea,
    h("p.tiny.faint", { style: { margin: 0 } }, `${AI()} reads this plan, your open loose threads, the last recap and matching lore pages, and writes one scene in plan format.${aiLocal() ? "" : " Usually a few cents."}`)),
  [{ label: "Cancel", kind: "ghost", value: false }, { label: "Suggest", kind: "primary", icon: "feather", value: true }]);
  if (!ok) return;
  toast(`${AI()} is writing a scene…`, "", "", "feather", 4000);
  try {
    const r = await api.suggest_scene(s.id, idea.value);
    const view = h("textarea.input.editor.short", { value: r.text });
    const use = await modal(`${aiPossessive()} scene`, h("div.stack.sm", view, h("p.tiny.faint", { style: { margin: 0 } }, `${r.model.replace(/^local:/, "")}${r.cost ? ` · about ${money(r.cost)}` : ""}. Edit it here or after inserting.`)),
      [{ label: "Discard", kind: "ghost", value: false }, { label: "Insert at cursor", kind: "primary", value: true }], { wide: true });
    if (use) insert("\n" + view.value.trim() + "\n");
  } catch (e) { toastError(e); }
}

async function carryOver(ctx, s, plan) {
  const picks = new Set();
  const rows = plan.scenes.map((sc) => h("label.check", h("input", { type: "checkbox", onchange: (e) => { e.target.checked ? picks.add(sc.id) : picks.delete(sc.id); } }), `${sc.tag ? sc.tag + " · " : ""}${sc.title}`));
  const title = h("input.input", { placeholder: "Title of the next session" });
  const ok = await modal("Carry scenes over to the next session", h("div.stack",
    h("p.small.muted", { style: { margin: 0 } }, "Pick the scenes the party didn't reach."),
    h("div.stack.sm", rows), h("div.field", h("label", "Next session's title"), title)),
  [{ label: "Cancel", kind: "ghost", value: false }, { label: "Create next session", kind: "primary", value: true }]);
  if (!ok || !picks.size) return;
  try { const id = await api.carry_over(s.id, [...picks], title.value.trim()); ctx.go("sessions", { id, tab: "notes" }); } catch (e) { toastError(e); }
}
