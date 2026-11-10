"""Before-session checklist: reminders you tick off before each session.

Reminders "for every session" live in the campaign (campaign.json → checklist). Each session keeps its own
ticks, plus any one-off reminders just for that session (sessions/<id>/checklist.json).
"""
import uuid

from .util import read_json, write_json

STARTERS = ["Start the OBS recording", "Open Foundry and load the first scene", "Read through the plan",
            "Water and snacks within reach"]


def _new_id():
    return uuid.uuid4().hex[:8]


def template(camp):
    return [x for x in (camp.info.get("checklist") or []) if isinstance(x, dict) and x.get("id") and x.get("text")]


def _save_template(camp, items):
    camp.save_info({"checklist": [{"id": x["id"], "text": x["text"]} for x in items]})


def _state_path(camp, sid):
    return camp.session_dir(sid) / "checklist.json"


def _state(camp, sid):
    st = read_json(_state_path(camp, sid), {}) or {}
    return {"done": list(st.get("done") or []), "extra": [x for x in st.get("extra") or [] if x.get("id") and x.get("text")]}


def get(camp, sid):
    """[{id, text, done, once}] for this session: the campaign's reminders, then this session's own."""
    st = _state(camp, sid)
    done = set(st["done"])
    items = [{**x, "done": x["id"] in done, "once": False} for x in template(camp)]
    items += [{**x, "done": x["id"] in done, "once": True} for x in st["extra"]]
    return {"items": items, "left": sum(1 for x in items if not x["done"]), "total": len(items)}


def toggle(camp, sid, item_id, done):
    st = _state(camp, sid)
    s = set(st["done"])
    (s.add if done else s.discard)(item_id)
    st["done"] = sorted(s)
    write_json(_state_path(camp, sid), st)
    return get(camp, sid)


def add(camp, sid, text, every=True):
    text = " ".join(str(text or "").split())[:200]
    if not text:
        raise ValueError("Write the reminder first.")
    item = {"id": _new_id(), "text": text}
    if every or not sid:
        _save_template(camp, template(camp) + [item])
    else:
        st = _state(camp, sid)
        st["extra"].append(item)
        write_json(_state_path(camp, sid), st)
    return get(camp, sid) if sid else {"items": template(camp)}


def remove(camp, sid, item_id):
    t = template(camp)
    if any(x["id"] == item_id for x in t):
        _save_template(camp, [x for x in t if x["id"] != item_id])
    if sid:
        st = _state(camp, sid)
        st["extra"] = [x for x in st["extra"] if x["id"] != item_id]
        st["done"] = [x for x in st["done"] if x != item_id]
        write_json(_state_path(camp, sid), st)
        return get(camp, sid)
    return {"items": template(camp)}


def edit(camp, item_id, text):
    """Reword a reminder for every session (from Settings)."""
    text = " ".join(str(text or "").split())[:200]
    t = template(camp)
    for x in t:
        if x["id"] == item_id and text:
            x["text"] = text
    _save_template(camp, t)
    return {"items": template(camp)}


def move(camp, item_id, step):
    t = template(camp)
    i = next((n for n, x in enumerate(t) if x["id"] == item_id), None)
    if i is not None and 0 <= i + step < len(t):
        t[i], t[i + step] = t[i + step], t[i]
        _save_template(camp, t)
    return {"items": template(camp)}


def start(camp):
    """Turning the checklist on for the first time: begin with a few common reminders to edit or delete."""
    if not template(camp):
        _save_template(camp, [{"id": _new_id(), "text": t} for t in STARTERS])
    return {"items": template(camp)}
