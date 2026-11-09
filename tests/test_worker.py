"""End-to-end check of the transcription pipeline on a real multi-track video, with a stand-in Whisper model.

Needs PyAV and ffmpeg (skipped otherwise). The fake faster_whisper module returns one line per
two seconds of non-silent audio, so the test covers decoding, track selection, speaker labels,
merging, the output files and the app's job queue, everything except the model itself.
"""
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

av = pytest.importorskip("av")
if not shutil.which("ffmpeg"):
    pytest.skip("ffmpeg not installed", allow_module_level=True)

FAKE = '''
import numpy as np
class Seg:
    def __init__(s, a, b, t): s.start, s.end, s.text = a, b, t
class Info:
    def __init__(s, d): s.duration = d
class WhisperModel:
    def __init__(self, *a, **k): pass
class BatchedInferencePipeline:
    def __init__(self, model): pass
    def transcribe(self, audio, **kw):
        sr = 16000
        loud = [i for i in range(0, len(audio) - sr, 2 * sr) if np.abs(audio[i:i + 2 * sr]).mean() > 0.01]
        hot = kw.get("hotwords", "")
        segs = [Seg(i / sr, i / sr + 1.5, f"line at {i // sr}s {hot.split()[0] if hot else ''}") for i in loud]
        return iter(segs), Info(len(audio) / sr)
'''


@pytest.fixture(scope="module")
def video(tmp_path_factory):
    d = tmp_path_factory.mktemp("rec")
    out = d / "session.mp4"
    # track 1: mix, track 2: GM (tone in the first 4 s), track 3: players (tone in the last 4 s)
    cmd = ["ffmpeg", "-loglevel", "error", "-y",
           "-f", "lavfi", "-i", "color=c=black:s=64x64:d=8",
           "-f", "lavfi", "-i", "sine=frequency=440:duration=8",
           "-f", "lavfi", "-i", "sine=frequency=300:duration=4,apad=whole_dur=8",
           "-f", "lavfi", "-i", "aevalsrc=if(gt(t\\,4)\\,0.3*sin(2*PI*500*t)\\,0):s=48000:d=8",
           "-map", "0:v", "-map", "1:a", "-map", "2:a", "-map", "3:a", "-c:v", "libx264", "-c:a", "aac", "-shortest", str(out)]
    subprocess.run(cmd, check=True)
    return out


@pytest.fixture
def fake_whisper(tmp_path, monkeypatch):
    pkg = tmp_path / "fakes" / "faster_whisper"
    pkg.mkdir(parents=True)
    (pkg / "__init__.py").write_text(FAKE)
    monkeypatch.setenv("PYTHONPATH", str(tmp_path / "fakes"))
    return tmp_path / "fakes"


def test_probe_and_decode(video):
    from studio.workers import transcribe as w
    info = w.probe(str(video))
    assert len(info["audio"]) == 3 and 7.5 < info["duration"] < 8.6
    gm = w.load_track(str(video), 1)
    assert 7.5 * 16000 < len(gm) < 8.6 * 16000
    assert abs(gm[: 3 * 16000]).mean() > 0.01 and abs(gm[-3 * 16000:]).mean() < 0.01


def test_worker_run(video, tmp_path, fake_whisper):
    job = {"input": str(video), "out_dir": str(tmp_path / "out"), "hotwords": "Westmarch Doe",
           "tracks": [{"stream": 1, "speaker": "GM"}, {"stream": 2, "speaker": "Players"}]}
    jf = tmp_path / "job.json"
    jf.write_text(json.dumps(job))
    env = {**os.environ, "PYTHONPATH": str(fake_whisper)}
    p = subprocess.run([sys.executable, str(ROOT / "studio/workers/transcribe.py"), "run", str(jf)], capture_output=True, text=True, env=env)
    assert p.returncode == 0, p.stdout + p.stderr
    events = [json.loads(ln[2:]) for ln in p.stdout.splitlines() if ln.startswith("@@")]
    assert events[-1]["type"] == "done"
    data = json.loads((tmp_path / "out" / "transcript.json").read_text())
    speakers = [s["speaker"] for s in data["segments"]]
    assert speakers[0] == "GM" and speakers[-1] == "Players"          # GM talks first, players later
    assert all("Westmarch" in s["text"] for s in data["segments"])        # glossary reached the model
    assert (tmp_path / "out" / "transcript.srt").exists()


def test_worker_reports_missing_track(video, tmp_path, fake_whisper):
    jf = tmp_path / "job.json"
    jf.write_text(json.dumps({"input": str(video), "out_dir": str(tmp_path), "tracks": [{"stream": 5, "speaker": "GM"}]}))
    p = subprocess.run([sys.executable, str(ROOT / "studio/workers/transcribe.py"), "run", str(jf)], capture_output=True, text=True,
                       env={**os.environ, "PYTHONPATH": str(fake_whisper)})
    assert p.returncode == 1 and "doesn't exist" in p.stdout


def test_app_queue_end_to_end(video, tmp_path, fake_whisper, monkeypatch):
    monkeypatch.setenv("LORE_STUDIO_HOME", str(tmp_path / "home"))
    from studio import campaign, settings, transcription
    from studio.api import default_tracks
    from studio.util import Task, write_json
    # pretend the transcription environment is installed, using this Python
    envdir = transcription.env_dir()
    (envdir / "bin").mkdir(parents=True)
    os.symlink(sys.executable, envdir / "bin" / "python")
    write_json(envdir / "lore-studio.json", {"whisper": True})
    assert transcription.status()["installed"]
    settings.save({"obs_gm_track": 2, "obs_players_track": 3, "diarize_players": False})
    camp = campaign.create(tmp_path / "Camp", "Test")
    sid = camp.create_session("Recorded", 1)
    info = transcription.probe(video)
    camp.write_recording(sid, {"path": str(video), "streams": info["audio"], "tracks": default_tracks(len(info["audio"]))})
    tid = transcription.QUEUE.add(camp, sid)
    for _ in range(120):
        t = Task.get(tid)
        if t.status in ("done", "failed"):
            break
        time.sleep(0.25)
    assert t.status == "done", "\n".join(t.lines)
    assert camp.read_transcript(sid)["segments"]
    assert camp.session_list()[0]["status"] == "transcribed"


@pytest.fixture(scope="module")
def craig(tmp_path_factory):
    """A Craig-style download: one file per person, all starting together, plus a zip of them."""
    import zipfile
    d = tmp_path_factory.mktemp("craig")
    spec = {"1-cococolacake.flac": "0.3*sin(2*PI*440*t)*lt(t\\,3)",            # talks first
            "2-john_doe.flac": "0.3*sin(2*PI*330*t)*gt(t\\,4)",                # talks later
            "3-RollBot.flac": "0"}                                               # a bot that never speaks
    for name, expr in spec.items():
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"aevalsrc={expr}:s=48000:d=8", str(d / name)], check=True)
    (d / "info.txt").write_text("Tracks: …")
    z = d / "craig.zip"
    with zipfile.ZipFile(z, "w") as zf:
        for name in [*spec, "info.txt"]:
            zf.write(d / name, f"craig_abc/{name}")
    return d, z


def test_worker_one_file_per_person(craig, tmp_path, fake_whisper):
    d, _ = craig
    job = {"input": str(d), "out_dir": str(tmp_path / "out"),
           "tracks": [{"file": str(d / "1-cococolacake.flac"), "stream": 0, "speaker": "GM"},
                      {"file": str(d / "2-john_doe.flac"), "stream": 0, "speaker": "John"}]}
    jf = tmp_path / "job.json"
    jf.write_text(json.dumps(job))
    p = subprocess.run([sys.executable, str(ROOT / "studio/workers/transcribe.py"), "run", str(jf)], capture_output=True, text=True,
                       env={**os.environ, "PYTHONPATH": str(fake_whisper)})
    assert p.returncode == 0, p.stdout + p.stderr
    segs = json.loads((tmp_path / "out" / "transcript.json").read_text())["segments"]
    assert [s["speaker"] for s in segs] == ["GM", "GM", "John", "John"]       # in time order across files
    assert segs[1]["start"] < 3 and segs[2]["start"] >= 4


def test_craig_import_names_and_memory(craig, tmp_path, monkeypatch):
    monkeypatch.setenv("LORE_STUDIO_HOME", str(tmp_path / "home"))
    from studio import api as api_mod, transcription
    assert transcription.person_name("2-JaneRoe#1234.ogg") == "JaneRoe" and transcription.person_name("1-john_doe_2.flac") == "john_doe"
    _, z = craig
    a = api_mod.Api()
    a.create_campaign(str(tmp_path / "Camp"), "Test")
    a.save_campaign_info({"party": [{"player": "John Doe", "character": "Sir Doe", "speaker": "John"}]})
    sid = a.new_session("One", 1)
    rec = a.set_recording(sid, str(z))
    assert rec["per_person"] and rec["unpacked"]
    by = {t["who"]: t for t in rec["tracks"]}
    assert set(by) == {"cococolacake", "john_doe", "RollBot"}
    assert by["john_doe"]["speaker"] == "John"                                 # matched to the party list
    assert all(Path(t["file"]).is_file() for t in rec["tracks"])
    # the GM marks their own file and skips the bot; next session remembers both
    tracks = rec["tracks"]
    by["cococolacake"]["speaker"] = "GM"
    by["RollBot"]["skip"] = True
    a.set_tracks(sid, tracks)
    sid2 = a.new_session("Two", 2)
    rec2 = a.set_recording(sid2, str(craig[0]))                                   # this time the unzipped folder
    by2 = {t["who"]: t for t in rec2["tracks"]}
    assert by2["cococolacake"]["speaker"] == "GM" and by2["RollBot"]["skip"] and not rec2["unpacked"]
    with pytest.raises(Exception):
        a.set_recording(sid2, str(tmp_path))                                      # a folder with no audio
