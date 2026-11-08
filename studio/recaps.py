"""Claude jobs for a session: the GM recap, the player recap, and loose threads.

Everything Claude writes is a draft (recap.draft.json) until the GM accepts it.
"""
import re
import time

from . import claude, notify, settings
from .util import Task

GM_MAX = 20000            # output token ceilings: generous, so long sessions are never cut short
PLAYER_MAX = 12000
LORE_BUDGET = 45000        # characters of lore pages sent along with a transcript
PAGE_LIMIT = 2500
KINDS = ["hook", "question", "promise", "debt", "clue", "item", "other"]


def strip_gm(md):
    return re.sub(r"(?ms)^:::[ \t]*gm\b.*?^:::[ \t]*$\n?", "", md or "")


def _cut(text, n):
    text = (text or "").strip()
    return text if len(text) <= n else text[:n].rsplit(" ", 1)[0] + " …"


def relevant_pages(camp, transcript, player_safe):
    """Lore pages the transcript mentions, most-mentioned first, within the budget."""
    names = camp.link_names()
    if not names or not transcript:
        return []
    by_name = dict(names)
    rx = re.compile(r"(?<![\w])(" + "|".join(re.escape(n) for n, _ in names) + r")(?![\w])", re.I)
    lower = {n.lower(): pid for n, pid in names}
    hits = {}
    for m in rx.finditer(transcript):
        pid = by_name.get(m.group(1)) or lower.get(m.group(1).lower())
        if pid:
            hits[pid] = hits.get(pid, 0) + 1
    out, used = [], 0
    pages = {p["id"]: p for p in camp.pages()}
    for pid, _ in sorted(hits.items(), key=lambda kv: -kv[1]):
        p = pages.get(pid)
        if not p or (player_safe and p["visibility"] == "gm"):
            continue
        body = strip_gm(p["body"]) if player_safe else p["body"]
        body = _cut(re.sub(r"\{\{\w+\}\}", "", body), PAGE_LIMIT)
        if used + len(body) > LORE_BUDGET:
            break
        used += len(body)
        out.append((p["title"], body))
    return out


def _previous(camp, sid):
    sessions = [s for s in camp.sessions() if isinstance(s["number"], int)]
    me = next((s for s in sessions if s["id"] == sid), None)
    if not me:
        return None
    earlier = [s for s in sessions if s["number"] < me["number"] and s["status"] == "recapped"]
    return earlier[-1] if earlier else None


def primer(camp, player_safe):
    info = camp.info
    landing = ""
    try:
        landing = camp.read_page("index")["body"]
    except Exception:
        pass
    party = info.get("party") or []
    party_lines = "\n".join(f"- {p.get('character') or '?'}" + (f" (played by {p['player']})" if p.get("player") else "")
                            + (f", speaker label “{p['speaker']}”" if p.get("speaker") else "") for p in party) or "- (not filled in yet)"
    style = (info.get("recap_style") or "").strip()
    spell = camp.spellings()
    spell_text = ", ".join(f"{right} (not {wrong})" for wrong, right in spell.items())
    return (f"You are helping the game master of the tabletop campaign “{camp.name}”.\n\n"
            f"## The setting, from the campaign's landing page\n{_cut(strip_gm(landing) if player_safe else landing, 4000)}\n\n"
            f"## The party\n{party_lines}\n\n"
            + (f"## The GM's style notes for recaps\n{style}\n\n" if style else "")
            + (f"## Correct spellings of names the transcriber gets wrong\n{spell_text}\n\n" if spell_text else "")
            + "## About the transcripts you'll get\n"
              "They are made automatically from the session recording. Names of people and places are often misheard: "
              "always use the spelling from the lore pages. Speaker labels are players or the GM (the GM voices every NPC); "
              "refer to the characters, not the players. Ignore out-of-game chatter, rules lookups and snack breaks.")


def _lore_block(pages):
    if not pages:
        return "(No lore pages matched names in this transcript.)"
    return "\n\n".join(f"### {t}\n{b}" for t, b in pages)


def _session_header(camp, sid):
    s = next(x for x in camp.sessions() if x["id"] == sid)
    return s, f"Session {s['number']}: {s['title']}"


def build_inputs(camp, sid):
    transcript = camp.transcript_text(sid)
    if not transcript:
        raise claude.ClaudeError("This session has no transcript yet.")
    s, head = _session_header(camp, sid)
    prev = _previous(camp, sid)
    prev_recap = ""
    if prev:
        try:
            prev_recap = camp.read_session(prev["id"])["recap"]
        except Exception:
            prev_recap = ""
    notes = (camp.read_session(sid).get("claude_notes") or "").strip()
    live = camp.live_notes_text(sid)
    from . import foundry
    flog = foundry.log_text(camp, sid)
    if flog:
        live = (live + "\n\n" if live else "") + "From Foundry VTT (rolls, chat and combat; times are recording times when known):\n" + flog
    if live:
        notes = (notes + "\n\n" if notes else "") + live
    chapters = camp.read_recording(sid).get("chapters") or []
    chapter_text = "\n".join(f"- {c.get('time', '')} {c.get('name', '')}" for c in chapters)
    return {"session": s, "head": head, "transcript": transcript, "prev": prev, "prev_recap": prev_recap,
            "chapters": chapter_text, "notes": notes, "gm_pages": relevant_pages(camp, transcript, False),
            "player_pages": relevant_pages(camp, transcript, True)}


def estimate(camp, sid):
    inp = build_inputs(camp, sid)
    t = claude.estimate_tokens(inp["transcript"])
    lore = claude.estimate_tokens(_lore_block(inp["gm_pages"]))
    prim = claude.estimate_tokens(primer(camp, False))
    total_in = 3 * (t + prim) + lore + claude.estimate_tokens(_lore_block(inp["player_pages"])) + claude.estimate_tokens(inp["prev_recap"]) * 2
    model = settings.get("recap_model") or claude.DEFAULT_MODEL
    out_tokens = 14000     # what a long, detailed session typically needs for the three replies
    return {"transcript_tokens": t, "input_tokens": total_in, "output_tokens": out_tokens, "calls": 3,
            "lore_pages": len(inp["gm_pages"]), "model": model, "cost": claude.cost(model, total_in, out_tokens)}


GM_TASK = """Write the GM's recap of {head}.

Markdown, in this shape:
## Summary
One paragraph: what the session was about and where it ended.
## What happened
Chronological paragraphs. End each paragraph with a time marker in the form {{t:HH:MM:SS}} giving when that part starts in the transcript.
## People met
Bullet list: each NPC who appeared, one line on what they did or revealed.
## Places
Bullet list of places visited or discussed.
## Loot, rewards and costs
Bullet list (skip the section if there were none).
## For the GM
Bullets: secrets or lore the session touched, promises made, things the players seemed curious about.

Be accurate and specific. Only report what the transcript supports; when unsure, say so briefly. Use names exactly as the lore pages spell them."""

PLAYER_TASK = """Write the recap of {head} that the players will read before next session.

- Tell it as a story in past tense, about the characters.
- Match the voice, format and rough length of the previous recap below (including an opening one-line teaser if it has one).
- Nothing the characters didn't see or learn, no GM-only information, no rules talk, no time markers.
- Use names exactly as the lore pages spell them.
- Output only the recap in Markdown."""

THREADS_TASK = """Find the loose threads in {head}: hooks the party hasn't followed up, open questions, promises made by or to the party, debts, clues not yet understood, notable items not yet used.

Existing threads (id: title) so you can mark progress instead of duplicating them:
{existing}

Call record_threads once. Keep titles short (under 10 words) and details to one or two sentences. Only include things a GM would want to remember next session."""

THREADS_TOOL = {
    "name": "record_threads",
    "description": "Record new, progressed and resolved loose threads from this session.",
    "input_schema": {
        "type": "object",
        "properties": {
            "new": {"type": "array", "items": {"type": "object", "properties": {
                "title": {"type": "string"}, "detail": {"type": "string"},
                "kind": {"type": "string", "enum": KINDS},
                "t": {"type": "string", "description": "HH:MM:SS where it comes up in the transcript"}},
                "required": ["title", "detail", "kind"]}},
            "progressed": {"type": "array", "items": {"type": "object", "properties": {
                "id": {"type": "string"}, "note": {"type": "string"}}, "required": ["id", "note"]}},
            "resolved": {"type": "array", "items": {"type": "object", "properties": {
                "id": {"type": "string"}, "note": {"type": "string"}}, "required": ["id", "note"]}},
        },
        "required": ["new", "progressed", "resolved"],
    },
}


def _context_message(inp, pages, task_text, include_prev):
    parts = [f"<lore>\n{_lore_block(pages)}\n</lore>"]
    if include_prev and inp["prev_recap"]:
        parts.append(f"<previous_recap session=\"{inp['prev']['number']}\">\n{_cut(inp['prev_recap'], 7000)}\n</previous_recap>")
    if inp["chapters"]:
        parts.append(f"<scene_markers>\n{inp['chapters']}\n</scene_markers>")
    if inp.get("notes"):
        parts.append("<gm_notes>\nThe GM's own notes about this session. Treat them as true, and include what they describe "
                     "(for example, events from before the recording started) in their proper place in the story.\n"
                     f"{inp['notes']}\n</gm_notes>")
    parts.append(f"<transcript>\n{inp['transcript']}\n</transcript>")
    parts.append(task_text)
    return [{"role": "user", "content": "\n\n".join(parts)}]


def run_draft(task, camp, sid, parts=("gm", "player", "threads"), opener=None):
    s = settings.load()
    model = s.get("recap_model") or claude.DEFAULT_MODEL
    inp = build_inputs(camp, sid)
    head = inp["head"]
    draft = camp.read_draft(sid) or {}
    redo = bool(draft) and set(parts) != {"gm", "player", "threads"}
    draft.update({"created": time.strftime("%Y-%m-%d %H:%M"), "model": model})
    usage = list(draft.get("usage") or []) if redo else []
    steps = [p for p in ("gm", "player", "threads") if p in parts]
    for i, part in enumerate(steps):
        task.progress = {"stage": part, "done": i, "total": len(steps)}
        if part == "gm":
            task.log("Writing the GM recap…")
            resp = claude.message(model, [{"text": primer(camp, False), "cache": True}],
                                  _context_message(inp, inp["gm_pages"], GM_TASK.format(head=head), True), max_tokens=GM_MAX, opener=opener)
            draft["gm"] = claude.text_of(resp)
        elif part == "player":
            task.log("Writing the player recap…")
            resp = claude.message(model, [{"text": primer(camp, True), "cache": True}],
                                  _context_message(inp, inp["player_pages"], PLAYER_TASK.format(head=head), True), max_tokens=PLAYER_MAX, opener=opener)
            draft["player"] = claude.text_of(resp)
        else:
            task.log("Looking for loose threads…")
            open_threads = [t for t in camp.threads() if t["status"] in ("open", "proposed")]
            existing = "\n".join(f"{t['id']}: {t['title']}" for t in open_threads) or "(none yet)"
            resp = claude.message(model, [{"text": primer(camp, False), "cache": True}],
                                  _context_message(inp, inp["gm_pages"], THREADS_TASK.format(head=head, existing=existing), False),
                                  max_tokens=3000, tools=[THREADS_TOOL], tool_choice={"type": "tool", "name": "record_threads"}, opener=opener)
            found = claude.tool_input(resp, "record_threads") or {}
            draft["threads"] = apply_threads(camp, sid, found)
        cut = set(draft.get("truncated") or [])
        if resp.get("stop_reason") == "max_tokens":
            cut.add(part)
            task.log(f"The {part} part hit the length limit and was cut short.")
        else:
            cut.discard(part)
        draft["truncated"] = sorted(cut)
        usage.append(claude.usage_of(resp))
        camp.write_draft(sid, {**draft, "usage": usage, "cost": claude.cost_of_usage(model, usage)})
    task.progress = {"stage": "done", "done": len(steps), "total": len(steps)}
    task.log("Done. Review the draft on the session's Recap tab.")
    notify.toast("Recap draft ready", head)
    return {"session": sid, "usage": usage}


def apply_threads(camp, sid, found):
    """New threads arrive as 'proposed'; progress and resolutions are suggestions the GM accepts."""
    ids = {t["id"] for t in camp.threads()}
    added = 0
    for n in found.get("new") or []:
        if n.get("title"):
            camp.add_thread(n["title"], n.get("detail", ""), n.get("kind") if n.get("kind") in KINDS else "other",
                            status="proposed", session=sid, t=n.get("t"))
            added += 1
    threads = camp.threads()
    suggested = 0
    for kind in ("progressed", "resolved"):
        for item in found.get(kind) or []:
            if item.get("id") in ids:
                for th in threads:
                    if th["id"] == item["id"]:
                        th["suggestion"] = {"type": "resolve" if kind == "resolved" else "progress",
                                            "note": item.get("note", ""), "session": sid}
                        suggested += 1
    camp.save_threads(threads)
    return {"new": added, "suggestions": suggested}


def start_draft(camp, sid, parts=("gm", "player", "threads")):
    claude.key()
    parts = tuple(p for p in parts if p in ("gm", "player", "threads")) or ("gm", "player", "threads")
    if not camp.read_transcript(sid):
        raise claude.ClaudeError("This session has no transcript yet.")
    task = Task.spawn(f"Drafting the recap of session {camp.session_number(sid)}", run_draft, camp, sid, tuple(parts))
    task.kind = "recap"
    task.session = sid
    return task.id


def accept_draft(camp, sid, gm=None, player=None):
    """Save the (possibly edited) drafts as the session's recaps. The old recap is kept as recap.previous.md."""
    d = camp.session_dir(sid)
    draft = camp.read_draft(sid) or {}
    gm = draft.get("gm") if gm is None else gm
    player = draft.get("player") if player is None else player
    if gm:
        old = d / "recap.md"
        if old.exists():
            old.replace(d / "recap.previous.md")
        camp.write_session_text(sid, "recap", gm)
    if player:
        camp.write_player_recap(sid, player)
    camp.discard_draft(sid)
    return camp.read_session(sid)


SCENE_TASK = """Here is the GM's plan for the next session so far, in Lore Studio's plan format:

<plan>
{plan}
</plan>

{idea}

Write ONE new scene for this session that fits the plan, the lore and the open threads. Use exactly this format and nothing else:

## Scene title
:::read
Two to five sentences of read-aloud description.
Speaker: "A line of dialogue."
:::

GM notes: what the party can learn or do, as a short list. Under a bullet, an indented line starting with "> " is something an NPC might say.

:::note
**Secret.** One thing the players don't know yet.
:::

Use names exactly as the lore spells them. Keep it playable at the table: specific, short, no padding."""


def suggest_scene(camp, sid, idea="", opener=None):
    """Claude drafts one scene in plan format, using the plan so far, open threads and relevant lore."""
    model = settings.get("recap_model") or claude.DEFAULT_MODEL
    d = camp.session_dir(sid)
    plan = (d / "plan.md").read_text(encoding="utf-8") if (d / "plan.md").exists() else ""
    threads = [t for t in camp.threads() if t["status"] == "open"]
    thread_text = "\n".join(f"- {t['title']}: {t.get('detail', '')}" for t in threads[:25]) or "(none)"
    pages = relevant_pages(camp, plan + " " + idea, False)
    prev = _previous(camp, sid)
    prev_recap = camp.read_session(prev["id"])["recap"] if prev else ""
    content = (f"<lore>\n{_lore_block(pages)}\n</lore>\n\n"
               + (f"<previous_recap>\n{_cut(prev_recap, 5000)}\n</previous_recap>\n\n" if prev_recap else "")
               + f"<open_threads>\n{thread_text}\n</open_threads>\n\n"
               + SCENE_TASK.format(plan=_cut(plan, 20000) or "(empty)", idea=f"The GM's idea for the scene: {idea}" if idea.strip() else ""))
    resp = claude.message(model, [{"text": primer(camp, False), "cache": True}], [{"role": "user", "content": content}],
                          max_tokens=3000, opener=opener)
    text = claude.text_of(resp).strip()
    text = re.sub(r"^```\w*\n|\n```$", "", text)
    usage = claude.usage_of(resp)
    return {"text": text, "cost": claude.cost_of_usage(model, [usage]), "model": model}
