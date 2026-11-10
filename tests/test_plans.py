"""Session plans: rendering, numbering, carry-over, importing HTML notes."""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from studio import plans  # noqa: E402

PLAN = '''---
title: The Drowned Chapel
eyebrow: The Sunken Crown · Harbour Arc
lede: The tide goes out, and the chapel comes back up.
first_scene: 6
---

## Session at a glance {glance}
- Mira at night | 10 min
- branch: The backward path | 10 min
- free: Free time | flex

:::cast
**The Lantern Watch** Mira (scout), Bram.
:::

## Mira Returns
:::read
The frogs have stopped.
Mira: "Don't wake the others."
~ Constitution save, DC 13.
:::

- **Why they're here.**
  > I read Mira's memory of you.
  >> We see it.
- Plain bullet

:::note
**Secret: the fox.** It has seven tails.
:::

## The Backward Path {.branch tag="Branch" #s7}
:::divine Read aloud · Metanoea
Metanoea: "Peace, child."
:::

## The Sanctuary
:::pc Scarlett
~ Theme: worth
:::lines gold
What do you hold onto?
:::
:::

:::act The Archive | Keeper Anvaya
- Old maps.
:::

| Item | Price |
|---|---|
| Seed | 50 gp |
'''


def test_render_structure():
    html = plans.render(PLAN, "The Sunken Crown", 23)
    assert "<h1>Session 23: The Drowned Chapel</h1>" in html
    nav = re.findall(r'<a href="#([^"]+)">([^<]+)</a>', re.search(r"<nav[^>]*>(.*?)</nav>", html).group(1))
    assert nav == [("glance", "At a glance"), ("s6", "6. Mira Returns"), ("s7", "7. Backward Path"), ("s8", "8. Sanctuary")]
    assert html.count('<ol class="flow">') == 1 and 'class="br"' in html and 'class="fr"' in html
    assert '<span class="sp">Mira</span><span class="say">' in html and '<p class="kv">Constitution save, DC 13.</p>' in html
    assert '<div class="lines"><p>I read Mira' in html and '<div class="lines gold"><p>We see it.' in html
    assert 'class="read gold alt" data-label="Read aloud · Metanoea"' in html
    assert '<div class="pc"><h3>Scarlett</h3><p class="kv">Theme: worth</p>' in html
    assert '<details class="act"><summary><span class="nm">The Archive</span>' in html
    assert "<table>" in html and '<div class="note">' in html and '<div class="cast"><div><b>The Lantern Watch</b>' in html


def test_html_round_trip_is_stable():
    html = plans.render(PLAN, "The Sunken Crown", 23)
    number, md = plans.html_to_plan(html)
    assert number == 23
    again = plans.render(md, "The Sunken Crown", 23)
    strip = lambda h: re.sub(r"\s+", " ", re.sub(r"<style>.*?</style>", "", h, flags=re.S))
    assert strip(again) == strip(html)


def test_carry_over_keeps_numbers():
    text = plans.carry_over(PLAN, {"s7", "s8"}, "Leaving the Grove")
    titles = plans.scene_titles(text)
    assert [t["title"] for t in titles] == ["The Backward Path", "The Sanctuary"]
    assert 'href="#s8">8. Sanctuary' in plans.render(text)


def test_template_renders():
    html = plans.render(plans.TEMPLATE.format(title="New", campaign="C", previously="They met."), "C", 24)
    assert "Session 24: New" in html and "They met." in html


def test_escaping():
    html = plans.render("---\ntitle: <script>x</script>\n---\n## A <b>\n:::read\nMal: \"<img src=x onerror=alert(1)>\"\n:::\n")
    assert "<script>x" not in html and "<img src=x" not in html


def test_live_mode_state_and_notes(tmp_path, monkeypatch):
    monkeypatch.setenv("LORE_STUDIO_HOME", str(tmp_path / "home"))
    from studio import api as api_mod, campaign, recaps
    camp = campaign.create(tmp_path / "Camp", "Demo")
    a = api_mod.Api()
    a._campaign = camp
    sid = camp.create_session("The Sunken Crown", 3)
    a.save_plan(sid, PLAN)
    st = a.live_state(sid)
    assert st["live"]["current"] == "s6"              # first real scene, saved
    a.live_note(sid, "The rogue pocketed the key", "Mira Returns")
    assert a.live_state(sid)["live"]["current"] == "s6"
    a.live_update(sid, {"current": "s7", "ticks": {"s6": [0]}, "ticked_text": {"s6": ["Why they're here."]}})
    text = camp.live_notes_text(sid)
    assert "Scenes the GM opened during play, in order: The Backward Path" in text and "Why they're here." in text and "pocketed the key" in text
    # opening a scene doesn't finish it; you do, and you can take it back
    assert a.live_state(sid)["live"].get("finished", []) == []
    a.live_update(sid, {"finished": {"s7": True, "s6": True}})
    a.live_update(sid, {"finished": {"s7": False}})
    live = a.live_update(sid, {"finished": {"s6": True}})
    assert live["finished"] == ["s6"] and live["finished_titles"] == ["Mira Returns"]
    text = camp.live_notes_text(sid)
    assert "Scenes the GM marked as played: Mira Returns" in text and "opened but didn't mark as played" in text and "The Backward Path" in text
    html = a.live_scene(sid, "s6")
    assert "Mira Returns" in html and "<nav" not in html


def test_stat_blocks_render_and_survive_conversion():
    md = """---
title: The Cellar
---

## The Fight

:::stat Goblin Boss | Small humanoid · AC 17 · HP 21 · Speed 30 ft
**Multiattack.** Two scimitar attacks.

**Redirect Attack.** When hit, it swaps places with a goblin within 5 ft.
:::
"""
    html = plans.render(md, "The Sunken Crown", 3)
    assert '<div class="stat"><span class="nm">Goblin Boss</span><span class=ln>Small humanoid · AC 17 · HP 21 · Speed 30 ft</span>' in html
    _, back = plans.html_to_plan(html)
    assert ":::stat Goblin Boss | Small humanoid · AC 17 · HP 21 · Speed 30 ft" in back and "**Redirect Attack.**" in back
