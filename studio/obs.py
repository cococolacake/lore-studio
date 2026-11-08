"""Talk to OBS through obs-websocket v5 (built into OBS 28+). Standard library only.

In OBS: Tools → WebSocket Server Settings → Enable, and copy the password into Lore Studio.
"""
import base64
import hashlib
import json
import os
import socket
import struct
import uuid

from . import settings


class OBSError(Exception):
    pass


class _WS:
    """Just enough of a WebSocket client (RFC 6455) for local JSON text messages."""

    def __init__(self, host, port, timeout=5):
        try:
            self.sock = socket.create_connection((host, port), timeout=timeout)
        except OSError as e:
            raise OBSError(f"Couldn't connect to OBS at {host}:{port}. Is OBS open with the WebSocket server enabled? ({e})") from None
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET / HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                           f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n"
                           "Sec-WebSocket-Protocol: obswebsocket.json\r\n\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(1024)
            if not chunk:
                raise OBSError("OBS closed the connection during the handshake.")
            head += chunk
        self.buf = head.split(b"\r\n\r\n", 1)[1]
        status = head.split(b"\r\n", 1)[0]
        if b" 101 " not in status:
            raise OBSError(f"OBS didn't accept the connection: {status.decode(errors='replace')}")
        accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        if accept.encode() not in head:
            raise OBSError("Unexpected reply from OBS (not a WebSocket server?).")

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise OBSError("OBS closed the connection.")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def send(self, obj):
        data = json.dumps(obj).encode()
        head = bytes([0x81])
        n = len(data)
        if n < 126:
            head += bytes([0x80 | n])
        elif n < 65536:
            head += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            head += bytes([0x80 | 127]) + struct.pack(">Q", n)
        mask = os.urandom(4)
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv(self):
        parts = []
        while True:
            b1, b2 = self._read(2)
            op, n = b1 & 0x0F, b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            mask = self._read(4) if b2 & 0x80 else None
            payload = self._read(n)
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            if op == 0x8:
                code = struct.unpack(">H", payload[:2])[0] if len(payload) >= 2 else 0
                reason = payload[2:].decode(errors="replace")
                if code == 4009:
                    raise OBSError("OBS rejected the password. Copy it again from Tools → WebSocket Server Settings.")
                raise OBSError(f"OBS closed the connection ({code} {reason}).".strip())
            if op == 0x9:      # ping
                continue
            if op in (0x1, 0x0):
                parts.append(payload)
                if b1 & 0x80:
                    return json.loads(b"".join(parts).decode())

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


class Client:
    def __init__(self, host=None, port=None, password=None, timeout=5):
        s = settings.load()
        self.host = host or s.get("obs_host") or "127.0.0.1"
        self.port = int(port or s.get("obs_port") or 4455)
        self.password = s.get("obs_password") if password is None else password
        self.timeout = timeout

    def __enter__(self):
        self.ws = _WS(self.host, self.port, self.timeout)
        hello = self.ws.recv()
        if hello.get("op") != 0:
            raise OBSError("OBS sent an unexpected first message.")
        ident = {"rpcVersion": 1, "eventSubscriptions": 0}
        auth = hello["d"].get("authentication")
        if auth:
            if not self.password:
                raise OBSError("OBS asks for a password. Add it in Settings → OBS.")
            secret = base64.b64encode(hashlib.sha256((self.password + auth["salt"]).encode()).digest()).decode()
            ident["authentication"] = base64.b64encode(hashlib.sha256((secret + auth["challenge"]).encode()).digest()).decode()
        self.ws.send({"op": 1, "d": ident})
        while True:
            msg = self.ws.recv()
            if msg.get("op") == 2:
                break
        return self

    def __exit__(self, *exc):
        self.ws.close()

    def request(self, kind, data=None):
        rid = uuid.uuid4().hex
        self.ws.send({"op": 6, "d": {"requestType": kind, "requestId": rid, "requestData": data or {}}})
        while True:
            msg = self.ws.recv()
            if msg.get("op") == 7 and msg["d"].get("requestId") == rid:
                st = msg["d"].get("requestStatus") or {}
                if not st.get("result"):
                    raise OBSError(f"OBS couldn't do “{kind}”: {st.get('comment') or st.get('code')}")
                return msg["d"].get("responseData") or {}


def call(kind, data=None):
    with Client() as c:
        return c.request(kind, data)


def test():
    with Client() as c:
        v = c.request("GetVersion")
        st = c.request("GetRecordStatus")
    return {"obs": v.get("obsVersion"), "websocket": v.get("obsWebSocketVersion"), "recording": st.get("outputActive")}


def status():
    st = call("GetRecordStatus")
    return {"active": st.get("outputActive"), "paused": st.get("outputPaused"),
            "seconds": round((st.get("outputDuration") or 0) / 1000), "timecode": st.get("outputTimecode")}


def start():
    call("StartRecord")
    return status()


def stop():
    return call("StopRecord").get("outputPath") or ""


def chapter(name):
    """Name a moment in the recording. Saved in the video when OBS records Hybrid MP4; we keep our own copy too."""
    st = status()
    if not st["active"]:
        raise OBSError("OBS isn't recording.")
    try:
        call("CreateRecordChapter", {"chapterName": name})
        in_file = True
    except OBSError:
        in_file = False
    return {"seconds": st["seconds"], "in_file": in_file}
