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


def _tag_list(v):
    """Tags as a clean list: lowercase, no #, spaces become hyphens, no repeats."""
    if isinstance(v, str):
        v = v.split(",")
    out = []
    for t in v or []:
        t = re.sub(r"[\s_]+", "-", str(t).strip().lstrip("#").lower()).strip("-")
        if t and t not in out:
            out.append(t)
    return out


def date_range_label(a, b=""):
    """'2026-10-03', or '2026-10-03 – 2026-10-04' when the session ran over more than one day."""
    return f"{a} – {b}" if a and b and b > a else (a or "")


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


# Words that start a title but are never a first name ("The Wanderer" shouldn't link every "The").
_NOT_FIRST_NAMES = {"the", "and", "lord", "lady", "sir", "dame", "king", "queen", "prince", "princess", "captain",
                    "doctor", "father", "mother", "brother", "sister", "saint", "old", "young", "little", "great"}


# Kinds of relationship a page can have with another ("relations: [rival: Jane Roe]" in its frontmatter).
REL_TYPES = ["ally", "friend", "family", "romance", "rival", "enemy", "member", "serves", "owes", "other"]


def _parse_relations(value):
    """["rival: Jane Roe", "member: The Guild"] -> [("rival", "Jane Roe"), ...]. Unknown kinds become "other"."""
    items = value if isinstance(value, list) else [value] if value else []
    out = []
    for item in items:
        kind, sep, target = str(item).partition(":")
        if not sep:
            kind, target = "other", kind
        kind, target = kind.strip().lower(), target.strip()
        if target:
            out.append((kind if kind in REL_TYPES else "other", target))
    return out


# Ordinary English words that are never suggested as misspelled names, even when a title contains one
# ("The Outer Planes" shouldn't make "They" look like a misspelling of "The", or "Places" of "Planes").
_COMMON_WORDS = _NOT_FIRST_NAMES | set("""
a about above after again against all also am an any are around as at away back be because been before being below
between both but by can could did do does doing down during each else even ever every few for from further had has
have having he her here hers herself him himself his how however i if in into is it its itself just last least less
let like many may me might mine more most much must my myself near never next no nor not now of off often on once
one only or other others our ours ourselves out over own perhaps quite rather really same she should since so some
still such than that the their theirs them themselves then there these they this those though through thus till to
too toward towards under until up upon us very was we were what whatever when where whether which while who whom
whose why will with within without would yet you your yours yourself yourselves
yes okay oh well anyway maybe sure right left first second third new open close end part side way time day night
year place places plane planes world worlds land lands city cities town towns village road roads river sea isle
island islands mountain mountains forest forests tower towers house houses hall halls keep gate gates realm realms
kingdom empire order guild church temple court market inn tavern war age ages north south east west upper lower
inner outer high deep dark light black white red blue green gold golden silver iron stone fire water earth air
""".split())


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
                "relations": _parse_relations(meta.get("relations")),
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
                if len(first) >= 3 and first != p["title"] and first.lower() not in _NOT_FIRST_NAMES:
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

    def _resolve_page(self, name):
        """A page id for a title or alias (any case), or None."""
        low = (name or "").strip().lower()
        for p in self._scan():
            if p["title"].lower() == low or low in (a.lower() for a in p["aliases"]) or p["id"].lower() == low:
                return p["id"]
        return None

    def relations(self, pid):
        """This page's relationships: {"out": [{kind, target, id, title}], "in": [{kind, id, title}]}.
        "out" are the ones written on this page; "in" are other pages' relationships that point here."""
        pages = {p["id"]: p for p in self._scan()}
        me = pages.get(pid)
        out = []
        for kind, target in (me["relations"] if me else []):
            tid = self._resolve_page(target)
            out.append({"kind": kind, "target": target, "id": tid, "title": pages[tid]["title"] if tid else target,
                        "gm": bool(tid) and pages[tid]["visibility"] == "gm"})
        inc = []
        for p in pages.values():
            if p["id"] == pid:
                continue
            for kind, target in p["relations"]:
                if self._resolve_page(target) == pid:
                    inc.append({"kind": kind, "id": p["id"], "title": p["title"], "gm": p["visibility"] == "gm"})
        inc.sort(key=lambda r: natural_key(r["title"]))
        return {"out": out, "in": inc}

    def set_relations(self, pid, rels):
        """Replace this page's relationships with [{"kind", "target"}] (target: a page title)."""
        page = self.read_page(pid)
        items = []
        for r in rels or []:
            kind = str(r.get("kind") or "other").strip().lower()
            target = str(r.get("target") or "").strip()     # a colon in a title is fine: only the first one splits
            item = f"{kind if kind in REL_TYPES else 'other'}: {target}"
            if target and item not in items:
                items.append(item)
        meta = dict(page["meta"])
        meta["relations"] = items
        self.write_page(pid, meta, page["body"])
        return self.relations(pid)

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
                "children": self.children(pid), "backlinks": self.backlinks(pid), "relations": self.relations(pid),
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

    def tags(self, sessions=True):
        """Every tag with how many pages (and sessions) use it, most used first."""
        counts = {}
        for p in self._scan():
            for t in p["tags"]:
                counts[t] = counts.get(t, 0) + 1
        for sess in (self.sessions() if sessions else []):
            for t in sess["tags"]:
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
        # sessions join the graph through the pages their recaps mention, and through their tags
        names = self.link_names()
        by_name = dict(names)
        rx = re.compile(r"(?<![\w])(" + "|".join(re.escape(n) for n, _ in names) + r")(?![\w])") if names else None
        for sess in self.sessions():
            recap = sess["dir"] / "recap.md"
            hits = set()
            if rx and recap.exists():
                hits = {by_name[m.group(1)] for m in rx.finditer(recap.read_text(encoding="utf-8", errors="replace"))}
            if not hits and not sess["tags"]:
                continue
            sid = "session:" + sess["id"]
            nodes.append({"id": sid, "title": f"{sess['number']}. {sess['title']}", "tags": ["session"],
                          "own_tags": sess["tags"], "gm": False, "kind": "session", "degree": len(hits),
                          "number": sess["number"]})
            for h in sorted(hits):
                edges.add((h, sid))
        # tag links: one small node per tag, joined to everything that carries it. The graph page can switch these off.
        tag_edges = []
        members = {}
        for n in nodes:
            for t in (n["own_tags"] if n["kind"] == "session" else n["tags"]):
                members.setdefault(t, []).append(n["id"])
        for t, ids in members.items():
            if len(ids) < 2:
                continue
            tid = "tag:" + t
            nodes.append({"id": tid, "title": "#" + t, "tags": [t], "gm": False, "kind": "tag", "degree": len(ids)})
            tag_edges += [[i, tid] for i in ids]
        rel_edges = []
        for p in pages:
            for kind, target in p["relations"]:
                tid = self._resolve_page(target)
                if tid and tid != p["id"]:
                    rel_edges.append([p["id"], tid, kind])
        return {"nodes": nodes, "edges": [list(e) for e in sorted(edges)], "tag_edges": tag_edges, "rel_edges": rel_edges}

    def search(self, query, limit=40):
        q = (query or "").strip().lower()
        if not q:
            return []
        words = q.split()
        want_tags = [w[1:] for w in words if w.startswith("#") and len(w) > 1]
        if want_tags:
            q = " ".join(w for w in words if not w.startswith("#"))
            pool = [p for p in self._scan() if all(t in [x.lower() for x in p["tags"]] for t in want_tags)]
            spool = [x for x in self.sessions() if all(t in [y.lower() for y in x["tags"]] for t in want_tags)]
            if not q:
                return ([{"kind": "page", "id": p["id"], "title": p["title"], "snippet": "", "score": 1, "tags": p["tags"]}
                         for p in sorted(pool, key=lambda p: natural_key(p["title"]))] +
                        [{"kind": "session", "id": x["id"], "title": f"Session {x['number']}: {x['title']}", "snippet": "", "score": 1, "tags": x["tags"]}
                         for x in spool])[:limit]
        else:
            pool = spool = None
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
        for s in (spool if pool is not None else self.sessions()):
            text = s["title"].lower()
            recap = s["dir"] / "recap.md"
            body = recap.read_text(encoding="utf-8", errors="replace") if recap.exists() else ""
            i = body.lower().find(q)
            score = (40 if q in text else 0) + (8 if i >= 0 else 0) + (20 if any(q == t.lower() for t in s["tags"]) else 0)
            if score:
                a = max(0, i - 60)
                snip = (("…" if a else "") + re.sub(r"\s+", " ", body[a:i + len(q) + 90]).strip() + "…") if i >= 0 else ""
                out.append({"kind": "session", "id": s["id"], "title": f"Session {s['number']}: {s['title']}",
                            "snippet": snip, "score": score, "tags": s["tags"]})
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
            date, date_end = info.get("date", ""), info.get("date_end", "")
            out.append({"id": d.name, "dir": d, "number": number, "title": title, "date": date, "date_end": date_end,
                        "date_label": date_range_label(date, date_end),
                        "in_world_date": info.get("in_world_date", ""), "world_date": info.get("world_date"),
                        "world_date_end": info.get("world_date_end"), "status": status,
                        "has_plan": "plan.md" in files or "plan.html" in files, "has_html": "plan.html" in files,
                        "has_draft": "recap.draft.json" in files, "has_transcript": "transcript.json" in files,
                        "source": info.get("source", ""), "tags": _tag_list(info.get("tags"))})
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
        patch = dict(patch or {})
        if "tags" in patch:
            patch["tags"] = _tag_list(patch["tags"])
        info.update({k: v for k, v in patch.items() if k in ("title", "number", "date", "date_end", "in_world_date", "world_date", "world_date_end", "played", "claude_notes", "threads_scanned", "tags")})
        if not info.get("tags"):
            info.pop("tags", None)
        # an end date only means something after the start
        if not info.get("date") or (info.get("date_end") or "") <= (info.get("date") or ""):
            info.pop("date_end", None)
        if not info.get("world_date") or not info.get("world_date_end"):
            info.pop("world_date_end", None)
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

    def spotlight(self, sid):
        """Who talked how much in a session: [{"name", "label", "seconds", "turns", "gm"}], most talk first.
        From the transcript's speaker labels, with the names you gave them. None without a transcript."""
        data = self.read_transcript(sid)
        if not data or not data.get("segments"):
            return None
        names = data.get("speakers") or {}
        by = {}
        last = None
        for seg in data["segments"]:
            label = seg.get("speaker") or "?"
            name = (names.get(label) or label).strip()
            row = by.setdefault(name, {"name": name, "label": label, "seconds": 0.0, "turns": 0,
                                       "gm": name.upper() == "GM" or label.upper() == "GM"})
            row["seconds"] += max(0.0, float(seg.get("end", 0)) - float(seg.get("start", 0)))
            if name != last:
                row["turns"] += 1
            last = name
        rows = sorted(by.values(), key=lambda r: -r["seconds"])
        for r in rows:
            r["seconds"] = round(r["seconds"], 1)
        return rows

    def spotlight_all(self):
        """Talk time across every transcribed session: {"people": [{"name", "seconds", "sessions", "gm"}],
        "sessions": [{"id", "number", "title", "people": [...]}]}."""
        people, sessions = {}, []
        for s in self.sessions():
            if not s["has_transcript"]:
                continue
            rows = self.spotlight(s["id"]) or []
            if not rows:
                continue
            sessions.append({"id": s["id"], "number": s["number"], "title": s["title"], "people": rows})
            for r in rows:
                p = people.setdefault(r["name"], {"name": r["name"], "seconds": 0.0, "sessions": 0, "gm": r["gm"]})
                p["seconds"] = round(p["seconds"] + r["seconds"], 1)
                p["sessions"] += 1
        return {"people": sorted(people.values(), key=lambda p: -p["seconds"]), "sessions": sessions}

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

    def transcript_export(self, sid, timestamps=True, fmt="txt"):
        """A readable copy of a session's transcript to share: a heading, then one paragraph per turn with the
        speaker's name (and the recording time). fmt "md" bolds the names for Markdown."""
        data = self.read_transcript(sid)
        if not data or not data.get("segments"):
            raise CampaignError("This session has no transcript yet.")
        s = self.read_session(sid)
        heading = f"Session {s.get('number')}: {s.get('title')}" if s.get("number") is not None else str(s.get("title") or sid)
        when = s.get("date_label") or s.get("date") or ""
        names = data.get("speakers") or {}
        turns, last = [], None
        for seg in data["segments"]:
            who = (names.get(seg["speaker"]) or seg["speaker"]).strip()
            text = (seg.get("text") or "").strip()
            if not text:
                continue
            if turns and who == last:
                turns[-1][2].append(text)
            else:
                turns.append([seg.get("start", 0), who, [text]])
            last = who
        out = []
        for start, who, parts in turns:
            stamp = f"[{_hms(start)}] " if timestamps else ""
            line = " ".join(parts)
            out.append(f"{stamp}**{who}:** {line}" if fmt == "md" else f"{stamp}{who}: {line}")
        top = (f"# {heading}\n\n" + (f"*{when}*\n\n" if when else "")) if fmt == "md" else (heading + "\n" + (when + "\n" if when else "") + "\n")
        return top + "\n\n".join(out) + "\n"

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

    def not_names(self):
        """Words you've told Fix names aren't misspellings, so they're never suggested again."""
        return list(self.info.get("not_names") or [])

    def ignore_names(self, words):
        keep = self.not_names()
        keep += [w for w in (x.strip() for x in words or []) if w and w not in keep]
        self.save_info({"not_names": keep})
        return keep

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

    def fix_names(self, sid, pairs, transcript=True, remember=True, ignore=None):
        """Fix misspelled names in a session's draft, recaps and (optionally) transcript.
        With remember, suggestions you unticked (ignore) aren't suggested again."""
        if remember and ignore:
            self.ignore_names(ignore)
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
        text = "\n".join(texts)
        # words also written in lowercase ("they", "places") are ordinary words, not misspelled names
        everyday = set(re.findall(r"(?<![\w’'])[a-zà-ÿ][a-zà-ÿ\-]{2,}(?![\w])", text + "\n" + self.transcript_text(sid)))
        ignored = {w.lower() for w in self.not_names()}
        spellings = self.spellings()
        counts = {}
        for w in re.findall(r"(?<![\w’'])[A-ZÀ-Ý][a-zà-ÿ\-]{2,}(?![\w])", text):
            if w.lower() not in lower:
                counts[w] = counts.get(w, 0) + 1
        out = []
        known_list = sorted(k for k in known if k.lower() not in _COMMON_WORDS)
        for w, n in counts.items():
            remembered = spellings.get(w)
            if remembered:
                out.append([w, remembered, n])
                continue
            lw = w.lower()
            if lw in _COMMON_WORDS or lw in everyday or lw in ignored:
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
        finished = live.get("finished_titles") or []
        visited = live.get("visited_titles") or []
        out = []
        if finished:
            out.append("Scenes the GM marked as played: " + "; ".join(finished))
            opened = [t for t in visited if t not in finished]
            if opened:
                out.append("Scenes the GM opened but didn't mark as played (they may not have happened): " + "; ".join(opened))
        elif visited:
            out.append("Scenes the GM opened during play, in order: " + "; ".join(visited))
        if done:
            out.append("Beats the GM ticked off as happened:\n" + "\n".join(done))
        if lines:
            out.append("The GM's notes during play:\n" + "\n".join(lines))
        return "\n\n".join(out)

    # ---- live mode: NPC cards and random tables --------------------------------------------

    CARD_FIELDS = ("look", "voice", "wants", "secret")

    def npc_card(self, pid):
        """What a GM needs about an NPC at a glance: the card fields from its frontmatter (look, voice, wants, secret)
        and, when they're empty, the first paragraph of the page."""
        page = self.read_page(pid)
        meta = page["meta"]
        body = re.sub(r":::gm.*?:::", "", page["body"], flags=re.S)
        paras = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip() and not p.strip().startswith(("#", ">", "{{", "|", "-", "*", "!", ":::"))]
        summary = re.sub(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", lambda m: m.group(2) or m.group(1), paras[0]) if paras else ""
        tags = meta.get("tags") or []
        return {"id": pid, "title": meta.get("title"), "tags": tags if isinstance(tags, list) else [tags],
                "banner": meta.get("banner") or "", "summary": summary[:400], "gm": meta.get("visibility") == "gm",
                **{k: str(meta.get(k) or "") for k in self.CARD_FIELDS}}

    def save_npc_card(self, pid, fields):
        page = self.read_page(pid)
        meta = dict(page["meta"])
        for k in self.CARD_FIELDS:
            if k in (fields or {}):
                meta[k] = " ".join(str(fields[k] or "").split())
        self.write_page(pid, meta, page["body"])
        return self.npc_card(pid)

    def tables(self):
        """Random tables: every page tagged #table. Each list item in it is one result."""
        out = []
        for p in self._scan():
            if not any(t.lower() in ("table", "random-table") for t in p["tags"]):
                continue
            entries = [re.sub(r"^\s*(?:[-*+]|\d+[.)])\s+", "", line).strip()
                       for line in p["body"].splitlines() if re.match(r"^\s*(?:[-*+]|\d+[.)])\s+\S", line)]
            if entries:
                out.append({"id": p["id"], "title": p["title"], "entries": entries, "gm": p["visibility"] == "gm"})
        out.sort(key=lambda x: natural_key(x["title"]))
        return out

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

    def _mentions(self, text):
        """Page ids that a piece of text mentions by title, alias or first name: {page id: count}."""
        names = self.link_names()
        if not names or not text:
            return {}
        rx = re.compile(r"(?<![\w])(" + "|".join(re.escape(n) for n, _ in names) + r")(?![\w])", re.I)
        by_lower = {n.lower(): pid for n, pid in names}
        out = {}
        for m in rx.finditer(text):
            pid = by_lower.get(m.group(1).lower())
            if pid:
                out[pid] = out.get(pid, 0) + 1
        return out

    def thread_nudges(self, plan_text):
        """Open loose threads that involve someone or something a session plan mentions, most overlap first."""
        in_plan = set(self._mentions(plan_text))
        titles = {p["id"]: p["title"] for p in self._scan()}
        out = []
        for t in self.threads():
            if t.get("status") not in ("open", "proposed"):
                continue
            text = " ".join([t.get("title") or "", t.get("detail") or "", t.get("quote") or ""] +
                            [n.get("text", "") for n in t.get("notes") or []])
            shared = sorted(set(self._mentions(text)) & in_plan, key=lambda pid: titles.get(pid, pid))
            if shared:
                out.append({"id": t["id"], "title": t["title"], "detail": t.get("detail") or "", "kind": t.get("kind") or "",
                            "status": t["status"], "shared": [titles.get(pid, pid) for pid in shared]})
        out.sort(key=lambda x: (-len(x["shared"]), x["title"].lower()))
        return out

    def campaign_stats(self):
        """Numbers for the stats page: sessions, hours recorded, talk time, most-mentioned pages, threads and tags."""
        sessions = self.sessions()
        pages = self._scan()
        titles = {p["id"]: p for p in pages}
        hours = 0.0
        mentions, per_session = {}, []
        for s in sessions:
            tr = read_json(s["dir"] / "transcript.json", None) if s["has_transcript"] else None
            if tr:
                segs = tr.get("segments") or []
                hours += float(tr.get("duration") or (segs[-1].get("end", 0) if segs else 0)) / 3600
            recap = s["dir"] / "recap.md"
            if recap.exists():
                for pid, n in self._mentions(recap.read_text(encoding="utf-8", errors="replace")).items():
                    row = mentions.setdefault(pid, {"id": pid, "title": titles[pid]["title"] if pid in titles else pid,
                                                    "tags": titles[pid]["tags"] if pid in titles else [], "count": 0, "sessions": 0})
                    row["count"] += n
                    row["sessions"] += 1
        threads = self.threads()
        by_status = {}
        for t in threads:
            by_status[t.get("status") or "open"] = by_status.get(t.get("status") or "open", 0) + 1
        for s in sessions:
            opened = sum(1 for t in threads if (t.get("sessions") or [None])[0] == s["id"])
            # a thread's last session is the one that settled it (resolving adds that session's note)
            resolved = sum(1 for t in threads if t.get("status") == "resolved" and (t.get("sessions") or [None])[-1] == s["id"])
            per_session.append({"id": s["id"], "number": s["number"], "title": s["title"], "status": s["status"],
                                "opened": opened, "resolved": resolved})
        tags = {}
        for p in pages:
            for t in p["tags"]:
                tags[t] = tags.get(t, 0) + 1
        return {
            "sessions": len(sessions), "played": sum(1 for s in sessions if s["status"] != "planned"),
            "recapped": sum(1 for s in sessions if s["status"] == "recapped"), "hours": round(hours, 1),
            "pages": len(pages), "spotlight": self.spotlight_all()["people"],
            "mentioned": sorted(mentions.values(), key=lambda r: (-r["count"], r["title"].lower()))[:12],
            "threads": by_status, "per_session": per_session,
            "tags": sorted(([t, n] for t, n in tags.items()), key=lambda x: -x[1])[:12],
        }

    def stats(self):
        pages = self._scan()
        sessions = self.sessions()
        maps = list((self.root / "maps").glob("*.json")) if (self.root / "maps").is_dir() else []
        return {"pages": len(pages), "sessions": len(sessions),
                "recapped": sum(1 for s in sessions if s["status"] == "recapped"),
                "gm_pages": sum(1 for p in pages if p["visibility"] == "gm"),
                "maps": len(maps)}
