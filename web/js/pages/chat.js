// Chat: talk with the AI (Claude or a local model) about the campaign. Every reply sees the landing page, party,
// latest recaps, open threads and the lore pages the conversation mentions.
import { api } from "../api.js";
import { h, btn, clear, empty, toast, toastError, promptBox, confirmBox } from "../dom.js";
import { icon } from "../icons.js";
import { switchEl } from "../components.js";
import { render } from "../markdown.js";
import { AI, aiLocal, aiReady, aiSetupHint } from "../ai.js";

const IDEAS = [
  "What happened last session, in a few lines?",
  "Which loose threads could pay off next session?",
  "Give me five names for a dockside tavern, with a one-line hook each.",
  "Write a short read-aloud description of a place the party is about to visit.",
  "Improvise an NPC the party could meet on the road, with a secret.",
];
const money = (usd) => (usd < 0.01 ? "under 1¢" : usd < 1 ? `${Math.round(usd * 100)}¢` : `$${usd.toFixed(2)}`);

export default {
  id: "chat", label: "Chat", icon: "chat",

  async mount(ctx, params, root) {
    const list = await api.chats();
    const cid = params.id || list[0]?.id || null;
    const newChat = async () => { try { const c = await api.chat_new(); ctx.go("chat", { id: c.id }); } catch (e) { toastError(e); } };

    ctx.side(h("h2", "Chat"),
      h("div", { style: { padding: "0 6px 10px" } }, btn("New chat", { icon: "plus", size: "sm", kind: "primary", onclick: newChat })),
      list.map((c) => h("button.side-item.chat-item", { class: c.id === cid ? "active" : "", onclick: () => ctx.go("chat", { id: c.id }) },
        icon("chat"), h("span.grow", h("span.ellipsis", c.title), h("small", c.updated)))));

    if (!aiReady()) {
      const [title, where] = aiSetupHint();
      root.append(h("div.chat-empty", empty("chat", "Set up the AI first", `${title} (${where}). Then you can chat about your campaign here.`,
        btn("Open AI settings", { icon: "gear", kind: "primary", onclick: () => ctx.go("settings", { section: "claude" }) }))));
      return;
    }
    if (!cid) {
      root.append(h("div.chat-empty", empty("chat", "Ask about your campaign",
        `${AI()} reads your landing page, party, latest recaps, open threads and the lore pages you mention, then answers, brainstorms or improvises with you.`,
        btn("Start a chat", { icon: "plus", kind: "primary", onclick: newChat }))));
      return;
    }
    await chatView(ctx, root, cid, params);
  },
};

async function chatView(ctx, root, cid, params) {
  let c = await api.chat_read(cid);
  const names = ctx.boot.settings.auto_link !== false ? await ctx.linkNames() : [];
  const s = ctx.boot.settings;
  const modelName = aiLocal() ? (s.local_model || "local model") : (s.recap_model || "Claude");

  const title = h("h1.chat-title", c.title);
  const head = h("div.chat-head",
    h("div.grow", title, h("div.tiny.faint", `${AI() === "Claude" ? "Claude" : "Local model"} · ${modelName}`)),
    switchEl(!!c.player_safe, async (v) => {
      try { c = await api.chat_update(cid, { player_safe: v }); toast(v ? "Player-safe" : "GM mode", v ? "GM-only lore is left out, so you can share answers with players." : "The AI sees GM-only lore again.", "", v ? "eye" : "lock", 3500); } catch (e) { toastError(e); }
    }, "Player-safe"),
    btn("", { icon: "edit", title: "Rename", onclick: async () => {
      const t = await promptBox("Rename chat", "Title", c.title);
      if (t) { c = await api.chat_update(cid, { title: t }); title.textContent = c.title; ctx.go("chat", { id: cid }); }
    } }),
    btn("", { icon: "trash", title: "Delete chat", onclick: async () => {
      if (!(await confirmBox("Delete this chat?", "It's moved to the campaign's .trash folder.", "Delete", true))) return;
      await api.chat_delete(cid).catch(toastError);
      ctx.go("chat", {});
    } }));

  const log = h("div.chat-log");
  const input = h("textarea.input.chat-input", { rows: 1, placeholder: `Ask ${AI() === "Claude" ? "Claude" : "your local model"} about your campaign…  (Enter to send, Shift+Enter for a new line)` });
  const sendBtn = btn("", { icon: "send", kind: "primary", title: "Send", onclick: () => send() });
  const stopBtn = btn("Stop", { icon: "stop", size: "sm", onclick: () => api.chat_stop(cid) });
  stopBtn.hidden = true;
  const composer = h("div.chat-composer", h("div.chat-box", input, sendBtn), h("div.row.tiny.faint", { style: { justifyContent: "space-between" } },
    h("span", c.player_safe ? "Player-safe: GM-only lore is left out." : "GM mode: the AI can see GM-only lore."), stopBtn));
  root.append(h("div.chat-wrap", head, log, composer));

  const autosize = () => { input.style.height = "auto"; input.style.height = Math.min(220, input.scrollHeight) + "px"; };
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  const scrollDown = () => { const m = document.getElementById("main"); m.scrollTop = m.scrollHeight; };

  const bubble = (m, i, last, lastUser) => {
    if (m.role === "user") {
      return h("div.msg.user", h("div.bubble", m.content),
        lastUser ? h("div.msg-actions", h("button.linkish", { onclick: async () => {
          await api.chat_truncate(cid, i); c = await api.chat_read(cid); input.value = m.content; draw(); autosize(); input.focus();
        } }, "Edit")) : null);
    }
    const body = render(m.content, { autoLink: true, linkNames: names });
    const meta = [m.model ? String(m.model).replace(/^local:/, "") : "", m.cost ? `about ${money(m.cost)}` : ""].filter(Boolean).join(" · ");
    return h("div.msg.ai", h("div.ai-mark", icon("feather")), h("div.grow",
      body,
      m.cut ? h("p.tiny.faint", "The reply hit its length limit. Ask it to continue.") : null,
      h("div.msg-actions",
        h("button.linkish", { onclick: () => navigator.clipboard.writeText(m.content).then(() => toast("Copied", "", "good", "check", 1500)) }, "Copy"),
        h("button.linkish", { onclick: async () => {
          const t = await promptBox("Save as a lore page", "Page title", c.title);
          if (!t) return;
          try { const id = await api.chat_to_page(t, m.content); ctx.links = null; toast("Saved to Notes", t, "good", "check", 4000); ctx.go("lore", { id }); } catch (e) { toastError(e); }
        } }, "Save as page"),
        last ? h("button.linkish", { onclick: async () => { try { await api.chat_regenerate(cid); c = await api.chat_read(cid); draw(); follow(); } catch (e) { toastError(e); } } }, "Try again") : null,
        meta ? h("span.tiny.faint", meta) : null)));
  };

  let live = null;   // the bubble being written
  const draw = () => {
    clear(log);
    if (!c.messages.length && !c.active) {
      log.append(h("div.chat-ideas", h("p.small.muted", "Try one of these, or ask anything:"),
        h("div.row.wrap", { style: { gap: "8px" } }, IDEAS.map((q) => h("button.tag.click", { onclick: () => { input.value = q; send(); } }, q)))));
    }
    const lastUser = c.messages.map((m) => m.role).lastIndexOf("user");
    c.messages.forEach((m, i) => log.append(bubble(m, i, i === c.messages.length - 1, i === lastUser)));
    live = null;
  };

  const follow = () => {
    stopBtn.hidden = false;
    sendBtn.disabled = true;
    const status = h("div.tiny.faint.chat-status", "Reading your campaign…");
    let body = h("div.md");
    live = h("div.msg.ai.writing", h("div.ai-mark", icon("feather")), h("div.grow", body, status));
    log.append(live);
    scrollDown();
    let lastText = "";
    const tick = async () => {
      if (!live?.isConnected) return;
      let r;
      try { r = await api.chat_poll(cid); } catch (e) { r = { active: false, error: String(e) }; }
      if (r.text && r.text !== lastText) {
        lastText = r.text;
        const nearBottom = (() => { const m = document.getElementById("main"); return m.scrollTop + m.clientHeight >= m.scrollHeight - 80; })();
        const fresh = render(r.text);
        body.replaceWith(fresh);
        body = fresh;
        if (nearBottom) scrollDown();
      }
      status.textContent = r.thinking ? `Thinking… ${r.seconds ?? ""}s` : r.text ? "" : `Reading your campaign… ${r.seconds ? r.seconds + "s" : ""}`;
      if (r.active) return setTimeout(tick, 200);
      stopBtn.hidden = true;
      sendBtn.disabled = false;
      if (r.error) {
        status.replaceWith(h("div.chat-error", icon("alert"), h("span.grow", r.error),
          h("button.linkish", { onclick: async () => { try { await api.chat_regenerate(cid); c = await api.chat_read(cid); draw(); follow(); } catch (e) { toastError(e); } } }, "Try again")));
        return;
      }
      c = await api.chat_read(cid);
      draw();
      scrollDown();
      input.focus();
    };
    tick();
  };

  const send = async () => {
    const text = input.value.trim();
    if (!text || sendBtn.disabled) return;
    try {
      await api.chat_send(cid, text);
      input.value = ""; autosize();
      c = await api.chat_read(cid);
      title.textContent = c.title;
      const side = document.querySelector(".chat-item.active .ellipsis");
      if (side) side.textContent = c.title;
      draw();
      follow();
    } catch (e) { toastError(e); }
  };

  draw();
  if (c.active) follow();
  else setTimeout(scrollDown, 0);
  input.focus();
  if (params.q) { input.value = params.q; autosize(); }
}
