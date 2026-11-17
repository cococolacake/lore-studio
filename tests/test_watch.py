"""Files changed outside Lore Studio are reported; Lore Studio's own saves are not."""
import subprocess
import sys
import time

from studio import campaign, watch


def external_write(path, text):
    """Write a file from another process, like the Claude app or a text editor would."""
    subprocess.run([sys.executable, "-c", "import sys; open(sys.argv[1], 'w', encoding='utf-8').write(sys.argv[2])", str(path), text], check=True)


def test_watcher(tmp_path, monkeypatch):
    monkeypatch.setenv("LORE_STUDIO_HOME", str(tmp_path / "home"))
    watch.install()
    camp = campaign.create(tmp_path / "C", "C")
    camp.write_page("Westmarch", {"title": "Westmarch"}, "A windy region.")
    sid = camp.create_session("The Vault", 1)
    w = watch.Watcher(camp)
    poll = lambda: (time.sleep(0.05), w.poll(min_gap=0))[1]

    # Lore Studio's own saves, renames and deletes are quiet
    camp.write_page("Westmarch", {"title": "Westmarch"}, "Edited in Lore Studio.")
    camp.write_session_text(sid, "recap", "We robbed a bank.")
    camp.write_page("Millbrook", {"title": "Millbrook"}, "A town.")
    assert poll() == []
    (camp.lore / "Millbrook.md").unlink()
    assert poll() == []

    # another program edits a page, adds one, and edits a session's recap
    external_write(camp.lore / "Westmarch.md", "---\ntitle: Westmarch\n---\nRewritten by the Claude app.")
    external_write(camp.lore / "Saltreach.md", "---\ntitle: Saltreach\n---\nNew town.")
    external_write(camp.sessions_dir / sid / "recap.md", "A better recap.")
    evs = poll()
    assert [(e["kind"], e["id"], e["change"]) for e in evs] == [("page", "Saltreach", "added"), ("page", "Westmarch", "changed"), ("session", sid, "changed")]
    assert evs[1]["title"] == "Westmarch" and evs[2]["title"] == "Session 1: The Vault (recap)" and evs[2]["file"] == "recap"
    assert w.since(evs[0]["seq"] - 1)["events"] == evs and w.since(w.seq)["events"] == []

    # Lore Studio saving right after an outside edit is still quiet, and the outside edit was reported once
    camp.write_page("Saltreach", {"title": "Saltreach"}, "Tidied.")
    assert poll() == []
