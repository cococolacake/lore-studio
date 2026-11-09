"""Lore Studio transcription worker. Runs inside the separate transcription environment, never in the app.

    python transcribe.py probe <recording>        list the recording's audio tracks (JSON on stdout)
    python transcribe.py run <job.json>           transcribe; progress as "@@{json}" lines on stdout

The job file:
    {
      "input": "D:/OBS/2026-11-14 19-02-11.mp4",
      "out_dir": ".../sessions/003-the-drowned-chapel",
      "tracks": [{"stream": 1, "speaker": "GM"}, {"stream": 2, "speaker": "Players", "diarize": true}],
                                       # a track may name its own "file": one recording per person (Craig and
                                       # similar bots), all starting at the same moment
                                       # or [] to transcribe the first audio track as one mixed track
      "model": "large-v3-turbo", "device": "auto", "compute_type": "auto", "batch_size": 16,
      "language": "en", "hotwords": "Eldoria Westmarch Doe ...",
      "hf_token": "..."                # only for diarization
    }

Writes transcript.json, transcript.srt and transcript.txt into out_dir.
Standalone on purpose: it imports nothing from the app, so it works with whatever Python that environment has.
"""
import gc
import glob
import json
import os
import sys
import time

SR = 16000


def emit(kind, **data):
    print("@@" + json.dumps({"type": kind, **data}), flush=True)


def add_cuda_paths():
    """Make the CUDA libraries installed with pip (nvidia-cublas-cu12, nvidia-cudnn-cu12) findable."""
    try:
        import site
        roots = site.getsitepackages() + [site.getusersitepackages()]
    except Exception:
        roots = [p for p in sys.path if p.endswith("site-packages")]
    for root in roots:
        for d in glob.glob(os.path.join(root, "nvidia", "*", "bin")) + glob.glob(os.path.join(root, "nvidia", "*", "lib")):
            if os.name == "nt" and hasattr(os, "add_dll_directory"):
                try:
                    os.add_dll_directory(d)
                except OSError:
                    pass
            os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")


def probe(path):
    import av
    with av.open(path) as c:
        out = []
        for i, s in enumerate(c.streams.audio):
            dur = float(s.duration * s.time_base) if s.duration else (c.duration / 1e6 if c.duration else None)
            out.append({"stream": i, "channels": s.channels, "rate": s.rate, "duration": dur,
                        "title": (s.metadata or {}).get("title") or (s.metadata or {}).get("handler_name") or "",
                        "language": (s.metadata or {}).get("language") or ""})
        return {"audio": out, "duration": c.duration / 1e6 if c.duration else None}


def load_track(path, stream_index):
    """Decode one audio track to 16 kHz mono float32 (numpy)."""
    import av
    import numpy as np
    chunks = []
    with av.open(path) as c:
        stream = c.streams.audio[stream_index]
        res = av.AudioResampler(format="s16", layout="mono", rate=SR)
        total = float(stream.duration * stream.time_base) if stream.duration else (c.duration / 1e6 if c.duration else 0)
        last = 0
        for frame in c.decode(stream):
            for f in res.resample(frame):
                chunks.append(f.to_ndarray().reshape(-1))
            if total and frame.time and frame.time - last > 30:
                last = frame.time
                emit("progress", stage="decode", done=frame.time, total=total)
        for f in res.resample(None):
            chunks.append(f.to_ndarray().reshape(-1))
    if not chunks:
        return np.zeros(0, dtype="float32")
    return (np.concatenate(chunks).astype("float32") / 32768.0)


def pick_device(job):
    device = job.get("device") or "auto"
    if device == "auto":
        try:
            import ctranslate2
            device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
        except Exception:
            device = "cpu"
    compute = job.get("compute_type") or "auto"
    if compute == "auto":
        compute = "float16" if device == "cuda" else "int8"
    return device, compute


def transcribe_audio(pipeline, audio, job, label, offset_done, grand_total, words=False):
    """words: keep word timings, so a line can be split where the speaker changes."""
    kwargs = dict(batch_size=int(job.get("batch_size") or 16), beam_size=1)
    if words:
        kwargs["word_timestamps"] = True
    if job.get("language"):
        kwargs["language"] = job["language"]
    if job.get("hotwords"):
        kwargs["hotwords"] = job["hotwords"]
    try:
        segments, info = pipeline.transcribe(audio, **kwargs)
    except TypeError:          # older faster-whisper without hotwords (or word timings) in batched mode
        kwargs.pop("hotwords", None)
        try:
            segments, info = pipeline.transcribe(audio, **kwargs)
        except TypeError:
            kwargs.pop("word_timestamps", None)
            segments, info = pipeline.transcribe(audio, **kwargs)
    out = []
    t0 = time.time()
    for s in segments:
        text = s.text.strip()
        if text:
            seg = {"start": round(s.start, 2), "end": round(s.end, 2), "speaker": label, "text": text}
            ws = [w for w in (getattr(s, "words", None) or []) if (w.word or "").strip()]
            if words and ws:
                seg["words"] = [(round(w.start, 2), round(w.end, 2), w.word) for w in ws]
            out.append(seg)
        done = offset_done + s.end
        elapsed = time.time() - t0
        speed = s.end / elapsed if elapsed > 0 else None
        emit("progress", stage="transcribe", track=label, done=done, total=grand_total,
             speed=round(speed, 1) if speed else None)
    return out


def diarize(audio, job, device, voices=None):
    """Speaker turns for one track with pyannote. Returns [(start, end, "SPEAKER_00"), ...] or None.
    voices: how many people talk on this track, if known (much better than letting the model guess)."""
    try:
        import torch
        from pyannote.audio import Pipeline
    except ImportError:
        emit("log", text="Speaker detection isn't installed, so this track keeps one speaker label.")
        return None
    emit("progress", stage="diarize", done=0, total=1)
    name = job.get("diarization_model") or "pyannote/speaker-diarization-community-1"
    token = job.get("hf_token") or None
    try:
        pipe = Pipeline.from_pretrained(name, token=token)
    except TypeError:
        pipe = Pipeline.from_pretrained(name, use_auth_token=token)
    if pipe is None:
        raise RuntimeError("Couldn't load the speaker detection model. Check your Hugging Face token and that you accepted the model's terms.")
    if device == "cuda":
        pipe.to(torch.device("cuda"))
    kwargs = {"num_speakers": int(voices)} if voices and int(voices) > 0 else {}
    if kwargs:
        emit("log", text=f"Listening for {kwargs['num_speakers']} voices.")
    out = pipe({"waveform": torch.from_numpy(audio).unsqueeze(0), "sample_rate": SR}, **kwargs)
    ann = getattr(out, "exclusive_speaker_diarization", None) or getattr(out, "speaker_diarization", None) or out
    turns = []
    if hasattr(ann, "itertracks"):
        for turn, _, spk in ann.itertracks(yield_label=True):
            turns.append((turn.start, turn.end, spk))
    else:
        for turn, spk in ann:
            turns.append((turn.start, turn.end, spk))
    emit("progress", stage="diarize", done=1, total=1)
    return turns


def _speaker_at(turns, a, b):
    """The diarized speaker who talks most between a and b (or the nearest one, in a gap)."""
    best, overlap = None, 0.0
    for x, y, spk in turns:
        if y < a:
            continue
        if x > b:
            break
        o = min(y, b) - max(x, a)
        if o > overlap:
            best, overlap = spk, o
    if best is None and turns:
        mid = (a + b) / 2
        best = min(turns, key=lambda t: 0 if t[0] <= mid <= t[1] else min(abs(t[0] - mid), abs(t[1] - mid)))[2]
    return best


def assign_speakers(segments, turns, prefix):
    """Label each line with its diarized speaker. With word timings, a line where the speaker changes
    part-way ("Sure. I attack the goblin.") is split there, so each part gets the right voice."""
    name = lambda spk: (f"{prefix} {spk.replace('SPEAKER_', '')}".strip() if prefix else spk)
    turns = sorted(turns)
    out = []
    for seg in segments:
        words = seg.pop("words", None)
        if not words:
            spk = _speaker_at(turns, seg["start"], seg["end"])
            if spk:
                seg["speaker"] = name(spk)
            out.append(seg)
            continue
        runs = []                                   # [speaker, start, end, [words]]
        for a, b, w in words:
            spk = _speaker_at(turns, a, b) or ""
            if runs and runs[-1][0] == spk:
                runs[-1][2] = b
                runs[-1][3].append(w)
            else:
                runs.append([spk, a, b, [w]])
        # one quick word inside someone else's sentence is more often a timing wobble than a new speaker:
        # fold it into its neighbours (but "Sure." at the start of a line really can be someone else)
        i = 0
        while len(runs) > 1 and i < len(runs):
            r = runs[i]
            inside = 0 < i < len(runs) - 1 and runs[i - 1][0] == runs[i + 1][0]
            if len(r[3]) <= 1 and ((inside and r[2] - r[1] < 0.6) or r[2] - r[1] < 0.15):
                j = i - 1 if i > 0 else i + 1
                n = runs[j]
                n[1], n[2] = min(n[1], r[1]), max(n[2], r[2])
                n[3] = (n[3] + r[3]) if j < i else (r[3] + n[3])
                runs.pop(i)
                i = max(0, i - 1)
                continue
            i += 1
        merged = []
        for r in runs:                              # neighbours left with the same voice become one line again
            if merged and merged[-1][0] == r[0]:
                merged[-1][2], merged[-1][3] = r[2], merged[-1][3] + r[3]
            else:
                merged.append(r)
        for spk, a, b, ws in merged:
            text = "".join(ws).strip()
            if text:
                out.append({**seg, "start": round(a, 2), "end": round(b, 2), "text": text,
                            "speaker": name(spk) if spk else seg["speaker"]})
    segments[:] = out
    return segments


def ts(t, srt=False):
    h, rem = divmod(max(0.0, t), 3600)
    m, s = divmod(rem, 60)
    if srt:
        return f"{int(h):02d}:{int(m):02d}:{int(s):02d},{int(round((s % 1) * 1000)) % 1000:03d}"
    return f"{int(h):02d}:{int(m):02d}:{int(s):02d}"


def write_outputs(out_dir, segments, meta):
    os.makedirs(out_dir, exist_ok=True)
    data = {"version": 1, **meta, "segments": segments}
    tmp = os.path.join(out_dir, "transcript.json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, os.path.join(out_dir, "transcript.json"))
    with open(os.path.join(out_dir, "transcript.srt"), "w", encoding="utf-8") as f:
        for i, s in enumerate(segments, 1):
            f.write(f"{i}\n{ts(s['start'], True)} --> {ts(s['end'], True)}\n{s['speaker']}: {s['text']}\n\n")
    with open(os.path.join(out_dir, "transcript.txt"), "w", encoding="utf-8") as f:
        last = None
        for s in segments:
            if s["speaker"] != last:
                f.write(f"\n[{ts(s['start'])}] {s['speaker']}:\n")
                last = s["speaker"]
            f.write(s["text"] + "\n")


def run(job_path):
    with open(job_path, encoding="utf-8") as f:
        job = json.load(f)
    add_cuda_paths()
    from faster_whisper import BatchedInferencePipeline, WhisperModel
    tracks = job.get("tracks") or [{"stream": 0, "speaker": "Table", "diarize": bool(job.get("diarize_mix"))}]
    lengths = []
    for t in tracks:
        src = t.get("file") or job["input"]
        info = probe(src)
        streams = info["audio"]
        if not streams:
            raise RuntimeError(f"{os.path.basename(src)} has no audio." if t.get("file") else "That recording has no audio.")
        if t["stream"] >= len(streams):
            raise RuntimeError(f"The recording has {len(streams)} audio track(s), so track {t['stream'] + 1} doesn't exist.")
        lengths.append(info.get("duration") or streams[t["stream"]].get("duration") or 0)
    duration = max(lengths) if lengths else 0
    grand_total = sum(lengths)

    device, compute = pick_device(job)
    emit("log", text=f"Loading {job.get('model', 'large-v3-turbo')} on {device} ({compute})…")
    model = WhisperModel(job.get("model") or "large-v3-turbo", device=device, compute_type=compute)
    pipeline = BatchedInferencePipeline(model=model)

    segments = []
    for n, t in enumerate(tracks):
        src = t.get("file") or job["input"]
        emit("log", text=f"Reading {os.path.basename(src)} ({t['speaker']})…" if t.get("file") else f"Reading audio track {t['stream'] + 1} ({t['speaker']})…")
        audio = load_track(src, t["stream"])
        segs = transcribe_audio(pipeline, audio, job, t["speaker"], sum(lengths[:n]), grand_total, words=bool(t.get("diarize")))
        if t.get("diarize") and segs:
            turns = diarize(audio, job, device, t.get("voices"))
            if turns:
                assign_speakers(segs, turns, t["speaker"] if len(tracks) > 1 else "")
        for seg in segs:
            seg.pop("words", None)
        segments.extend(segs)
        del audio
        gc.collect()

    segments.sort(key=lambda s: (s["start"], s["end"]))
    write_outputs(job["out_dir"], segments, {
        "source": job["input"], "model": job.get("model") or "large-v3-turbo", "device": device,
        "duration": duration, "tracks": tracks, "created": time.strftime("%Y-%m-%d %H:%M"), "speakers": {},
    })
    emit("done", segments=len(segments), duration=duration)


def main():
    if len(sys.argv) < 3 or sys.argv[1] not in ("probe", "run"):
        print(__doc__)
        return 2
    try:
        if sys.argv[1] == "probe":
            print(json.dumps(probe(sys.argv[2])))
        else:
            run(sys.argv[2])
        return 0
    except Exception as e:  # report to the app, which shows it in the job log
        emit("error", text=f"{type(e).__name__}: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
