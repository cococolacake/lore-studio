"""A campaign is a plain folder. This module reads and writes it.

    My Campaign/
      campaign.json          name and campaign-wide settings
      lore/                  Markdown pages; a folder with an index.md is a page with subpages
      sessions/023-title/    session.json, plan.md, plan.html, recap.md, transcript files...
      maps/                  map data (image, pins) kept for the map viewer
      assets/                images and handouts
      .trash/                deleted pages land here instead of disappearing

Page ids are paths inside lore/ without ".md", always with forward slashes:
"Characters/John Doe", "World Map/index", "index" (the landing page).
"""
import re
import shutil
import threading
import time
from pathlib import Path

from . import frontmatter
from .util import natural_key, read_json, safe_name, write_json

VERSION = 1
SESSION_STATUS = ("planned", "played", "transcribed", "recapped")


class CampaignError(Exception):
    pass


def _hms(t):
    t = int(max(0, t or 0))
    return f"{t // 3600:02d}:{t % 3600 // 60:02d}:{t % 60:02d}"


def is_campaign(path):
    return (Path(path) / "campaign.json").is_file()


def create(path, name):
    root = Path(path).expanduser()
    if is_campaign(root):
        raise CampaignError("That folder already has a campaign in it.")
    if root.exists() and any(p for p in root.iterdir() if not p.name.startswith(".")):
        raise CampaignError("Pick an empty folder (or a new one) for a new campaign.")
    for sub in ("lore", "sessions", "maps", "assets"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    write_json(root / "campaign.json", {"name": name, "version": VERSION, "created": time.strftime("%Y-%m-%d")})
    (root / "lore" / "index.md").write_text(frontmatter.dump({"title": name}, (
        f"Welcome to **{name}**.\n\nThis is your campaign's landing page. Add pages from the lore tree, "
        "link them with [[double brackets]], and keep GM-only notes in a secret block:\n\n"
        ":::gm\nOnly you can see this. It never appears in player exports.\n:::\n\n{{children}}\n")), encoding="utf-8")
    return Campaign(root)


class Campaign:
    def __init__(self, root):
        self.root = Path(root).expanduser().resolve()
        if not is_campaign(self.root):
            raise CampaignError(f"No campaign found in {self.root}")
        self.lore = self.root / "lore"
        self.sessions_dir = self.root / "sessions"
        self.lore.mkdir(exist_ok=True)
        self.sessions_dir.mkdir(exist_ok=True)
        self._lock = threading.Lock()
        self._cache = {}          # path -> (mtime, page summary)
        self._links = None        # (signature, data) of the computed link graph

    # ---- campaign -----------------------------------------------------------

    @property
    def info(self):
        return read_json(self.root / "campaign.json", {}) or {}

    @property
    def name(self):
        return self.info.get("name") or self.root.name

    def save_info(self, patch):
        info = self.info
        info.update(patch or {})
        write_json(self.root / "campaign.json", info)
        return info

    # ---- paths --------------------------------------------------------------

    def _page_path(self, pid):
        pid = (pid or "").strip().strip("/")
        if not pid or ".." in pid.split("/"):
            raise CampaignError("Bad page id.")
        p = (self.lore / (pid + ".md")).resolve()
        if self.lore not in p.parents:
            raise CampaignError("Bad page id.")
        return p

    def _pid(self, path):
        return Path(path).relative_to(self.lore).with_suffix("").as_posix()

    @staticmethod
    def _title_from_pid(pid):
        parts = pid.split("/")
        if parts[-1] == "index":
            return parts[-2] if len(parts) > 1 else "Home"
        return parts[-1]

    # ---- index --------------------------------------------------------------

    def _scan(self):
        """Summaries of every page, re-reading only files that changed."""
        seen = {}
        for f in self.lore.rglob("*.md"):
            if any(part.startswith(".") for part in f.relative_to(self.lore).parts):
                continue
            try:
                mtime = f.stat().st_mtime
            except OSError:
                continue
            key = str(f)
            hit = self._cache.get(key)
            if hit and hit[0] == mtime:
                seen[key] = hit
                continue
            text = f.read_text(encoding="utf-8", errors="replace")
            meta, body = frontmatter.parse(text)
            pid = self._pid(f)
            aliases = meta.get("aliases") or []
            if isinstance(aliases, str):
                aliases = [aliases]
            tags = meta.get("tags") or []
            if isinstance(tags, str):
                tags = [tags]
            seen[key] = (mtime, {
                "id": pid,
                "title": str(meta.get("title") or self._title_from_pid(pid)),
                "aliases": [str(a) for a in aliases],
                "tags": [str(t) for t in tags],
                "visibility": meta.get("visibility") or "players",
                "order": meta.get("order"),
                "banner": meta.get("banner") or "",
                "mtime": mtime,
                "body": body,
            })
        with self._lock:
            self._cache = seen
        return [v[1] for v in seen.values()]

    def pages(self):
        return sorted(self._scan(), key=lambda p: natural_key(p["id"]))

    def tree(self):
        """Nested tree for the side panel: [{id, title, children:[...]}], sorted by order then title."""
        pages = {p["id"]: p for p in self._scan()}

        def sort_key(n):
            o = n.get("order")
            return (0 if isinstance(o, (int, float)) else 1, o if isinstance(o, (int, float)) else 0, natural_key(n["title"]))

        def build(dir_rel):
            out = []
            d = self.lore / dir_rel if dir_rel else self.lore
            if not d.is_dir():
                return out
            for entry in d.iterdir():
                if entry.name.startswith("."):
                    continue
                rel = (Path(dir_rel) / entry.name).as_posix() if dir_rel else entry.name
                if entry.is_dir():
                    pid = rel + "/index"
                    p = pages.get(pid)
                    out.append({"id": pid if p else None, "title": p["title"] if p else entry.name,
                                "order": p["order"] if p else None, "gm": bool(p and p["visibility"] == "gm"),
                                "children": build(rel)})
                elif entry.suffix == ".md" and entry.stem != "index":
                    pid = rel[:-3]
                    p = pages.get(pid)
                    if p:
                        out.append({"id": pid, "title": p["title"], "order": p["order"],
                                    "gm": p["visibility"] == "gm", "children": []})
            out.sort(key=sort_key)
            for n in out:
                n.pop("order", None)
            return out

        home = pages.get("index")
        return {"home": {"id": "index", "title": home["title"]} if home else None, "children": build("")}

    def children(self, pid):
        """Direct subpages of a page (for {{children}} blocks)."""
        if pid == "index":
            base = ""
        elif pid.endswith("/index"):
            base = pid[: -len("/index")]
        else:
            return []

        def find(nodes, path):
            for n in nodes:
                nid = n["id"] or ""
                if nid == path + "/index":
                    return n["children"]
            return None
        t = self.tree()
        kids = t["children"] if base == "" else None
        if kids is None:
            stack = list(t["children"])
            while stack:
                n = stack.pop()
                if n["id"] == base + "/index":
                    kids = n["children"]
                    break
                stack.extend(n["children"])
        return [{"id": k["id"], "title": k["title"]} for k in (kids or []) if k["id"]]

    # ---- links --------------------------------------------------------------

    def link_names(self):
        """Every title and alias a mention can match, longest first: [[name, page id], ...].
        Character pages also match by first name ("John" -> John Doe) when no other page shares it."""
        pages = self._scan()
        names = {}
        for p in pages:
            for n in [p["title"], *p["aliases"]]:
                n = n.strip()
                if len(n) >= 3 and n.lower() not in ("home", "index", "overview"):
                    names.setdefault(n, p["id"])
        firsts = {}
        for p in pages:
            if any(t in ("character", "npc", "pc") for t in p["tags"]):
                first = p["title"].split()[0] if p["title"].split() else ""
                if len(first) >= 3 and first != p["title"]:
                    firsts.setdefault(first, []).append(p["id"])
        for first, ids in firsts.items():
            if len(ids) == 1 and first not in names:
                names[first] = ids[0]
        return sorted(([n, pid] for n, pid in names.items()), key=lambda x: -len(x[0]))

    def _graph(self):
        """page id -> set of page ids it mentions ([[links]] plus plain mentions of titles/aliases)."""
        pages = self._scan()
        sig = tuple(sorted((p["id"], p["mtime"]) for p in pages))
        if self._links and self._links[0] == sig:
            return self._links[1]
        names = self.link_names()
        by_lower = {n.lower(): pid for n, pid in names}
        by_name = dict(names)
        rx = re.compile(r"(?<![\w])(" + "|".join(re.escape(n) for n, _ in names) + r")(?![\w])") if names else None
        out = {}
        for p in pages:
            hits = set()
            for m in re.finditer(r"\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]", p["body"]):
                t = m.group(1).strip()
                pid = by_lower.get(t.lower()) or (t if (self.lore / (t + ".md")).exists() else None)
                if pid:
                    hits.add(pid)
            if rx:
                for m in rx.finditer(p["body"]):
                    hits.add(by_name[m.group(1)])
            hits.discard(p["id"])
            out[p["id"]] = hits
        self._links = (sig, out)
        return out

    def backlinks(self, pid):
        g = self._graph()
        titles = {p["id"]: p["title"] for p in self._scan()}
        pages = [{"id": src, "title": titles.get(src, src)} for src, dst in g.items() if pid in dst]
        pages.sort(key=lambda x: natural_key(x["title"]))
        sessions = []
        names = [n for n, target in self.link_names() if target == pid]
        if names:
            rx = re.compile(r"(?<![\w])(" + "|".join(re.escape(n) for n in names) + r")(?![\w])", re.I)
            for s in self.sessions():
                recap = s["dir"] / "recap.md"
                if recap.exists() and rx.search(recap.read_text(encoding="utf-8", errors="replace")):
                    sessions.append({"id": s["id"], "title": s["title"], "number": s["number"]})
        return {"pages": pages, "sessions": sessions}

    # ---- pages --------------------------------------------------------------

    def read_page(self, pid):
        f = self._page_path(pid)
        if not f.is_file():
            raise CampaignError(f"Page not found: {pid}")
        meta, body = frontmatter.parse(f.read_text(encoding="utf-8", errors="replace"))
        meta.setdefault("title", self._title_from_pid(pid))
        crumbs = []
        parts = pid.split("/")
        for i in range(1, len(parts) - (1 if parts[-1] == "index" else 0)):
            cid = "/".join(parts[:i]) + "/index"
            if (self.lore / (cid + ".md")).exists():
                crumbs.append({"id": cid, "title": self._title_of(cid)})
        return {"id": pid, "meta": meta, "body": body, "crumbs": crumbs,
                "children": self.children(pid), "backlinks": self.backlinks(pid),
                "path": str(f), "mtime": f.stat().st_mtime}

    def _title_of(self, pid):
        for p in self._scan():
            if p["id"] == pid:
                return p["title"]
        return self._title_from_pid(pid)

    def write_page(self, pid, meta, body, expected_mtime=None):
        f = self._page_path(pid)
        if expected_mtime and f.exists() and abs(f.stat().st_mtime - expected_mtime) > 0.001:
            raise CampaignError("This page was changed outside Lore Studio since you opened it. "
                                "Copy your edits, reopen the page, and try again.")
        f.parent.mkdir(parents=True, exist_ok=True)
        meta = {k: v for k, v in (meta or {}).items() if v not in (None, "", [])}
        tmp = f.with_suffix(".md.tmp")
        tmp.write_text(frontmatter.dump(meta, body or ""), encoding="utf-8")
        tmp.replace(f)
        return self.read_page(pid)

    def create_page(self, parent_id, title):
        """Add a page under parent_id (None or "index" = top level). A plain page gets
        turned into a folder page (X.md -> X/index.md) when it receives its first subpage."""
        title = (title or "").strip()
        if not title:
            raise CampaignError("Give the page a name.")
        if not parent_id or parent_id == "index":
            folder = self.lore
        elif parent_id.endswith("/index"):
            folder = self._page_path(parent_id).parent
        else:
            src = self._page_path(parent_id)
            folder = src.with_suffix("")
            folder.mkdir(parents=True, exist_ok=True)
            src.replace(folder / "index.md")
        name = safe_name(title)
        f = folder / f"{name}.md"
        n = 2
        while f.exists() or f.with_suffix("").exists():
            f = folder / f"{name} ({n}).md"
            n += 1
        meta = {"title": title}
        parent_file = folder / "index.md"
        if parent_file.exists():
            pmeta, _ = frontmatter.parse(parent_file.read_text(encoding="utf-8", errors="replace"))
            ptags = pmeta.get("tags") or []
            if isinstance(ptags, list) and ptags:
                meta["tags"] = [ptags[0]]
        f.write_text(frontmatter.dump(meta, ""), encoding="utf-8")
        return {"id": self._pid(f), "parent": self._pid(folder / "index.md") if folder != self.lore else "index"}

    def delete_page(self, pid):
        """Move a page (and its subpages, for folder pages) to .trash/."""
        if pid == "index":
            raise CampaignError("The landing page can't be deleted.")
        f = self._page_path(pid)
        target = f.parent if f.name == "index.md" else f
        if not target.exists():
            raise CampaignError("Page not found.")
        trash = self.root / ".trash" / time.strftime("%Y%m%d-%H%M%S")
        dest = trash / target.relative_to(self.lore)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(target), str(dest))
        return True

    def tags(self):
        """Every tag with how many pages use it, most used first."""
        counts = {}
        for p in self._scan():
            for t in p["tags"]:
                counts[t] = counts.get(t, 0) + 1
        return sorted(({"tag": t, "count": n} for t, n in counts.items()), key=lambda x: (-x["count"], x["tag"]))

    def graph(self):
        """Pages and the mentions between them, for the connection graph."""
        g = self._graph()
        pages = self._scan()
        edges = set()
        for src, dsts in g.items():
            for d in dsts:
                edges.add(tuple(sorted((src, d))))
        degree = {}
        for a, b in edges:
            degree[a] = degree.get(a, 0) + 1
            degree[b] = degree.get(b, 0) + 1
        nodes = [{"id": p["id"], "title": p["title"], "tags": p["tags"], "gm": p["visibility"] == "gm",
                  "kind": "page", "degree": degree.get(p["id"], 0)} for p in pages]
        # sessions join the graph through the pages their recaps mention
        names = self.link_names()
        if names:
            by_name = dict(names)
            rx = re.compile(r"(?<![\w])(" + "|".join(re.escape(n) for n, _ in names) + r")(?![\w])")
            for sess in self.sessions():
                recap = sess["dir"] / "recap.md"
                if not recap.exists():
                    continue
                hits = {by_name[m.group(1)] for m in rx.finditer(recap.read_text(encoding="utf-8", errors="replace"))}
                if not hits:
                    continue
                sid = "session:" + sess["id"]
                nodes.append({"id": sid, "title": f"{sess['number']}. {sess['title']}", "tags": ["session"],
                              "gm": False, "kind": "session", "degree": len(hits)})
                for h in sorted(hits):
                    edges.add((h, sid))
        return {"nodes": nodes, "edges": [list(e) for e in sorted(edges)]}

    def search(self, query, limit=40):
        q = (query or "").strip().lower()
        if not q:
            return []
        words = q.split()
        want_tags = [w[1:] for w in words if w.startswith("#") and len(w) > 1]
        if want_tags:
            q = " ".join(w for w in words if not w.startswith("#"))
            pool = [p for p in self._scan() if all(t in [x.lower() for x in p["tags"]] for t in want_tags)]
            if not q:
                return [{"kind": "page", "id": p["id"], "title": p["title"], "snippet": "", "score": 1, "tags": p["tags"]}
                        for p in sorted(pool, key=lambda p: natural_key(p["title"]))][:limit]
        else:
            pool = None
        out = []
        for p in (pool if pool is not None else self._scan()):
            title = p["title"].lower()
            score = 0
            if title == q:
                score += 100
            elif title.startswith(q):
                score += 60
            elif q in title:
                score += 40
            if any(q in a.lower() for a in p["aliases"]):
                score += 30
            if any(q == t.lower() for t in p["tags"]):
                score += 20
            body = p["body"]
            i = body.lower().find(q)
            if i >= 0:
                score += 10 + min(10, body.lower().count(q))
            if score:
                snip = ""
                if i >= 0:
                    a = max(0, i - 60)
                    snip = ("…" if a else "") + re.sub(r"\s+", " ", body[a:i + len(q) + 90]).strip() + "…"
                out.append({"kind": "page", "id": p["id"], "title": p["title"], "snippet": snip, "score": score, "tags": p["tags"]})
        for s in ([] if pool is not None else self.sessions()):
            text = s["title"].lower()
            recap = s["dir"] / "recap.md"
            body = recap.read_text(encoding="utf-8", errors="replace") if recap.exists() else ""
            i = body.lower().find(q)
            score = (40 if q in text else 0) + (8 if i >= 0 else 0)
            if score:
                a = max(0, i - 60)
                snip = (("…" if a else "") + re.sub(r"\s+", " ", body[a:i + len(q) + 90]).strip() + "…") if i >= 0 else ""
                out.append({"kind": "session", "id": s["id"], "title": f"Session {s['number']}: {s['title']}",
                            "snippet": snip, "score": score})
        out.sort(key=lambda r: (-r["score"], natural_key(r["title"])))
        return out[:limit]

    # ---- sessions -----------------------------------------------------------

    def _session_dir(self, sid):
        sid = (sid or "").strip()
        d = (self.sessions_dir / sid).resolve()
        if not sid or "/" in sid or "\\" in sid or d.parent != self.sessions_dir.resolve():
            raise CampaignError("Bad session id.")
        return d

    def sessions(self):
        out = []
        for d in self.sessions_dir.iterdir() if self.sessions_dir.is_dir() else []:
            if not d.is_dir() or d.name.startswith("."):
                continue
            info = read_json(d / "session.json", {}) or {}
            m = re.match(r"^(\d+)[-_ .]*(.*)$", d.name)
            number = info.get("number", int(m.group(1)) if m else None)
            title = info.get("title") or (m.group(2).replace("-", " ") if m else d.name)
            files = {f.name for f in d.iterdir() if f.is_file()}
            if "recap.md" in files:
                status = "recapped"
            elif "transcript.json" in files:
                status = "transcribed"
            elif info.get("played") or "recording.json" in files:
                status = "played"
            else:
                status = "planned"
            out.append({"id": d.name, "dir": d, "number": number, "title": title, "date": info.get("date", ""),
                        "in_world_date": info.get("in_world_date", ""), "status": status,
                        "has_plan": "plan.md" in files or "plan.html" in files, "has_html": "plan.html" in files,
                        "has_draft": "recap.draft.json" in files, "has_transcript": "transcript.json" in files,
                        "source": info.get("source", "")})
        out.sort(key=lambda s: (s["number"] is None, s["number"] or 0, natural_key(s["id"])))
        return out

    def session_list(self):
        return [{k: v for k, v in s.items() if k != "dir"} for s in self.sessions()]

    def read_session(self, sid):
        d = self._session_dir(sid)
        if not d.is_dir():
            raise CampaignError("Session not found.")
        s = next(x for x in self.sessions() if x["id"] == sid)
        recap = d / "recap.md"
        plan = d / "plan.md"
        meta, recap_body = frontmatter.parse(recap.read_text(encoding="utf-8", errors="replace")) if recap.exists() else ({}, "")
        _, plan_body = frontmatter.parse(plan.read_text(encoding="utf-8", errors="replace")) if plan.exists() else ({}, "")
        res = {k: v for k, v in s.items() if k != "dir"}
        res.update({"recap": recap_body, "plan": plan_body,
                    "claude_notes": (read_json(d / "session.json", {}) or {}).get("claude_notes", ""),
                    "html_url": f"/c/sessions/{sid}/plan.html" if (d / "plan.html").exists() else "",
                    "files": sorted(f.name for f in d.iterdir() if f.is_file()), "path": str(d)})
        return res

    def create_session(self, title, number=None):
        title = (title or "").strip() or "Untitled session"
        nums = [s["number"] for s in self.sessions() if isinstance(s["number"], int)]
        if number is None:
            number = (max(nums) + 1) if nums else 1
        slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:48] or "session"
        d = self.sessions_dir / f"{int(number):03d}-{slug}"
        n = 2
        while d.exists():
            d = self.sessions_dir / f"{int(number):03d}-{slug}-{n}"
            n += 1
        d.mkdir(parents=True)
        write_json(d / "session.json", {"number": int(number), "title": title, "created": time.strftime("%Y-%m-%d")})
        return d.name

    def update_session(self, sid, patch):
        d = self._session_dir(sid)
        info = read_json(d / "session.json", {}) or {}
        info.update({k: v for k, v in (patch or {}).items() if k in ("title", "number", "date", "in_world_date", "played", "claude_notes", "threads_scanned")})
        write_json(d / "session.json", info)
        return self.read_session(sid)

    def write_session_text(self, sid, which, body):
        if which not in ("recap", "plan"):
            raise CampaignError("Unknown session file.")
        d = self._session_dir(sid)
        f = d / f"{which}.md"
        meta, _ = frontmatter.parse(f.read_text(encoding="utf-8")) if f.exists() else ({}, "")
        f.write_text(frontmatter.dump(meta, body or ""), encoding="utf-8")
        return self.read_session(sid)

    def attach_session_html(self, sid, src):
        """Copy an existing HTML session-notes file into the session as plan.html."""
        d = self._session_dir(sid)
        src = Path(src).expanduser()
        if not src.is_file() or src.suffix.lower() not in (".html", ".htm"):
            raise CampaignError("Pick an .html file.")
        shutil.copyfile(src, d / "plan.html")
        if (d / "plan.md").exists():      # the attached notes win; the old plan is kept beside them
            (d / "plan.md").replace(d / "plan.previous.md")
        return self.read_session(sid)

    def delete_session(self, sid):
        d = self._session_dir(sid)
        trash = self.root / ".trash" / time.strftime("%Y%m%d-%H%M%S") / "sessions"
        trash.mkdir(parents=True, exist_ok=True)
        shutil.move(str(d), str(trash / d.name))
        return True

    # ---- recordings, transcripts, drafts -----------------------------------

    def session_dir(self, sid):
        d = self._session_dir(sid)
        if not d.is_dir():
            raise CampaignError("Session not found.")
        return d

    def session_number(self, sid):
        s = next((x for x in self.sessions() if x["id"] == sid), None)
        return s["number"] if s else sid

    def read_recording(self, sid):
        return read_json(self.session_dir(sid) / "recording.json", {}) or {}

    def write_recording(self, sid, patch):
        d = self.session_dir(sid)
        rec = read_json(d / "recording.json", {}) or {}
        rec.update(patch or {})
        write_json(d / "recording.json", rec)
        return rec

    def read_transcript(self, sid):
        return read_json(self.session_dir(sid) / "transcript.json", None)

    def save_speakers(self, sid, mapping):
        """Rename speakers in a transcript: {"SPEAKER_00": "Jane"}. Kept as a map, so it can be changed again."""
        d = self.session_dir(sid)
        data = read_json(d / "transcript.json", None)
        if not data:
            raise CampaignError("This session has no transcript yet.")
        data["speakers"] = {k: v for k, v in (mapping or {}).items() if v and v != k}
        write_json(d / "transcript.json", data)
        return data

    def transcript_text(self, sid, max_chars=None):
        """The transcript as '[00:12:03] Name: text' lines, consecutive lines by one speaker merged."""
        data = self.read_transcript(sid)
        if not data:
            return ""
        names = data.get("speakers") or {}
        lines, last, buf, start = [], None, [], 0.0
        for seg in data.get("segments") or []:
            who = names.get(seg["speaker"], seg["speaker"])
            if who != last and buf:
                lines.append(f"[{_hms(start)}] {last}: {' '.join(buf)}")
                buf = []
            if not buf:
                start = seg["start"]
            last = who
            buf.append(seg["text"])
        if buf:
            lines.append(f"[{_hms(start)}] {last}: {' '.join(buf)}")
        text = "\n".join(lines)
        return text[:max_chars] if max_chars else text

    def read_draft(self, sid):
        return read_json(self.session_dir(sid) / "recap.draft.json", None)

    def write_draft(self, sid, data):
        write_json(self.session_dir(sid) / "recap.draft.json", data)

    def discard_draft(self, sid):
        (self.session_dir(sid) / "recap.draft.json").unlink(missing_ok=True)

    def player_recap(self, sid):
        f = self.session_dir(sid) / "player-recap.md"
        if not f.exists():
            return ""
        return frontmatter.parse(f.read_text(encoding="utf-8", errors="replace"))[1]

    def write_player_recap(self, sid, body):
        f = self.session_dir(sid) / "player-recap.md"
        f.write_text(body or "", encoding="utf-8")

    # ---- name spellings ----------------------------------------------------

    def spellings(self):
        """Remembered corrections, {"Talia": "Thalia"}. Used for transcripts, drafts and Whisper's hints."""
        return dict(self.info.get("spellings") or {})

    def remember_spellings(self, pairs):
        sp = self.spellings()
        for wrong, right in pairs:
            if wrong and right and wrong != right:
                sp[wrong] = right
                sp.pop(right, None)          # never keep a rule that undoes this one
        self.save_info({"spellings": sp})
        return sp

    def known_names(self):
        """Names we trust: page titles and aliases, the party, and remembered spellings."""
        names = set()
        for p in self._scan():
            for n in [p["title"], *p["aliases"]]:
                names.update(w for w in re.findall(r"[A-Za-zÀ-ÿ’'\-]+", n) if len(w) >= 3)
        for m in self.info.get("party") or []:
            for n in (m.get("character"), m.get("player")):
                names.update(w for w in re.findall(r"[A-Za-zÀ-ÿ’'\-]+", n or "") if len(w) >= 3)
        names.update(self.spellings().values())
        return {re.sub(r"[’']s$", "", n) for n in names}

    @staticmethod
    def replace_names(text, pairs):
        """Whole-word, case-sensitive replacements ("Talia's" becomes "Thalia's"; "Talian" is left alone)."""
        counts = {}
        for wrong, right in pairs:
            if not wrong or not right or wrong == right:
                continue
            rx = re.compile(r"(?<![\w])" + re.escape(wrong) + r"(?![\w])")
            text, n = rx.subn(right, text or "")
            counts[wrong] = counts.get(wrong, 0) + n
        return text, counts

    def fix_names(self, sid, pairs, transcript=True, remember=True):
        """Fix misspelled names in a session's draft, recaps and (optionally) transcript."""
        pairs = [(a.strip(), b.strip()) for a, b in pairs if a and b and a.strip() != b.strip()]
        total = {}

        def add(c):
            for k, v in c.items():
                total[k] = total.get(k, 0) + v
        d = self.session_dir(sid)
        draft = self.read_draft(sid)
        if draft:
            for part in ("gm", "player"):
                if draft.get(part):
                    draft[part], c = self.replace_names(draft[part], pairs)
                    add(c)
            self.write_draft(sid, draft)
        for name in ("recap.md", "player-recap.md"):
            f = d / name
            if f.exists():
                text, c = self.replace_names(f.read_text(encoding="utf-8"), pairs)
                if sum(c.values()):
                    f.write_text(text, encoding="utf-8")
                add(c)
        if transcript:
            add(self.fix_transcript_names(sid, pairs))
        if remember:
            self.remember_spellings(pairs)
        return total

    def fix_transcript_names(self, sid, pairs):
        d = self.session_dir(sid)
        data = read_json(d / "transcript.json", None)
        if not data or not pairs:
            return {}
        total = {}
        for seg in data.get("segments") or []:
            seg["text"], c = self.replace_names(seg["text"], pairs)
            for k, v in c.items():
                total[k] = total.get(k, 0) + v
        if sum(total.values()):
            write_json(d / "transcript.json", data)
        return total

    def suggest_name_fixes(self, sid):
        """Words in the draft or recaps that look like a misspelling of a known name: [[wrong, right, count]]."""
        import difflib
        known = self.known_names()
        lower = {k.lower() for k in known}
        texts = []
        draft = self.read_draft(sid) or {}
        texts += [draft.get("gm") or "", draft.get("player") or ""]
        s = self.read_session(sid)
        texts += [s.get("recap") or "", self.player_recap(sid)]
        counts = {}
        for w in re.findall(r"(?<![\w’'])[A-ZÀ-Ý][a-zà-ÿ\-]{2,}(?![\w])", "\n".join(texts)):
            if w.lower() not in lower:
                counts[w] = counts.get(w, 0) + 1
        out = []
        known_list = sorted(known)
        for w, n in counts.items():
            remembered = self.spellings().get(w)
            if remembered:
                out.append([w, remembered, n])
                continue
            best = difflib.get_close_matches(w, known_list, n=1, cutoff=0.8)
            if best and best[0][0].lower() == w[0].lower() and abs(len(best[0]) - len(w)) <= 2:
                out.append([w, best[0], n])
        out.sort(key=lambda x: -x[2])
        return out[:20]

    # ---- live mode ------------------------------------------------------------

    def read_live(self, sid):
        return read_json(self.session_dir(sid) / "live.json", {}) or {}

    def write_live(self, sid, data):
        write_json(self.session_dir(sid) / "live.json", data)
        return data

    def live_notes_text(self, sid):
        """What the GM noted and ticked at the table, for Claude."""
        live = self.read_live(sid)
        lines = []
        for n in live.get("notes") or []:
            stamp = n.get("rec") or n.get("time", "")
            lines.append(f"- [{stamp}] {n.get('text', '')}" + (f" (during “{n['scene_title']}”)" if n.get("scene_title") else ""))
        done = [f"- {t}" for sc in (live.get("ticked_text") or {}).values() for t in sc]
        visited = live.get("visited_titles") or []
        out = []
        if visited:
            out.append("Scenes played, in order: " + "; ".join(visited))
        if done:
            out.append("Beats the GM ticked off as happened:\n" + "\n".join(done))
        if lines:
            out.append("The GM's notes during play:\n" + "\n".join(lines))
        return "\n\n".join(out)

    # ---- loose threads -------------------------------------------------------

    def threads(self):
        return (read_json(self.root / "threads.json", {}) or {}).get("threads", [])

    def save_threads(self, threads):
        write_json(self.root / "threads.json", {"version": 1, "threads": threads})
        return threads

    def add_thread(self, title, detail="", kind="hook", status="open", session=None, t=None, quote=""):
        threads = self.threads()
        tid = "t" + time.strftime("%Y%m%d%H%M%S") + f"{len(threads):03d}"
        threads.append({"id": tid, "title": title.strip(), "detail": detail.strip(), "kind": kind, "status": status,
                        "sessions": [session] if session else [], "t": t, "quote": quote,
                        "created": time.strftime("%Y-%m-%d"), "notes": []})
        self.save_threads(threads)
        return tid

    def update_thread(self, tid, patch):
        threads = self.threads()
        for th in threads:
            if th["id"] == tid:
                note = (patch or {}).pop("note", None)
                th.update({k: v for k, v in (patch or {}).items() if k in ("title", "detail", "kind", "status")})
                if note:
                    th.setdefault("notes", []).append({"text": note["text"], "session": note.get("session"),
                                                       "date": time.strftime("%Y-%m-%d")})
                    if note.get("session") and note["session"] not in th["sessions"]:
                        th["sessions"].append(note["session"])
                if th["status"] == "resolved" and not th.get("resolved"):
                    th["resolved"] = time.strftime("%Y-%m-%d")
                self.save_threads(threads)
                return th
        raise CampaignError("Thread not found.")

    def delete_thread(self, tid):
        self.save_threads([t for t in self.threads() if t["id"] != tid])
        return True

    # ---- files served to the UI --------------------------------------------

    def file_for_url(self, rel):
        """A file inside the campaign folder for /c/<rel> (session HTML, images). None if outside."""
        rel = rel.lstrip("/")
        if not rel or any(part.startswith(".") for part in Path(rel).parts):
            return None
        p = (self.root / rel).resolve()
        if self.root not in p.parents or not p.is_file():
            return None
        return p

    def stats(self):
        pages = self._scan()
        sessions = self.sessions()
        maps = list((self.root / "maps").glob("*.json")) if (self.root / "maps").is_dir() else []
        return {"pages": len(pages), "sessions": len(sessions),
                "recapped": sum(1 for s in sessions if s["status"] == "recapped"),
                "gm_pages": sum(1 for p in pages if p["visibility"] == "gm"),
                "maps": len(maps)}
