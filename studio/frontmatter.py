"""Tiny YAML-style frontmatter for Markdown pages, with no dependencies.

Supports what lore pages need and nothing more:

    ---
    title: John Doe
    aliases: [John, "the Quiet One"]
    tags: [character, westmarch]
    visibility: players
    order: 3
    ---
    Body text...

Values are strings, numbers, true/false, or one-line [lists]. Anything fancier is kept as a string,
so a page written in Obsidian with extra keys still round-trips without losing them.
"""
import json
import re

_PLAIN = re.compile(r"^[\w\- .'’/()&,!?]+$", re.UNICODE)


def parse(text):
    """Split a page into (meta, body). Pages without frontmatter get empty meta."""
    if not text.startswith("---"):
        return {}, text
    m = re.match(r"^---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|$)", text, re.S)
    if not m:
        return {}, text
    meta = {}
    for line in m.group(1).splitlines():
        if not line.strip() or line.lstrip().startswith("#") or ":" not in line:
            continue
        key, _, raw = line.partition(":")
        key = key.strip()
        if key:
            meta[key] = _value(raw.strip())
    body = text[m.end():]
    if body.startswith("\r\n"):
        body = body[2:]
    elif body.startswith("\n"):
        body = body[1:]
    return meta, body


def _value(raw):
    if raw == "":
        return ""
    if raw.startswith("[") and raw.endswith("]"):
        return [_value(x) for x in _split_list(raw[1:-1])]
    if raw.startswith('"') and raw.endswith('"') and len(raw) >= 2:
        try:
            return json.loads(raw)
        except ValueError:
            return raw[1:-1]
    if raw.startswith("'") and raw.endswith("'") and len(raw) >= 2:
        return raw[1:-1].replace("''", "'")
    if raw in ("true", "false"):
        return raw == "true"
    if re.fullmatch(r"-?\d+", raw):
        return int(raw)
    if re.fullmatch(r"-?\d+\.\d+", raw):
        return float(raw)
    return raw


def _split_list(s):
    out, cur, q = [], "", None
    for ch in s:
        if q:
            cur += ch
            if ch == q:
                q = None
        elif ch in "\"'":
            q = ch
            cur += ch
        elif ch == ",":
            out.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip())
    return [x for x in out if x != ""]


def _dump_value(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(_dump_scalar(x, in_list=True) for x in v) + "]"
    return _dump_scalar(v)


def _dump_scalar(v, in_list=False):
    if isinstance(v, bool) or isinstance(v, (int, float)):
        return _dump_value(v)
    s = str(v)
    risky = (not s or not _PLAIN.match(s) or s != s.strip() or s in ("true", "false")
             or re.fullmatch(r"-?\d+(\.\d+)?", s) or (in_list and "," in s) or s[0] in "-'")
    return json.dumps(s, ensure_ascii=False) if risky else s


def dump(meta, body):
    """Join meta and body back into page text. Keys with empty values are left out."""
    lines = [f"{k}: {_dump_value(v)}" for k, v in meta.items() if v not in (None, "", [])]
    body = body.lstrip("\n")
    if not lines:
        return body
    return "---\n" + "\n".join(lines) + "\n---\n\n" + body
