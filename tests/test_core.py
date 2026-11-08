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
