"""Core checks: frontmatter, campaign folders, the lore index and the LegendKeeper importer.
Run with:  python -m pytest -q tests"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from studio import campaign, frontmatter, legendkeeper  # noqa: E402


def test_frontmatter_round_trip():
    meta = {"title": "John Doe", "tags": ["character", "westmarch"], "aliases": ["Johnny, the Quiet"],
            "order": 3, "visibility": "gm", "banner": "https://example.com/a.jpg"}
    text = frontmatter.dump(meta, "Body with: colons\n")
    back, body = frontmatter.parse(text)
    assert back == meta
    assert body == "Body with: colons\n"


def test_frontmatter_without_header():
    assert frontmatter.parse("just text") == ({}, "just text")


@pytest.fixture
def camp(tmp_path):
    return campaign.create(tmp_path / "Camp", "Test Campaign")


def test_create_and_tree(camp):
    assert camp.name == "Test Campaign"
    r = camp.create_page(None, "Characters")
    assert r["id"] == "Characters"
    kid = camp.create_page("Characters", "John Doe")
    # the plain page became a folder page when it got a subpage
    assert kid["id"] == "Characters/John Doe"
    assert (camp.lore / "Characters" / "index.md").exists()
    tree = camp.tree()
    top = next(n for n in tree["children"] if n["title"] == "Characters")
    assert [c["title"] for c in top["children"]] == ["John Doe"]
    assert camp.children("Characters/index")[0]["id"] == "Characters/John Doe"


def test_write_read_search_and_backlinks(camp):
    camp.create_page(None, "Characters")
    camp.create_page("Characters", "John Doe")
    camp.write_page("Characters/John Doe", {"title": "John Doe", "tags": ["character"]}, "A relaxed leader.")
    camp.create_page(None, "Westmarch")
    camp.write_page("Westmarch", {"title": "Westmarch", "tags": ["location"]}, "John leads here. See [[John Doe]].")
    page = camp.read_page("Characters/John Doe")
    assert page["meta"]["tags"] == ["character"]
    assert [p["id"] for p in page["backlinks"]["pages"]] == ["Westmarch"]
    assert camp.search("#character")[0]["id"] == "Characters/John Doe"
    assert camp.search("relaxed")[0]["title"] == "John Doe"
    assert {"tag": "location", "count": 1} in camp.tags()
    g = camp.graph()
    assert ["Characters/John Doe", "Westmarch"] in g["edges"]


def test_stale_write_is_refused(camp):
    p = camp.read_page("index")
    camp.write_page("index", p["meta"], "first")
    with pytest.raises(campaign.CampaignError):
        camp.write_page("index", p["meta"], "second", expected_mtime=p["mtime"] - 10)


def test_bad_ids_are_refused(camp):
    for bad in ("../campaign", "/etc/passwd", ""):
        with pytest.raises(campaign.CampaignError):
            camp.read_page(bad)
    assert camp.file_for_url("../../etc/passwd") is None


def test_sessions(camp):
    sid = camp.create_session("The Drowned Chapel", 23)
    assert sid == "023-the-drowned-chapel"
    camp.write_session_text(sid, "recap", "They crossed the bridge.")
    s = camp.read_session(sid)
    assert s["status"] == "recapped" and s["number"] == 23
    camp.delete_session(sid)
    assert camp.session_list() == []


def _export(tmp_path):
    def para(text, marks=()):
        return {"type": "paragraph", "content": [{"type": "text", "text": text, "marks": [{"type": m} for m in marks]}]}

    def res(rid, name, parent, content, **kw):
        return {"id": rid, "name": name, "parentId": parent, "pos": kw.pop("pos", "a"), "tags": [], "aliases": [],
                "isHidden": False, "documents": [{"type": "page", "name": "Main", "pos": "a", "content": {"type": "doc", "content": content}}], **kw}
    data = {"resources": [
        res("root", "Campaign Landing", None, [para("Welcome"), {"type": "extension", "attrs": {"extensionKey": "block-resource-collection"}}]),
        res("chars", "Characters", "root", [para("People")], pos="b"),
        res("john", "John Doe", "chars", [
            {"type": "panel", "content": [para("Quiet", ["em"])]},
            {"type": "bodiedExtension", "attrs": {"extensionKey": "block-secret"}, "content": [para("Secret plan")]},
        ]),
        res("log", "Campaign Log", "root", [para("The log")], pos="c"),
        res("s0", "0. The Better Job", "log", [para("They met.")]),
        res("tmpl", "Character", None, [para("Template")]),
    ], "calendars": [{"id": "c1", "name": "Eldorian"}]}
    p = tmp_path / "Sunken_Crown.json"
    p.write_text(json.dumps(data), encoding="utf-8")
    return p


def test_legendkeeper_import(tmp_path):
    src = _export(tmp_path)
    s = legendkeeper.summarize(src)
    assert s["sessions"] == 1 and s["main"] == "Campaign Landing" and s["templates"] == ["Character"]
    out = legendkeeper.import_project(src, tmp_path / "Imported", "The Sunken Crown", log=lambda *a: None)
    assert out["sessions"] == 1 and out["secrets"] == 1
    c = campaign.Campaign(tmp_path / "Imported")
    john = c.read_page("Characters/John Doe")
    assert ":::gm\nSecret plan\n:::" in john["body"]
    assert ":::callout\n*Quiet*\n:::" in john["body"]
    assert john["meta"]["tags"] == ["character"]
    assert "{{children}}" in c.read_page("index")["body"]
    assert "{{sessions}}" in c.read_page("Campaign Log")["body"]
    assert c.session_list()[0]["number"] == 0
    assert (tmp_path / "Imported" / "templates" / "Character.md").exists()
    assert (tmp_path / "Imported" / "calendar.json").exists()


def test_diagnostics_never_include_secrets_or_campaign_text(tmp_path, monkeypatch):
    monkeypatch.setenv("LORE_STUDIO_HOME", str(tmp_path / "home"))
    from studio import campaign, diagnostics, settings
    from studio.util import Task
    settings.save({"anthropic_api_key": "sk-ant-secret-value-123", "obs_password": "hunter2-obs", "hf_token": "hf_abcdefghijklmnopqrst"})
    camp = campaign.create(tmp_path / "camp", "John Doe's Campaign")
    camp.write_page("Characters/Jane Roe", {"title": "Jane Roe"}, "Jane secretly owns the lighthouse.")
    t = Task("Something broke")
    t.log("POST https://discord.com/api/webhooks/123/abcDEF with sk-ant-secret-value-123 and hunter2-obs")
    t.finish(ok=False)
    text = diagnostics.report(camp, native=True)
    for leak in ["sk-ant-secret", "hunter2-obs", "hf_abcdefgh", "webhooks/123", "lighthouse", "Jane Roe"]:
        assert leak not in text, leak
    assert "Version:" in text and "API key set" in text and "Something broke" in text and "[hidden]" in text


def test_speaker_change_splits_a_line_at_the_word():
    from studio.workers.transcribe import assign_speakers
    turns = [(0, 1.2, "SPEAKER_00"), (1.3, 4, "SPEAKER_01")]
    seg = {"start": 0, "end": 3, "speaker": "Players", "text": "Sure. I attack the goblin.",
           "words": [(0, .5, " Sure."), (1.4, 1.6, " I"), (1.6, 2, " attack"), (2, 2.2, " the"), (2.2, 3, " goblin.")]}
    out = assign_speakers([seg], turns, "Players")
    assert [(s["speaker"], s["text"]) for s in out] == [("Players 00", "Sure."), ("Players 01", "I attack the goblin.")]
    # one quick word inside someone else's sentence is a timing wobble, not a new speaker
    wobble = [(1.3, 1.6, "SPEAKER_01"), (1.6, 1.75, "SPEAKER_00"), (1.75, 4, "SPEAKER_01")]
    seg = {"start": 1.3, "end": 3, "speaker": "Players", "text": "", "words": [(1.3, 1.6, " I"), (1.6, 1.7, " uh"), (1.8, 3, " go")]}
    assert [(s["speaker"], s["text"]) for s in assign_speakers([seg], wobble, "Players")] == [("Players 01", "I uh go")]
    # without word timings, the whole line goes to whoever talks most in it
    assert assign_speakers([{"start": 1, "end": 3, "speaker": "P", "text": "x"}], turns, "")[0]["speaker"] == "SPEAKER_01"


def test_before_session_checklist(tmp_path, monkeypatch):
    monkeypatch.setenv("LORE_STUDIO_HOME", str(tmp_path / "home"))
    from studio import api as api_mod
    a = api_mod.Api()
    a.create_campaign(str(tmp_path / "Camp"), "John Doe's Game")
    s1, s2 = a.new_session("One", 1), a.new_session("Two", 2)
    starters = a.checklist_start()["items"]
    assert len(starters) >= 3 and a.checklist_start()["items"] == starters      # starting twice doesn't double up
    st = a.checklist_add(s1, "Print Jane Roe's handout", every=False)        # just this session
    once = next(x for x in st["items"] if x["once"])
    st = a.checklist_toggle(s1, starters[0]["id"], True)
    st = a.checklist_toggle(s1, once["id"], True)
    assert st["total"] == len(starters) + 1 and st["left"] == len(starters) - 1
    # session two: fresh ticks, no one-off reminder from session one
    st2 = a.checklist(s2)
    assert st2["total"] == len(starters) and st2["left"] == len(starters)
    # reminders for every session can be added, reworded, moved and removed
    a.checklist_add(None, "Charge the headphones", every=True)
    last = a.checklist_template()["items"][-1]
    a.checklist_edit(last["id"], "Charge the headphones and mic")
    items = a.checklist_move(last["id"], -1)["items"]
    assert items[-2]["text"] == "Charge the headphones and mic"
    a.checklist_remove(None, starters[0]["id"])
    assert starters[0]["id"] not in [x["id"] for x in a.checklist(s1)["items"]]
    with pytest.raises(Exception):
        a.checklist_add(s1, "   ")


def test_models_that_refuse_forced_tools_still_answer(monkeypatch):
    """Some models answer 400 to tool_choice "tool"; Lore Studio asks in words instead, and remembers."""
    import io, json as _json, urllib.error
    from studio import claude
    monkeypatch.setattr(claude, "key", lambda: "sk-ant-test")
    seen = []

    def opener(req, timeout=None):
        body = _json.loads(req.data)
        seen.append(body.get("tool_choice"))
        if body.get("tool_choice", {}).get("type") == "tool":
            raise urllib.error.HTTPError(req.full_url, 400, "Bad Request", {}, io.BytesIO(_json.dumps(
                {"error": {"message": 'tool_choice: type "tool" and "any" are not supported for this model.'}}).encode()))
        assert "Answer only by calling the suggest_tags tool" in body["system"][-1]["text"]
        reply = {"content": [{"type": "text", "text": 'Here you go: {"tags": ["harbour", "John Doe"]}'}], "usage": {}}
        return type("R", (), {"__enter__": lambda s: s, "__exit__": lambda s, *a: None, "read": lambda s: _json.dumps(reply).encode()})()

    tool = {"name": "suggest_tags", "input_schema": {"type": "object"}}
    for _ in range(2):
        r = claude.message("claude-test-model", ["Tag it."], [{"role": "user", "content": "x"}], tools=[tool],
                           tool_choice={"type": "tool", "name": "suggest_tags"}, opener=opener)
        assert claude.tool_input(r, "suggest_tags") == {"tags": ["harbour", "John Doe"]}
    assert seen == [{"type": "tool", "name": "suggest_tags"}, {"type": "auto"}, {"type": "auto"}]   # the refusal happens once
