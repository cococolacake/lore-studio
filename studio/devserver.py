"""Browser mode: serve the UI over http://127.0.0.1 and expose Api methods at POST /api/<name>.

Used for development, and as a fallback when pywebview isn't installed.
Only listens on localhost.
"""
import json
import mimetypes
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

from .paths import WEB_DIR


def make_handler(api):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):  # keep the console quiet
            pass

        def _send(self, code, body, ctype="application/json", cache=False):
            data = body if isinstance(body, bytes) else json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "max-age=3600" if cache else "no-store")
            self.end_headers()
            self.wfile.write(data)

        # ---- Foundry bridge (called from a Foundry page in the GM's browser) ----
        def _foundry_cors(self):
            origin = self.headers.get("Origin")
            if origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Lore-Token")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Private-Network", "true")

        def _foundry_send(self, code, body):
            data = json.dumps(body).encode()
            self.send_response(code)
            self._foundry_cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self):
            if urlparse(self.path).path.startswith("/foundry/"):
                self.send_response(204)
                self._foundry_cors()
                self.send_header("Content-Length", "0")
                self.end_headers()
            else:
                self._send(404, {"error": "not found"})

        def _foundry(self, method):
            from . import foundry
            path = urlparse(self.path).path
            if not foundry.check(self.headers.get("X-Lore-Token")):
                return self._foundry_send(403, {"error": "bad token"})
            body = {}
            if method == "POST":
                length = min(int(self.headers.get("Content-Length") or 0), 5_000_000)
                try:
                    body = json.loads(self.rfile.read(length) or b"{}")
                except ValueError:
                    return self._foundry_send(400, {"error": "bad json"})
            try:
                if path == "/foundry/hello" and method == "POST":
                    foundry.hello(body)
                    return self._foundry_send(200, {"ok": True, "campaign": api._campaign.name if api._campaign else None})
                if path == "/foundry/events" and method == "POST":
                    camp = api._campaign
                    sid = api.live_session() if camp else None
                    n = foundry.log_events(camp, sid, body.get("events") or [])
                    return self._foundry_send(200, {"ok": True, "saved": n, "session": sid})
                if path == "/foundry/outbox" and method == "GET":
                    foundry.touch()
                    q = parse_qs(urlparse(self.path).query)
                    wait = float((q.get("wait") or ["0"])[0] or 0)
                    actions = foundry.take_outbox(wait)
                    foundry.touch()
                    return self._foundry_send(200, {"actions": actions})
                if path == "/foundry/result" and method == "POST":
                    foundry.put_result(body.get("rid"), body.get("ok"), body.get("data"), body.get("error"))
                    return self._foundry_send(200, {"ok": True})
                if path == "/foundry/inventory" and method == "POST":
                    foundry.set_inventory(body)
                    return self._foundry_send(200, {"ok": True})
            except Exception as e:  # never break Foundry: report and carry on
                return self._foundry_send(500, {"error": str(e)})
            return self._foundry_send(404, {"error": "not found"})

        def do_GET(self):
            parsed = urlparse(self.path)
            path = unquote(parsed.path)
            if path.startswith("/foundry/"):
                return self._foundry("GET")
            if path.startswith("/c/"):
                return self._campaign_file(path[3:])
            if path in ("", "/"):
                path = "/index.html"
            f = (WEB_DIR / path.lstrip("/")).resolve()
            if WEB_DIR.resolve() not in f.parents or not f.is_file():
                return self._send(404, {"error": "not found"})
            ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
            if f.suffix == ".js":
                ctype = "text/javascript"
            self._send(200, f.read_bytes(), ctype)

        def _campaign_file(self, rel):
            """Files from the open campaign folder (session HTML notes, images), read-only."""
            port = self.server.server_address[1]
            if self.headers.get("Host") not in {f"127.0.0.1:{port}", f"localhost:{port}"}:
                return self._send(403, {"error": "forbidden"})
            camp = getattr(api, "_campaign", None)
            f = camp.file_for_url(rel) if camp else None
            if not f:
                return self._send(404, {"error": "not found"})
            ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
            if ctype.startswith("text/"):
                ctype += "; charset=utf-8"
            self._send(200, f.read_bytes(), ctype)

        def _trusted(self):
            """Only our own page may call the API: same host, same origin, JSON body."""
            port = self.server.server_address[1]
            ok_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
            if self.headers.get("Host") not in ok_hosts:
                return False
            origin = self.headers.get("Origin")
            if origin and origin.rstrip("/") not in {f"http://{h}" for h in ok_hosts}:
                return False
            return (self.headers.get("Content-Type") or "").startswith("application/json")

        def do_POST(self):
            path = urlparse(self.path).path
            if path.startswith("/foundry/"):
                return self._foundry("POST")
            if not path.startswith("/api/"):
                return self._send(404, {"error": "not found"})
            if getattr(api, "_window", None) is not None:   # app window talks to Python directly
                return self._send(403, {"error": "HTTP API disabled in app mode"})
            if not self._trusted():
                return self._send(403, {"error": "forbidden"})
            name = path[5:]
            fn = getattr(api, name, None)
            if name.startswith("_") or not callable(fn):
                return self._send(404, {"error": f"no method {name}"})
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            try:
                result = fn(*body.get("args", []))
                self._send(200, {"result": result})
            except Exception as e:  # surface backend errors to the UI
                self._send(200, {"error": str(e)})

    return Handler


def serve(api, port=0, background=False):
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(api))
    url = f"http://127.0.0.1:{server.server_address[1]}/"
    api._base_url = url.rstrip("/")
    if background:
        threading.Thread(target=server.serve_forever, daemon=True).start()
        return server, url
    print(f"Lore Studio running at {url}")
    server.serve_forever()
