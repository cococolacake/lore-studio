"""Session plans: Markdown you write (plan.md) -> the HTML session notes you run the game from (plan.html).

The layout follows the notes the GM already uses: a sticky chip index, "Session at a glance", scene cards,
read-aloud boxes, divine voices in gold, quoted line options, notes, player-character cards and
expandable menus. Colours and fonts follow Lore Studio's theme.

    ---
    title: The Drowned Chapel
    eyebrow: The Sunken Crown · Harbour Arc
    lede: The tide goes out, and the chapel comes back up...
    first_scene: 6
    ---

    ## Session at a glance {glance}
    - Mira at the campfire | 10 min
    - branch: The backward path | 10 min
    - free: Free time in the sanctuary | flex

    :::cast
    **The Lantern Watch** Mira (scout), Captain Bram Holt (watch)
    :::

    ## Mira Returns
    :::read
    The fire has burned low.
    Mira: "Don't wake the others."
    ~ Constitution save, DC 13.
    :::

    Plain Markdown outside a block is GM notes. ### headings, lists and tables work as usual.

    ## The Backward Path {.branch tag="Branch"}
    :::divine Read aloud · Metanoea          (gold, for divine voices)
    :::lines / :::lines gold                 (one quoted option per line)
    - **Why they're here.**                    (inside a list: indented > lines are quoted options,
      > I read Mira's memory of you.           >> for gold ones)
    :::note                                   (a callout)
    :::pc Scarlett                            (a card per character; "~ Theme: ..." for its subtitle)
    :::act The Archive | Keeper Anvaya       (an expandable menu entry)
    :::stat Goblin Boss | Small humanoid · AC 17 · HP 21   (a stat block: name, then the summary line)

Heading options in {braces}: #id, .branch / .divine / .free (colour of the tag), tag="...", short="..." (index chip).
"""
import html as htmllib
import re
from html.parser import HTMLParser

from . import frontmatter

E = htmllib.escape


TEMPLATE = """---
title: {title}
eyebrow: {campaign}
lede: One line on what this session is about.
---

## Session at a glance {{glance}}
- Opening scene | 15 min
- branch: A choice the party might make | 20 min
- free: Free time | flex

:::cast
**Who's here** NPCs the party may meet.
:::

## Previously {{tag="Recap"}}
:::read Read aloud · Previously
{previously}
:::

## Opening Scene
:::read
Set the scene in a few lines.
Someone: "A first line of dialogue."
:::

What the party can learn or do here.

- **A beat.** What happens.
  > A line the NPC might say.

:::note
**Secret.** Something the players don't know yet.
:::
"""


# ---- inline Markdown ------------------------------------------------------------

FL_KIND = {"actor": "actor", "monster": "actor", "table": "table", "scene": "scene", "sound": "sound", "playlist": "sound",
           "handout": "handout"}
FL_ICON = {"actor": "&#9876;&#xFE0E; ", "table": "&#9856;&#xFE0E; ", "scene": "&#9873;&#xFE0E; ", "sound": "&#9835; ", "handout": "&#9993;&#xFE0E; "}


def inline(s):
    stash = []

    def keep(x):
        stash.append(x)
        return f"\x00{len(stash) - 1}\x00"
    s = re.sub(r"\\([\\*_`\[\]|~])", lambda m: keep(E(m.group(1))), s)
    s = re.sub(r"`([^`]+)`", lambda m: keep(f"<code>{E(m.group(1))}</code>"), s)
    s = re.sub(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", lambda m: keep(f'<span class="wl">{E((m.group(2) or m.group(1)).strip())}</span>'), s)
    # Foundry links: {actor:Goblin}, {table:Wild Magic}, {scene:The Cellar}, {sound:Tavern}, {handout:Wanted poster}
    s = re.sub(r"\{(actor|monster|table|scene|sound|playlist|handout):\s*([^{}]+?)\s*\}",
               lambda m: keep(f'<span class="fl fl-{FL_KIND[m.group(1)]}" data-fl="{FL_KIND[m.group(1)]}" data-name="{E(m.group(2))}">'
                              f'{FL_ICON[FL_KIND[m.group(1)]]}{E(m.group(2))}</span>'), s)
    s = re.sub(r"\[([^\]]+)\]\((https?://[^\s)]+)\)", lambda m: keep(f'<a href="{E(m.group(2))}">{inline(m.group(1))}</a>'), s)
    s = E(s, quote=False)
    s = re.sub(r"\*\*(?=\S)(.+?)(?<=\S)\*\*", r"<b>\1</b>", s)
    s = re.sub(r"(?<![*\w])\*(?=\S)(.+?)(?<=\S)\*(?!\*)", r"<i>\1</i>", s)
    s = re.sub(r"(?<!\w)_(?=\S)(.+?)(?<=\S)_(?!\w)", r"<i>\1</i>", s)
    return re.sub(r"\x00(\d+)\x00", lambda m: stash[int(m.group(1))], s)


# ---- block Markdown (GM notes) ---------------------------------------------------

def _fence_end(lines, i):
    depth, j = 1, i + 1
    while j < len(lines):
        if re.match(r"^:::\s*\w", lines[j]):
            depth += 1
        elif re.match(r"^:::\s*$", lines[j]):
            depth -= 1
            if depth == 0:
                return j
        j += 1
    return j


def _list(lines, i):
    """Parse a (nested) list starting at lines[i]. Returns (html, next index)."""
    ordered = bool(re.match(r"^\s*\d+[.)]\s", lines[i]))
    base = len(lines[i]) - len(lines[i].lstrip())
    items = []
    while i < len(lines):
        ln = lines[i]
        if not ln.strip():
            if i + 1 < len(lines) and re.match(r"^\s*([-*+]|\d+[.)])\s", lines[i + 1]) and len(lines[i + 1]) - len(lines[i + 1].lstrip()) >= base:
                i += 1
                continue
            break
        ind = len(ln) - len(ln.lstrip())
        m = re.match(r"^\s*([-*+]|\d+[.)])\s+(.*)$", ln)
        if m and ind == base:
            items.append([m.group(2), ""])
            i += 1
        elif ind > base and items and re.match(r"^>{1,2}\s", ln.strip()):
            gold = ln.strip().startswith(">>")
            quotes = []
            while i < len(lines) and lines[i].strip().startswith(">>" if gold else ">") and not (not gold and lines[i].strip().startswith(">>")):
                quotes.append(re.sub(r"^>{1,2}\s?", "", lines[i].strip()).strip().strip('"“”'))
                i += 1
            items[-1][1] += f'<div class="lines{" gold" if gold else ""}">' + "".join(f"<p>{inline(q)}</p>" for q in quotes if q) + "</div>"
        elif m and ind > base and items:
            sub, i = _list(lines, i)
            items[-1][1] += sub
        elif ind > base and items:
            items[-1][0] += " " + ln.strip()
            i += 1
        else:
            break
    tag = "ol" if ordered else "ul"
    return f"<{tag}>" + "".join(f"<li>{inline(a)}{b}</li>" for a, b in items) + f"</{tag}>", i


def _table(rows):
    def cells(r):
        return [c.strip().replace("\\|", "|") for c in re.split(r"(?<!\\)\|", r.strip().strip("|"))]
    head = cells(rows[0])
    body = [cells(r) for r in rows[2:]]
    return ('<div class="tablewrap"><table><thead><tr>' + "".join(f"<th>{inline(c)}</th>" for c in head) + "</tr></thead><tbody>"
            + "".join("<tr>" + "".join(f"<td>{inline(r[k] if k < len(r) else '')}</td>" for k in range(len(head))) + "</tr>" for r in body)
            + "</tbody></table></div>")


SAY = re.compile(r"^([A-Z][\w .'’\-]{0,32}):\s+(.+)$")


def _read_body(lines):
    out = []
    para = []

    def flush():
        if para:
            out.append(f"<p>{inline(' '.join(para))}</p>")
            para.clear()
    for ln in lines:
        s = ln.strip()
        if not s:
            flush()
            continue
        if s.startswith("~ "):
            flush()
            out.append(f'<p class="kv">{inline(s[2:])}</p>')
            continue
        m = SAY.match(s)
        if m and (m.group(2)[:1] in "\"“'‘" or m.group(2).startswith("*")):
            flush()
            out.append(f'<p><span class="sp">{E(m.group(1))}</span><span class="say">{inline(m.group(2))}</span></p>')
            continue
        if s.startswith(("\"", "“")) and not para:
            out.append(f'<p><span class="say">{inline(s)}</span></p>')
            continue
        para.append(s)
    flush()
    return "".join(out)


def blocks(src):
    """GM-notes Markdown (with Lore Studio ::: blocks) -> HTML."""
    lines = src.replace("\r\n", "\n").split("\n")
    out, i, gm = [], 0, []

    def flush_gm():
        if gm:
            out.append(f'<div class="gm">{"".join(gm)}</div>')
            gm.clear()
    while i < len(lines):
        ln = lines[i]
        s = ln.strip()
        if not s:
            i += 1
            continue
        m = re.match(r"^:::\s*(\w+)\s*(.*)$", ln)
        if m:
            kind, arg = m.group(1).lower(), m.group(2).strip()
            j = _fence_end(lines, i)
            body = lines[i + 1:j]
            i = j + 1
            if kind in ("read", "divine"):
                flush_gm()
                cls = "read" + (" gold" if kind == "divine" else "") + (" alt" if arg else "")
                label = f' data-label="{E(arg)}"' if arg else ""
                out.append(f'<div class="{cls}"{label}>{_read_body(body)}</div>')
            elif kind == "lines":
                quotes = [re.sub(r"^\s*([-*+]|\d+[.)])\s+", "", x).strip().strip("\"“”") for x in body if x.strip()]
                gm.append(f'<div class="lines{" gold" if "gold" in arg else ""}">' + "".join(f"<p>{inline(q)}</p>" for q in quotes) + "</div>")
            elif kind == "note":
                gm.append(f'<div class="note">{blocks_plain(chr(10).join(body))}</div>')
            elif kind == "pc":
                flush_gm()
                inner = list(body)
                kv = ""
                if inner and inner[0].strip().startswith("~ "):
                    kv = f'<p class="kv">{inline(inner.pop(0).strip()[2:])}</p>'
                out.append(f'<div class="pc"><h3>{inline(arg)}</h3>{kv}{blocks(chr(10).join(inner))}</div>')
            elif kind == "act":
                flush_gm()
                name, _, desc = arg.partition("|")
                out.append(f'<details class="act"><summary><span class="nm">{inline(name.strip())}</span>'
                           f'{f"<span class=ds>{inline(desc.strip())}</span>" if desc.strip() else ""}</summary>'
                           f'<div class="body">{blocks(chr(10).join(body))}</div></details>')
            elif kind == "stat":
                flush_gm()
                name, _, line = arg.partition("|")
                out.append(f'<div class="stat"><span class="nm">{inline(name.strip())}</span>'
                           f'{f"<span class=ln>{inline(line.strip())}</span>" if line.strip() else ""}'
                           f'{blocks_plain(chr(10).join(body))}</div>')
            elif kind == "cast":
                flush_gm()
                items = []
                for x in body:
                    x = x.strip()
                    if not x:
                        continue
                    mm = re.match(r"^\*\*(.+?)\*\*\s*(.*)$", x)
                    items.append(f"<div><b>{inline(mm.group(1))}</b>{inline(mm.group(2))}</div>" if mm else f"<div>{inline(x)}</div>")
                out.append(f'<div class="cast">{"".join(items)}</div>')
            elif kind in ("gm", "secret"):
                gm.append(blocks_plain(chr(10).join(body)))
            else:
                gm.append(blocks_plain(chr(10).join(body)))
            continue
        if re.match(r"^(\*\s*){3}$|^(·\s*){3}$", s):
            flush_gm()
            out.append('<p class="divider">· · ·</p>')
            i += 1
            continue
        start = i
        while i < len(lines) and lines[i].strip() and not re.match(r"^:::\s*\w", lines[i]):
            i += 1
        gm.append(blocks_plain("\n".join(lines[start:i])))
    flush_gm()
    return "".join(out)


def blocks_plain(src):
    """Plain Markdown: ### headings, paragraphs, lists, tables."""
    lines = src.replace("\r\n", "\n").split("\n")
    out, i = [], 0
    while i < len(lines):
        ln = lines[i]
        s = ln.strip()
        if not s:
            i += 1
            continue
        m = re.match(r"^(#{3,6})\s+(.*)$", s)
        if m:
            out.append(f"<h3>{inline(m.group(2))}</h3>")
            i += 1
            continue
        if re.match(r"^\s*([-*+]|\d+[.)])\s+", ln):
            html, i = _list(lines, i)
            out.append(html)
            continue
        if "|" in s and i + 1 < len(lines) and re.match(r"^\s*\|?\s*:?-{2,}", lines[i + 1]):
            rows = []
            while i < len(lines) and "|" in lines[i]:
                rows.append(lines[i])
                i += 1
            out.append(_table(rows))
            continue
        para = []
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#{3,6}\s|\s*([-*+]|\d+[.)])\s)", lines[i]):
            para.append(lines[i].strip())
            i += 1
        out.append(f"<p>{inline(' '.join(para))}</p>")
    return "".join(out)


# ---- scenes ---------------------------------------------------------------------

def parse(text):
    """plan.md -> (meta, [scene dicts])."""
    meta, body = frontmatter.parse(text or "")
    scenes, cur = [], None
    for ln in body.replace("\r\n", "\n").split("\n"):
        m = re.match(r"^##\s+(.*?)\s*(\{([^}]*)\})?\s*$", ln) if ln.startswith("## ") else None
        if m:
            cur = {"title": m.group(1).strip(), "attrs": _attrs(m.group(3) or ""), "lines": []}
            scenes.append(cur)
        elif cur is not None:
            cur["lines"].append(ln)
        elif ln.strip():
            scenes.append(cur := {"title": "", "attrs": {"intro": True}, "lines": [ln]})
    n = int(meta.get("first_scene") or 1)
    used = set()
    for sc in scenes:
        a = sc["attrs"]
        sc["body"] = "\n".join(sc.pop("lines")).strip("\n")
        if a.get("intro"):
            sc.update({"id": "intro", "tag": "", "short": "", "kind": ""})
            continue
        if a.get("glance"):
            sc.update({"id": a.get("id") or "glance", "tag": a.get("tag") or "Prep", "short": a.get("short") or "At a glance", "kind": a.get("kind", "")})
        elif a.get("tag"):
            m = re.match(r"^s(\d+)$", a.get("id") or "")
            if m:              # a numbered scene with its own tag (e.g. a branch): keeps its number in the index
                n = int(m.group(1)) + 1
            sc.update({"id": a.get("id") or _slug(sc["title"]), "tag": a["tag"],
                       "short": a.get("short") or (f"{m.group(1)}. {_short(sc['title'])}" if m else _short(sc["title"])), "kind": a.get("kind", "")})
        else:
            sc.update({"id": a.get("id") or f"s{n}", "tag": f"Scene {n}", "short": a.get("short") or f"{n}. {_short(sc['title'])}", "kind": a.get("kind", ""), "number": n})
            n += 1
        base, k = sc["id"], 2
        while sc["id"] in used:
            sc["id"] = f"{base}-{k}"
            k += 1
        used.add(sc["id"])
    return meta, scenes


def _short(title):
    t = re.sub(r"^(the|a|an)\s+", "", title.strip().strip('"“”'), flags=re.I)
    return t if len(t) <= 22 else t[:20].rsplit(" ", 1)[0] + "…"


def _slug(t):
    return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")[:30] or "scene"


def _attrs(s):
    a = {}
    for m in re.finditer(r'(\w+)\s*=\s*"([^"]*)"|#([\w-]+)|\.(\w+)|(\w+)', s):
        if m.group(1):
            a[m.group(1)] = m.group(2)
        elif m.group(3):
            a["id"] = m.group(3)
        elif m.group(4):
            a["kind"] = m.group(4)
        elif m.group(5):
            a[m.group(5)] = True
    return a


def _glance_body(body):
    """In the at-a-glance scene, list items with '| time' become the timed flow; everything else renders as usual."""
    out, chunk, flow = [], [], []
    rx = re.compile(r"^\s*[-*]\s+(?:(branch|free):\s*)?(.+?)\s*\|\s*(.+?)\s*$")

    def flush_chunk():
        if chunk:
            out.append(blocks("\n".join(chunk)))
            chunk.clear()

    def flush_flow():
        if flow:
            out.append('<ol class="flow">' + "".join(flow) + "</ol>")
            flow.clear()
    for ln in body.split("\n"):
        m = rx.match(ln)
        if m:
            flush_chunk()
            cls = {"branch": ' class="br"', "free": ' class="fr"'}.get(m.group(1) or "", "")
            flow.append(f'<li><span{cls}>{inline(m.group(2))}</span><span class="t">{inline(m.group(3))}</span></li>')
        elif ln.strip() or not flow:
            flush_flow()
            chunk.append(ln)
    flush_flow()
    flush_chunk()
    return "".join(out)


# ---- rendering --------------------------------------------------------------------

THEMES = {
    "light": {"bg": "#F2F2F3", "surface": "#FFFFFF", "fg": "#17171A", "muted": "#55555D", "line": "rgba(17,17,20,.12)",
              "gold": "#9A6B06", "gold-wash": "#FCF1DF", "ember": "#C2502A", "ember-wash": "#FDEDE6", "free": "#2F8F68"},
    "dark": {"bg": "#0F0F11", "surface": "#19191C", "fg": "#F2F2F4", "muted": "#A4A4AD", "line": "rgba(255,255,255,.11)",
             "gold": "#F0B860", "gold-wash": "rgba(240,184,96,.12)", "ember": "#F0997B", "ember-wash": "rgba(240,124,96,.12)", "free": "#6CCB8F"},
}


def css(accent="#9381FF", accent_text="#6A55F0", accent_soft="#EEEBFF"):
    def vars_for(t, dark):
        v = THEMES[t]
        acc_text = accent if dark else accent_text
        acc_soft = f"color-mix(in srgb, {accent} 15%, transparent)" if dark else accent_soft
        return (f"--bg:{v['bg']};--surface:{v['surface']};--fg:{v['fg']};--muted:{v['muted']};--line:{v['line']};"
                f"--accent:{accent};--accent-text:{acc_text};--accent-soft:{acc_soft};--gold:{v['gold']};--gold-wash:{v['gold-wash']};"
                f"--ember:{v['ember']};--ember-wash:{v['ember-wash']};--free:{v['free']};")
    return f"""
:root{{{vars_for('light', False)}color-scheme:light;
--font:"Segoe UI Variable Text","Segoe UI","Inter",system-ui,-apple-system,sans-serif;
--display:"Segoe UI Variable Display","Segoe UI","Inter Display","Inter",system-ui,sans-serif}}
:root[data-theme=dark]{{{vars_for('dark', True)}color-scheme:dark}}
@media (prefers-color-scheme:dark){{:root:not([data-theme=light]){{{vars_for('dark', True)}color-scheme:dark}}}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--fg);font:16.5px/1.62 var(--font);padding:0 max(16px,env(safe-area-inset-left)) 64px}}
.wrap{{max-width:780px;margin:0 auto;display:flex;flex-direction:column;gap:40px}}
header.top{{padding-top:44px;display:flex;flex-direction:column;gap:10px}}
.eyebrow,.tag{{font-weight:700;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}}
h1,h2,h3{{font-family:var(--display);font-weight:600;line-height:1.2;margin:0;letter-spacing:-.015em;text-wrap:balance}}
h1{{font-size:clamp(32px,6vw,46px);color:var(--fg)}}
h2{{font-size:clamp(24px,4.5vw,30px)}}
h3{{font-size:18.5px;color:var(--accent-text);margin-top:6px}}
p{{margin:0}}
.lede{{color:var(--muted);font-size:17.5px;max-width:62ch}}
nav.index{{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);padding-block:10px;display:flex;gap:6px;overflow-x:auto;scrollbar-width:thin}}
nav.index a{{flex:none;font-size:13px;font-weight:600;color:var(--fg);text-decoration:none;border-radius:999px;padding:5px 12px;background:var(--surface);box-shadow:0 0 0 1px var(--line)}}
nav.index a:hover,nav.index a:focus-visible{{background:var(--accent-soft);color:var(--accent-text);outline:none}}
section.scene{{display:flex;flex-direction:column;gap:16px;scroll-margin-top:64px;min-width:0;background:var(--surface);border-radius:22px;padding:24px 26px 26px;box-shadow:0 1px 2px rgba(15,15,20,.04),0 6px 20px rgba(15,15,20,.06),0 0 0 1px var(--line)}}
.scene-head{{display:flex;flex-direction:column;gap:6px;border-bottom:1px solid var(--line);padding-bottom:12px}}
.tag.branch{{color:var(--ember)}}.tag.divine{{color:var(--gold)}}.tag.free{{color:var(--free)}}
.read{{background:var(--accent-soft);border-left:3px solid var(--accent);padding:16px 20px;display:flex;flex-direction:column;gap:11px;border-radius:0 14px 14px 0;font-size:16.5px}}
.read::before{{content:"Read aloud";font-weight:700;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-text)}}
.read.alt::before{{content:attr(data-label)}}
.read .sp{{font-weight:700;font-size:12.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent-text);margin-right:7px}}
.read p:not(.kv){{font-style:italic}}.read .say{{font-style:normal}}
.read.gold{{background:var(--gold-wash);border-left-color:var(--gold)}}
.read.gold::before,.read.gold .sp{{color:var(--gold)}}
.gm{{font-size:15.5px;display:flex;flex-direction:column;gap:10px}}
.gm ul,.gm ol{{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:7px}}
.gm ul ul{{margin-top:7px}}
.gm b{{color:var(--accent-text);font-weight:650}}
.lines{{display:flex;flex-direction:column;gap:8px;padding-left:14px;border-left:2px solid var(--line);margin-top:4px}}
.lines p{{font-size:16px}}.lines p::before{{content:"\\201C";color:var(--muted)}}.lines p::after{{content:"\\201D";color:var(--muted)}}
.lines.gold{{border-left-color:var(--gold)}}
.note{{background:var(--ember-wash);border-radius:14px;padding:12px 16px;font-size:15px;display:flex;flex-direction:column;gap:6px}}
.note b{{color:var(--ember)}}
.flow{{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;counter-reset:f}}
.flow li{{display:grid;grid-template-columns:30px 1fr auto;gap:10px;align-items:baseline;padding:9px 0;border-bottom:1px dashed var(--line);font-size:15.5px}}
.flow li::before{{counter-increment:f;content:counter(f);font-weight:700;color:var(--muted);font-variant-numeric:tabular-nums}}
.flow .t{{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}}
.flow .br{{color:var(--ember)}}.flow .fr{{color:var(--free)}}
.tablewrap{{overflow-x:auto}}table{{border-collapse:collapse;width:100%;font-size:15px}}
th,td{{text-align:left;vertical-align:top;padding:8px 10px;border-bottom:1px solid var(--line)}}
th{{font-weight:700;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}}
td:first-child{{font-weight:650;color:var(--accent-text)}}
.cast{{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}}
.cast div{{background:var(--bg);border-radius:14px;padding:10px 14px;font-size:14.5px;min-width:0}}
.cast b{{font-family:var(--display);font-weight:600;font-size:16px;color:var(--accent-text);display:block}}
.pc{{border-radius:16px;background:var(--bg);padding:14px 18px;display:flex;flex-direction:column;gap:10px}}
.pc h3{{margin:0}}
details.act{{border-radius:16px;background:var(--bg)}}
.stat{{border:1px solid var(--line);border-top:3px solid var(--ember);border-radius:10px;background:var(--surface);padding:12px 16px;display:flex;flex-direction:column;gap:6px;font-size:15px}}
.stat .nm{{font-size:19px;font-weight:700;color:var(--ember)}}.stat .ln{{font-size:13.5px;color:var(--muted)}}.stat p{{margin:0}}.stat p b{{color:var(--fg)}}
details.act>summary{{cursor:pointer;padding:12px 16px;display:flex;flex-direction:column;gap:2px;list-style:none}}
details.act>summary::-webkit-details-marker{{display:none}}
details.act>summary .nm{{font-family:var(--display);font-weight:600;font-size:18px;color:var(--accent-text)}}
details.act>summary .ds{{font-size:14.5px;color:var(--muted)}}
details.act[open]>summary{{border-bottom:1px solid var(--line)}}
details.act .body{{padding:14px 16px 18px;display:flex;flex-direction:column;gap:14px}}
.kv{{font-size:13px;color:var(--muted);letter-spacing:.03em;font-style:normal}}
.divider{{text-align:center;color:var(--muted);letter-spacing:.6em;font-size:14px}}
.wl{{border-bottom:1px dashed currentColor}}
.fl{{display:inline-flex;align-items:center;gap:2px;padding:0 7px;border-radius:99px;font-size:.92em;font-weight:600;background:var(--accent-soft);color:var(--accent-text);white-space:nowrap}}
.fl.fl-actor{{background:color-mix(in srgb,#E5626A 16%,transparent);color:#B5384A}}.fl.fl-table{{background:color-mix(in srgb,#F0A04B 18%,transparent);color:#A0601B}}.fl.fl-sound{{background:color-mix(in srgb,#3FA9A3 16%,transparent);color:#1E7A75}}.fl.fl-handout{{background:color-mix(in srgb,#4A90E2 16%,transparent);color:#2F6DB5}}
.live .fl{{cursor:pointer}}.live .fl:hover{{filter:brightness(.95);box-shadow:0 0 0 1.5px currentColor}}
code{{font-size:.9em;background:var(--bg);padding:1px 5px;border-radius:5px}}
@media print{{nav.index{{position:static}}section.scene{{box-shadow:none;border:1px solid #ddd;break-inside:avoid-page}}}}
@media (prefers-reduced-motion:no-preference){{html{{scroll-behavior:smooth}}}}
"""


def theme_from_settings(theme_setting):
    """Lore Studio's theme (base + accent name) -> the colours used in exported notes."""
    from .paths import WEB_DIR
    accent = (theme_setting or {}).get("accent") or "periwinkle"
    out = {"accent": "#9381FF", "accent_text": "#6A55F0", "accent_soft": "#EEEBFF"}
    try:
        tokens = (WEB_DIR / "css" / "tokens.css").read_text(encoding="utf-8")
        m = re.search(r'\[data-accent="' + re.escape(accent) + r'"\]\s*\{([^}]*)\}', tokens)
        if m:
            for key, name in (("accent", "--accent"), ("accent_text", "--accent-text"), ("accent_soft", "--accent-soft")):
                mm = re.search(re.escape(name) + r":\s*(#[0-9A-Fa-f]{3,8})", m.group(1))
                if mm:
                    out[key] = mm.group(1)
    except OSError:
        pass
    return out


def render(text, campaign_name="", number=None, theme=None):
    """plan.md text -> a complete, self-contained HTML page."""
    meta, scenes = parse(text)
    theme = theme or {}
    title = meta.get("title") or "Untitled session"
    full_title = f"Session {number}: {title}" if number is not None and number != "" else title
    eyebrow = meta.get("eyebrow") or campaign_name
    lede = meta.get("lede") or ""
    nav = "".join(f'<a href="#{E(sc["id"])}">{E(sc["short"])}</a>' for sc in scenes if not sc["attrs"].get("intro"))
    secs = []
    for sc in scenes:
        if sc["attrs"].get("intro"):
            secs.append(f'<section class="scene" id="intro">{blocks(sc["body"])}</section>')
            continue
        body = _glance_body(sc["body"]) if sc["attrs"].get("glance") else blocks(sc["body"])
        kind = f' {E(sc["kind"])}' if sc.get("kind") else ""
        secs.append(f'<section class="scene" id="{E(sc["id"])}"><div class="scene-head"><span class="tag{kind}">{E(sc["tag"])}</span>'
                    f'<h2>{inline(sc["title"])}</h2></div>{body}</section>')
    data_theme = f' data-theme="{E(theme["base"])}"' if theme.get("base") in ("light", "dark") else ""
    return (f'<!doctype html><html lang="en"{data_theme}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f"<title>{E(full_title)}</title><style>{css(theme.get('accent', '#9381FF'), theme.get('accent_text', '#6A55F0'), theme.get('accent_soft', '#EEEBFF'))}</style></head><body>"
            f'<div class="wrap"><header class="top">{f"<span class=eyebrow>{E(eyebrow)}</span>" if eyebrow else ""}<h1>{E(full_title)}</h1>'
            f'{f"<p class=lede>{inline(lede)}</p>" if lede else ""}</header>'
            f'{f"<nav class=index aria-label=Scenes>{nav}</nav>" if nav else ""}{"".join(secs)}</div></body></html>')


def render_scene(text, scene_id, theme=None):
    """One scene as a page of its own (for live mode). Includes the at-a-glance section if asked for."""
    meta, scenes = parse(text)
    theme = theme or {}
    sc = next((x for x in scenes if x.get("id") == scene_id), None)
    if not sc:
        return ""
    body = _glance_body(sc["body"]) if sc["attrs"].get("glance") else blocks(sc["body"])
    kind = f' {E(sc["kind"])}' if sc.get("kind") else ""
    data_theme = f' data-theme="{E(theme["base"])}"' if theme.get("base") in ("light", "dark") else ""
    return (f'<!doctype html><html lang="en"{data_theme}><head><meta charset="utf-8">'
            f"<style>{css(theme.get('accent', '#9381FF'), theme.get('accent_text', '#6A55F0'), theme.get('accent_soft', '#EEEBFF'))}"
            "body{padding:0 4px 40px;background:transparent}.wrap{max-width:none;gap:0}section.scene{box-shadow:none;padding:6px 6px 20px;background:transparent}"
            ".gm li{cursor:pointer;border-radius:6px;padding:1px 4px;margin-left:-4px}.gm li:hover{background:var(--accent-soft)}"
            ".gm li.done{color:var(--muted);text-decoration:line-through;text-decoration-color:var(--accent)}</style></head><body>"
            f'<div class="wrap"><section class="scene"><div class="scene-head"><span class="tag{kind}">{E(sc["tag"])}</span>'
            f'<h2>{inline(sc["title"])}</h2></div>{body}</section></div></body></html>').replace("<body>", '<body class="live">', 1)


def scene_titles(text):
    _, scenes = parse(text)
    return [{"id": s["id"], "title": s["title"], "tag": s["tag"], "glance": bool(s["attrs"].get("glance"))}
            for s in scenes if not s["attrs"].get("intro")]


def carry_over(text, keep_ids, new_title=""):
    """A new plan from some scenes of this one (the ones the party didn't reach)."""
    meta, scenes = parse(text)
    keep = [s for s in scenes if s.get("id") in keep_ids]
    first = next((s.get("number") for s in keep if s.get("number")), None)
    out_meta = {k: v for k, v in meta.items() if k in ("eyebrow",)}
    out_meta["title"] = new_title or meta.get("title") or ""
    if meta.get("lede"):
        out_meta["lede"] = meta["lede"]
    if first:
        out_meta["first_scene"] = first
    parts = []
    for s in keep:
        a = s["attrs"]
        attr = " ".join(x for x in [
            "glance" if a.get("glance") else "", f'.{a["kind"]}' if a.get("kind") else "",
            f'tag="{a["tag"]}"' if a.get("tag") else "", f'short="{a["short"]}"' if a.get("short") else "",
        ] if x)
        parts.append(f"## {s['title']}" + (f" {{{attr}}}" if attr else "") + "\n" + s["body"])
    return frontmatter.dump(out_meta, "\n\n".join(parts) + "\n")


# ---- importing existing HTML notes ------------------------------------------------

class _Node:
    def __init__(self, tag, attrs, parent=None):
        self.tag, self.attrs, self.parent, self.kids = tag, dict(attrs), parent, []

    @property
    def cls(self):
        return set((self.attrs.get("class") or "").split())

    def text(self):
        return "".join(k if isinstance(k, str) else k.text() for k in self.kids)

    def find_all(self, pred):
        for k in self.kids:
            if isinstance(k, _Node):
                if pred(k):
                    yield k
                yield from k.find_all(pred)


class _Tree(HTMLParser):
    VOID = {"meta", "link", "br", "img", "hr", "input", "source", "col", "area", "base", "wbr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = _Node("root", [])
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        n = _Node(tag, attrs, self.cur)
        self.cur.kids.append(n)
        if tag not in self.VOID:
            self.cur = n

    def handle_startendtag(self, tag, attrs):
        self.cur.kids.append(_Node(tag, attrs, self.cur))

    def handle_endtag(self, tag):
        n = self.cur
        while n is not self.root and n.tag != tag:
            n = n.parent
        if n is not self.root:
            self.cur = n.parent

    def handle_data(self, data):
        if self.cur.tag not in ("style", "script", "title"):
            self.cur.kids.append(data)


def _md_inline(node):
    out = []
    for k in node.kids:
        if isinstance(k, str):
            out.append(re.sub(r"\s+", " ", k).replace("*", "\\*"))
        elif k.tag in ("b", "strong"):
            t = _md_inline(k).strip()
            out.append(f"**{t}**" if t else "")
        elif k.tag in ("i", "em"):
            t = _md_inline(k).strip()
            out.append(f"*{t}*" if t else "")
        elif k.tag == "a" and (k.attrs.get("href") or "").startswith("http"):
            out.append(f"[{_md_inline(k).strip()}]({k.attrs['href']})")
        elif k.tag == "br":
            out.append(" ")
        else:
            out.append(_md_inline(k))
    return "".join(out)


def _md_list(node, depth=0):
    lines = []
    for i, li in enumerate([k for k in node.kids if isinstance(k, _Node) and k.tag == "li"], 1):
        marker = f"{i}." if node.tag == "ol" else "-"
        text_kids = _Node("span", [])
        text_kids.kids = [k for k in li.kids if not (isinstance(k, _Node) and (k.tag in ("ul", "ol") or "lines" in k.cls))]
        lines.append("  " * depth + f"{marker} {_md_inline(text_kids).strip()}")
        for k in li.kids:
            if isinstance(k, _Node) and k.tag in ("ul", "ol"):
                lines.extend(_md_list(k, depth + 1))
            elif isinstance(k, _Node) and "lines" in k.cls:
                q = ">>" if "gold" in k.cls else ">"
                for p in [x for x in k.kids if isinstance(x, _Node) and x.tag == "p"]:
                    lines.append("  " * (depth + 1) + f"{q} {_md_inline(p).strip()}")
    return lines


def _md_table(node):
    rows = []
    for tr in node.find_all(lambda n: n.tag == "tr"):
        rows.append([_md_inline(c).strip().replace("|", "\\|") for c in tr.kids if isinstance(c, _Node) and c.tag in ("td", "th")])
    if not rows:
        return ""
    w = max(len(r) for r in rows)
    rows = [r + [""] * (w - len(r)) for r in rows]
    return "\n".join(["| " + " | ".join(rows[0]) + " |", "|" + "---|" * w] + ["| " + " | ".join(r) + " |" for r in rows[1:]])


def _md_read(node):
    out = []
    for p in [k for k in node.kids if isinstance(k, _Node)]:
        if p.tag != "p":
            continue
        sp = next((k for k in p.kids if isinstance(k, _Node) and "sp" in k.cls), None)
        say = next((k for k in p.kids if isinstance(k, _Node) and "say" in k.cls), None)
        if "kv" in p.cls:
            out.append("~ " + _md_inline(p).strip())
        elif sp is not None:
            out.append(f"{sp.text().strip()}: {_md_inline(say).strip() if say is not None else ''}")
        elif say is not None:
            out.append(_md_inline(say).strip())
        else:
            out.append(_md_inline(p).strip())
        out.append("")
    return "\n".join(out).strip()


def _md_children(node):
    """Section or gm/body content -> plan Markdown."""
    out = []
    for k in node.kids:
        if isinstance(k, str):
            if k.strip():
                out.append(k.strip())
            continue
        c = k.cls
        if "scene-head" in c:
            continue
        if k.tag == "div" and "read" in c:
            label = k.attrs.get("data-label")
            kind = "divine" if "gold" in c else "read"
            out.append(f":::{kind}{(' ' + label) if label else ''}\n{_md_read(k)}\n:::")
        elif k.tag == "div" and "gm" in c:
            out.append(_md_children(k))
        elif k.tag == "div" and "lines" in c:
            qs = [_md_inline(p).strip() for p in k.kids if isinstance(p, _Node) and p.tag == "p"]
            out.append(f":::lines{' gold' if 'gold' in c else ''}\n" + "\n".join(qs) + "\n:::")
        elif k.tag == "div" and "note" in c:
            out.append(":::note\n" + _md_children(k) + "\n:::")
        elif k.tag == "div" and "pc" in c:
            h3 = next((x for x in k.kids if isinstance(x, _Node) and x.tag == "h3"), None)
            rest = _Node("div", [])
            rest.kids = [x for x in k.kids if x is not h3]
            kv = next((x for x in rest.kids if isinstance(x, _Node) and "kv" in x.cls), None)
            if kv is not None:
                rest.kids.remove(kv)
            out.append(f":::pc {_md_inline(h3).strip() if h3 else ''}\n" + (f"~ {_md_inline(kv).strip()}\n" if kv is not None else "")
                       + _md_children(rest) + "\n:::")
        elif k.tag == "details" and "act" in c:
            summ = next((x for x in k.kids if isinstance(x, _Node) and x.tag == "summary"), None)
            nm = next((x for x in summ.find_all(lambda n: "nm" in n.cls)), None) if summ else None
            ds = next((x for x in summ.find_all(lambda n: "ds" in n.cls)), None) if summ else None
            body = next((x for x in k.kids if isinstance(x, _Node) and "body" in x.cls), None)
            head = (_md_inline(nm).strip() if nm else (summ.text().strip() if summ else "")) + (f" | {_md_inline(ds).strip()}" if ds else "")
            out.append(f":::act {head}\n" + (_md_children(body) if body else "") + "\n:::")
        elif k.tag == "div" and "stat" in c:
            nm = next((x for x in k.kids if isinstance(x, _Node) and "nm" in x.cls), None)
            ln = next((x for x in k.kids if isinstance(x, _Node) and "ln" in x.cls), None)
            rest = _Node("div", [])
            rest.kids = [x for x in k.kids if x is not nm and x is not ln]
            head = (_md_inline(nm).strip() if nm else "Stat block") + (f" | {_md_inline(ln).strip()}" if ln is not None else "")
            out.append(f":::stat {head}\n" + _md_children(rest) + "\n:::")
        elif k.tag == "div" and "cast" in c:
            items = []
            for d in [x for x in k.kids if isinstance(x, _Node)]:
                b = next((x for x in d.kids if isinstance(x, _Node) and x.tag in ("b", "strong")), None)
                rest = _Node("div", [])
                rest.kids = [x for x in d.kids if x is not b]
                items.append((f"**{b.text().strip()}** " if b else "") + _md_inline(rest).strip())
            out.append(":::cast\n" + "\n".join(items) + "\n:::")
        elif k.tag == "ol" and "flow" in c:
            for li in [x for x in k.kids if isinstance(x, _Node) and x.tag == "li"]:
                spans = [x for x in li.kids if isinstance(x, _Node) and x.tag == "span"]
                label = spans[0] if spans else li
                t = next((x for x in spans if "t" in x.cls), None)
                prefix = "branch: " if "br" in label.cls else "free: " if "fr" in label.cls else ""
                out.append(f"- {prefix}{_md_inline(label).strip()} | {t.text().strip() if t else ''}")
            out.append("")
        elif k.tag in ("ul", "ol"):
            out.append("\n".join(_md_list(k)))
        elif k.tag == "h3":
            out.append(f"### {_md_inline(k).strip()}")
        elif k.tag == "p":
            if "divider" in c:
                out.append("* * *")
            elif "kv" in c:
                out.append(f"~ {_md_inline(k).strip()}")
            else:
                out.append(_md_inline(k).strip())
        elif k.tag == "table":
            out.append(_md_table(k))
        elif k.tag == "div" and "tablewrap" in c:
            t = next(k.find_all(lambda n: n.tag == "table"), None)
            if t is not None:
                out.append(_md_table(t))
        elif k.tag == "div":
            out.append(_md_children(k))
    return "\n\n".join(x for x in out if x is not None and x != "").replace("\n\n\n", "\n\n")


def html_to_plan(html):
    """Turn existing HTML session notes (the layout this app renders) back into plan Markdown."""
    t = _Tree()
    t.feed(html)
    root = t.root
    header = next(root.find_all(lambda n: n.tag == "header"), None)
    h1 = next(root.find_all(lambda n: n.tag == "h1"), None)
    eyebrow = next(root.find_all(lambda n: "eyebrow" in n.cls), None)
    lede = next(root.find_all(lambda n: "lede" in n.cls), None)
    title = h1.text().strip() if h1 else ""
    number = None
    m = re.match(r"^Session\s+(\d+)\s*[:\-–—]\s*(.*)$", title)
    if m:
        number, title = int(m.group(1)), m.group(2).strip()
    sections = list(root.find_all(lambda n: n.tag == "section"))
    meta = {"title": title}
    if eyebrow is not None:
        meta["eyebrow"] = eyebrow.text().strip()
    if lede is not None:
        meta["lede"] = _md_inline(lede).strip()
    nav = {}
    for a in root.find_all(lambda n: n.tag == "a" and (n.attrs.get("href") or "").startswith("#")
                           and n.parent is not None and n.parent.tag == "nav"):
        nav[a.attrs["href"][1:]] = re.sub(r"\s+", " ", a.text()).strip()
    parts = []
    first = None
    for sec in sections:
        head = next(sec.find_all(lambda n: "scene-head" in n.cls), None)
        tag_el = next(head.find_all(lambda n: "tag" in n.cls), None) if head else None
        h2 = next(head.find_all(lambda n: n.tag == "h2"), None) if head else None
        tag = tag_el.text().strip() if tag_el is not None else ""
        kind = next((k for k in ("branch", "divine", "free") if tag_el is not None and k in tag_el.cls), "")
        sid = sec.attrs.get("id", "")
        attrs = []
        sm = re.match(r"^Scene\s+(\d+)$", tag)
        if sid == "glance" or tag.lower() == "prep":
            attrs.append("glance")
        elif sm:
            first = first or int(sm.group(1))
        elif tag:
            attrs.append(f'tag="{tag}"')
        if kind:
            attrs.append("." + kind)
        if sid and not sm and sid != "glance":
            attrs.append("#" + sid)
        title_md = _md_inline(h2).strip() if h2 is not None else "Untitled"
        chip = nav.get(sid)
        if chip:
            plain = re.sub(r"[*\\]", "", title_md)
            num = re.match(r"^s(\d+)$", sid)
            default = (f"{sm.group(1)}. {_short(plain)}" if sm else
                       f"{num.group(1)}. {_short(plain)}" if num and tag else
                       "At a glance" if "glance" in attrs else _short(plain))
            if chip != default:
                attrs.append(f'short="{chip.replace(chr(34), chr(39))}"')
        heading = f"## {title_md}" + (f" {{{' '.join(attrs)}}}" if attrs else "")
        parts.append(heading + "\n\n" + _md_children(sec))
    if first:
        meta["first_scene"] = first
    if header is None and not sections:
        raise ValueError("That file doesn't look like session notes in this layout.")
    return number, frontmatter.dump(meta, "\n\n".join(parts) + "\n")
