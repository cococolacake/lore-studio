// A small Markdown renderer for lore pages and recaps. No dependencies.
//
// Supports: headings, paragraphs, **bold**, *italic*, <u>underline</u>, `code`, [links](https://…),
// [[wiki links|label]], > quotes, - lists, 1. lists, tables, ---, ``` code ```, line breaks,
// and Lore Studio blocks:
//   :::gm ... :::        GM-only secret (hidden in player view)
//   :::callout ... :::   a highlighted aside
//   {{children}}         list of subpages     {{sessions}}   list of sessions
// Output is built from escaped text, so page content can never inject scripts.

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function inline(src, opts) {
  // protect escapes and code first
  const stash = [];
  const keep = (html) => `\u0000${stash.push(html) - 1}\u0000`;
  let s = src.replace(/\\([\\*_`[\]#>|-])/g, (_, c) => keep(esc(c)));
  s = s.replace(/`([^`]+)`/g, (_, c) => keep(`<code>${esc(c)}</code>`));
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, label) =>
    keep(`<a class="wl" data-wl="${esc(t.trim())}">${esc((label || t).trim())}</a>`));
  s = s.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+|\/c\/[^\s)]+)\)/g, (_, alt, url) => keep(`<img src="${esc(url)}" alt="${esc(alt)}">`));
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, text, url) =>
    keep(`<a href="${esc(url)}" target="_blank" rel="noopener">${inline(text, opts)}</a>`));
  s = s.replace(/\{t:(\d{1,2}:\d{2}:\d{2})\}/g, (_, t) => keep(opts.hideTimes ? "" : `<a class="tchip" data-t="${t}" title="Open the transcript here">${t}</a>`));
  s = s.replace(/<u>/g, keep("<u>")).replace(/<\/u>/g, keep("</u>"));
  s = esc(s);
  s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*(?=\S)([\s\S]*?\S)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^\w])_(?=\S)([\s\S]*?\S)_(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/ {2,}\n|\\\n/g, "<br>").replace(/\n/g, " ");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)]);
}

function table(lines, opts) {
  const split = (l) => l.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
  const head = split(lines[0]);
  const rows = lines.slice(2).map(split);
  const cell = (c, tag) => `<${tag}>${inline(c.replace(/\s*<br>\s*/g, "  \n"), opts)}</${tag}>`;
  return `<div class="md-table"><table><thead><tr>${head.map((c) => cell(c, "th")).join("")}</tr></thead><tbody>${
    rows.map((r) => `<tr>${head.map((_, i) => cell(r[i] || "", "td")).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function blocks(src, opts) {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  const isBlank = (l) => !l || !l.trim();
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    let m;
    // ::: fenced Lore Studio blocks (nestable)
    if ((m = line.match(/^:::\s*(\w+)\s*(.*)$/))) {
      const kind = m[1].toLowerCase();
      const title = m[2];
      let depth = 1, j = i + 1;
      const body = [];
      for (; j < lines.length; j++) {
        if (/^:::\s*\w+/.test(lines[j])) depth++;
        else if (/^:::\s*$/.test(lines[j]) && --depth === 0) break;
        body.push(lines[j]);
      }
      i = j + 1;
      const inner = blocks(body.join("\n"), opts);
      if (kind === "gm") {
        if (!opts.playerView) out.push(`<div class="md-gm"><div class="md-gm-label">GM only${title ? " · " + esc(title) : ""}</div>${inner}</div>`);
      } else {
        out.push(`<div class="md-callout${kind !== "callout" ? " " + esc(kind) : ""}">${title ? `<div class="md-callout-title">${esc(title)}</div>` : ""}${inner}</div>`);
      }
      continue;
    }
    if ((m = line.match(/^\{\{\s*(children|sessions)\s*\}\}\s*$/))) {
      out.push(`<div class="md-embed" data-embed="${m[1]}"></div>`);
      i++; continue;
    }
    if (/^```/.test(line)) {
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre class="code">${esc(body.join("\n"))}</pre>`);
      continue;
    }
    if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
      const n = m[1].length;
      out.push(`<h${n}>${inline(m[2], opts)}</h${n}>`);
      i++; continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*> ?/, ""));
      out.push(`<blockquote>${blocks(body.join("\n"), opts)}</blockquote>`);
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        if (/^\s*([-*+]|\d+[.)])\s+/.test(l) && !/^\s{2,}/.test(l)) { items.push([l.replace(/^\s*([-*+]|\d+[.)])\s+/, "")]); i++; }
        else if (/^\s{2,}\S/.test(l) && items.length) { items[items.length - 1].push(l.replace(/^\s{2,3}/, "")); i++; }
        else if (isBlank(l) && i + 1 < lines.length && /^(\s{2,}\S|\s*([-*+]|\d+[.)])\s+)/.test(lines[i + 1])) { i++; }
        else break;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((it) => {
        const task = it[0].match(/^\[([ xX])\]\s+(.*)$/);
        if (task) it[0] = task[2];
        const body = it.length > 1 ? blocks(it.join("\n"), opts) : inline(it[0], opts);
        return task ? `<li class="task${task[1] !== " " ? " done" : ""}">${body}</li>` : `<li>${body}</li>`;
      }).join("")}</${tag}>`);
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const body = [];
      while (i < lines.length && lines[i].includes("|")) body.push(lines[i++]);
      out.push(table(body, opts));
      continue;
    }
    const para = [];
    while (i < lines.length && !isBlank(lines[i]) && !/^(#{1,6}\s|:::|```|\s*>|\{\{)/.test(lines[i])
      && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) { para.push(lines[i++]); }
    out.push(`<p>${inline(para.join("\n"), opts)}</p>`);
  }
  return out.join("\n");
}

/** Render Markdown to an element. opts: {playerView, linkNames:[[name,id]...], autoLink, selfId} */
export function render(src, opts = {}) {
  const el = document.createElement("div");
  el.className = "md";
  el.innerHTML = blocks(src || "", opts);
  if (opts.autoLink && opts.linkNames?.length) autoLink(el, opts.linkNames, opts.selfId);
  return el;
}

/** Turn the first plain-text mention of each page name into a link (skips links, code, headings). */
export function autoLink(root, names, selfId) {
  const usable = names.filter(([, id]) => id !== selfId);
  if (!usable.length) return;
  const byName = new Map(usable.map(([n, id]) => [n, id]));
  const rx = new RegExp(`(?<![\\p{L}\\p{N}_])(${usable.map(([n]) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}\\p{N}_])`, "gu");
  const done = new Set();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest("a, code, pre, h1, h2, h3, h4, h5, h6, .md-gm-label") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue;
    rx.lastIndex = 0;
    let m, last = 0;
    const frag = document.createDocumentFragment();
    let changed = false;
    while ((m = rx.exec(text))) {
      const id = byName.get(m[1]);
      if (done.has(id)) continue;
      done.add(id);
      frag.append(text.slice(last, m.index));
      const a = document.createElement("a");
      a.className = "wl auto";
      a.dataset.id = id;
      a.textContent = m[1];
      frag.append(a);
      last = m.index + m[1].length;
      changed = true;
    }
    if (changed) {
      frag.append(text.slice(last));
      node.replaceWith(frag);
    }
  }
}
