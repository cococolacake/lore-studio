"""Post a player recap to Discord through a channel webhook (standard library only).

Nothing is posted without the GM pressing Post in the preview. Settings live in campaign.json under "discord".
"""
import json
import re
import time
import urllib.error
import urllib.request

from . import __version__

DEFAULTS = {
    "webhooks": [],                     # [{"name": "#recaps", "url": "https://discord.com/api/webhooks/..."}]
    "username": "",                     # who the post appears from ("" = the webhook's own name)
    "avatar_url": "",
    "style": "embed",                   # embed | plain
    "color": "#9381FF",
    "title": "Session {number}: {title}",
    "header": "",                       # text above the recap (plain style) / embed author line
    "footer": "{campaign} · {date}",
    "ping_role": "",                    # a role id to mention, e.g. 123456789012345678
    "spoiler": False,                   # wrap the recap in || spoiler tags ||
}
EMBED_LIMIT = 4000                      # Discord allows 4096 in an embed description
PLAIN_LIMIT = 1900                      # and 2000 in a message
URL_RX = re.compile(r"^https://(?:(?:ptb|canary)\.)?discord(?:app)?\.com/api/webhooks/\d+/[\w-]+$")


def config(camp):
    return {**DEFAULTS, **(camp.info.get("discord") or {})}


def valid_url(url):
    return bool(URL_RX.match((url or "").strip()))


def to_discord_markdown(md):
    """Lore Studio Markdown -> what Discord shows well."""
    md = re.sub(r"(?ms)^:::[ \t]*gm\b.*?^:::[ \t]*$\n?", "", md or "")                  # never post GM blocks
    md = re.sub(r"(?m)^:::[ \t]*\w+[ \t]*(.*)$", lambda m: f"**{m.group(1)}**" if m.group(1) else "", md)
    md = re.sub(r"(?m)^:::[ \t]*$", "", md)
    md = re.sub(r"\{t:\d{1,2}:\d{2}:\d{2}\}", "", md)                              # transcript time markers
    md = re.sub(r"\{\{\s*\w+\s*\}\}", "", md)
    md = re.sub(r"\[\[([^\]|]+)\|([^\]]+)\]\]", r"\2", md)
    md = re.sub(r"\[\[([^\]]+)\]\]", r"\1", md)
    md = md.replace("<u>", "__").replace("</u>", "__")
    md = re.sub(r"(?m)^#{4,6}\s+(.*)$", r"**\1**", md)        # Discord only knows #, ## and ###
    md = re.sub(r"\n{3,}", "\n\n", md)
    return md.strip()


def split(text, limit):
    """Split at paragraph breaks (then lines, then words) so no part is longer than limit."""
    parts, cur = [], ""
    for para in text.split("\n\n"):
        piece = para if not cur else "\n\n" + para
        if len(cur) + len(piece) <= limit:
            cur += piece
            continue
        if cur:
            parts.append(cur)
            cur = ""
        while len(para) > limit:
            cut = para.rfind("\n", 0, limit)
            if cut < limit // 2:
                cut = para.rfind(" ", 0, limit)
            if cut <= 0:
                cut = limit
            parts.append(para[:cut].rstrip())
            para = para[cut:].lstrip()
        cur = para
    if cur:
        parts.append(cur)
    return parts


def _fill(template, values):
    out = template or ""
    for k, v in values.items():
        out = out.replace("{" + k + "}", str(v if v is not None else ""))
    return out.strip(" ·-")


def build(camp, session, text, cfg=None):
    """The messages to send, in order: [{"content", "embeds", ...}]. Shown in the preview as-is."""
    cfg = {**config(camp), **(cfg or {})}
    values = {"number": session.get("number", ""), "title": session.get("title", ""), "campaign": camp.name,
              "date": session.get("date_label") or session.get("date") or time.strftime("%Y-%m-%d"), "world_date": session.get("in_world_date", "")}
    body = to_discord_markdown(text)
    title = _fill(cfg["title"], values)[:256]
    footer = _fill(cfg["footer"], values)[:2048]
    header = _fill(cfg["header"], values)
    ping = f"<@&{cfg['ping_role'].strip()}>" if str(cfg.get("ping_role") or "").strip().isdigit() else ""
    base = {"allowed_mentions": {"parse": [], "roles": [cfg["ping_role"].strip()] if ping else []}}
    if cfg.get("username"):
        base["username"] = cfg["username"][:80]
    if cfg.get("avatar_url"):
        base["avatar_url"] = cfg["avatar_url"]
    messages = []
    if cfg["style"] == "plain":
        lead = "\n".join(x for x in (ping, f"**{title}**" if title else "", header) if x)
        chunks = split(body, PLAIN_LIMIT - len(lead) - 8)
        for i, c in enumerate(chunks):
            content = (lead + "\n\n" if i == 0 and lead else "") + (f"||{c}||" if cfg.get("spoiler") else c)
            if i == len(chunks) - 1 and footer:
                content += f"\n-# {footer}"
            messages.append({**base, "content": content})
        return messages
    try:
        color = int(str(cfg.get("color") or "#9381FF").lstrip("#"), 16)
    except ValueError:
        color = 0x9381FF
    chunks = split(body, EMBED_LIMIT - 8)
    for i, c in enumerate(chunks):
        embed = {"description": f"||{c}||" if cfg.get("spoiler") else c, "color": color}
        if i == 0 and title:
            embed["title"] = title
        if i == 0 and header:
            embed["author"] = {"name": header[:256]}
        if i == len(chunks) - 1 and footer:
            embed["footer"] = {"text": footer}
        msg = {**base, "embeds": [embed]}
        if i == 0 and ping:
            msg["content"] = ping
        messages.append(msg)
    return messages


def post(url, messages, opener=None):
    """Send the messages in order. Returns the posted message ids."""
    if not valid_url(url):
        raise ValueError("That doesn't look like a Discord webhook URL (Channel settings → Integrations → Webhooks).")
    opener = opener or urllib.request.urlopen
    ids = []
    for msg in messages:
        req = urllib.request.Request(url + "?wait=true", data=json.dumps(msg).encode(), method="POST", headers={
            "Content-Type": "application/json",
            "User-Agent": f"DiscordBot (https://github.com/cococolacake/lore-studio, {__version__})",
        })
        for attempt in range(3):
            try:
                with opener(req, timeout=30) as r:
                    data = json.loads(r.read().decode() or "{}")
                    ids.append(data.get("id"))
                    break
            except urllib.error.HTTPError as e:
                body = ""
                try:
                    body = e.read().decode()
                except Exception:
                    pass
                if e.code == 429 and attempt < 2:
                    try:
                        time.sleep(float(json.loads(body).get("retry_after", 2)))
                    except ValueError:
                        time.sleep(2)
                    continue
                raise RuntimeError(f"Discord refused the post ({e.code}). {body[:200]}") from None
            except urllib.error.URLError as e:
                raise RuntimeError(f"Couldn't reach Discord: {e.reason}") from None
        time.sleep(0.4)
    return ids
