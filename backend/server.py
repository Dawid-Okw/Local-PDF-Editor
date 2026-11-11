"""Folio PDF Editor - local web server.

Run:  python backend/server.py [--port 8765] [--no-idle-exit]

Serves the web UI from ../web and a small JSON/binary API. Binds to
127.0.0.1 only. Exits automatically a few minutes after the last browser
window is closed (heartbeats stop), unless --no-idle-exit is given.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WEB = os.path.join(ROOT, "web")
LOG_DIR = os.path.join(ROOT, "logs")
APP_ID = "folio-pdf-editor"
VERSION = "1.0.0"

# pythonw.exe has no console: route output to a log file
if sys.stdout is None or sys.stderr is None or "--log" in sys.argv:
    os.makedirs(LOG_DIR, exist_ok=True)
    _log = open(os.path.join(LOG_DIR, "server.log"), "a", encoding="utf-8", buffering=1)
    sys.stdout = sys.stderr = _log

sys.path.insert(0, HERE)
import fonts  # noqa: E402
import pdfcore  # noqa: E402

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")


class Activity:
    last = time.time()
    bye_at = 0.0
    lock = threading.Lock()

    @classmethod
    def touch(cls):
        with cls.lock:
            cls.last = time.time()
            cls.bye_at = 0.0

    @classmethod
    def bye(cls):
        with cls.lock:
            cls.bye_at = time.time()


ROUTES: list[tuple[str, re.Pattern, str]] = []


def route(method: str, pattern: str):
    def deco(fn):
        ROUTES.append((method, re.compile("^" + pattern + "$"), fn.__name__))
        return fn
    return deco


class HttpError(Exception):
    def __init__(self, code: int, message: str, extra: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.extra = extra or {}


class Handler(BaseHTTPRequestHandler):
    server_version = "Folio/" + VERSION
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # keep the log quiet
        pass

    # ------------------------------------------------------------------ #
    def _host_ok(self) -> bool:
        host = (self.headers.get("Host") or "").lower()
        hostname = host.rsplit(":", 1)[0] if not host.startswith("[") else host.split("]")[0] + "]"
        return hostname in ("127.0.0.1", "localhost", "[::1]")

    def _send(self, code: int, body: bytes, ctype: str, headers: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, obj, code: int = 200):
        self._send(code, json.dumps(obj, separators=(",", ":")).encode("utf-8"),
                   "application/json; charset=utf-8", {"Cache-Control": "no-store"})

    def _body(self) -> bytes:
        n = int(self.headers.get("Content-Length") or 0)
        if n > 1024 * 1024 * 1024:
            raise HttpError(413, "File too large")
        chunks, left = [], n
        while left > 0:
            chunk = self.rfile.read(min(left, 1 << 20))
            if not chunk:
                break
            chunks.append(chunk)
            left -= len(chunk)
        return b"".join(chunks)

    def _json_body(self):
        try:
            return json.loads(self._body() or b"{}")
        except json.JSONDecodeError as exc:
            raise HttpError(400, "Invalid JSON") from exc

    # ------------------------------------------------------------------ #
    def do_GET(self):
        self._dispatch("GET")

    def do_HEAD(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def _dispatch(self, method: str):
        if not self._host_ok():
            self._send(403, b"Forbidden", "text/plain")
            return
        Activity.touch()
        url = urlparse(self.path)
        self.query = parse_qs(url.query)
        path = unquote(url.path)
        try:
            if path.startswith("/api/"):
                for m, rx, name in ROUTES:
                    if m == method:
                        mt = rx.match(path)
                        if mt:
                            getattr(self, name)(*mt.groups())
                            return
                raise HttpError(404, "Unknown endpoint")
            if method != "GET":
                raise HttpError(405, "Method not allowed")
            self._static(path)
        except HttpError as e:
            self._json({"error": e.message, **e.extra}, e.code)
        except KeyError:
            self._json({"error": "Document not found. Please open the file again."}, 404)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            try:
                self._json({"error": str(e) or e.__class__.__name__}, 500)
            except Exception:  # noqa: BLE001
                pass

    def _q(self, name: str, default=None):
        v = self.query.get(name)
        return v[0] if v else default

    def _static(self, path: str):
        if path in ("", "/"):
            path = "/index.html"
        full = os.path.normpath(os.path.join(WEB, path.lstrip("/")))
        if not full.startswith(WEB) or not os.path.isfile(full):
            raise HttpError(404, "Not found")
        with open(full, "rb") as fh:
            data = fh.read()
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        self._send(200, data, ctype, {"Cache-Control": "no-cache"})

    # ------------------------------------------------------------------ #
    #  API
    # ------------------------------------------------------------------ #
    @route("GET", r"/api/health")
    def api_health(self):
        self._json({"app": APP_ID, "version": VERSION, "pid": os.getpid()})

    @route("POST", r"/api/heartbeat")
    def api_heartbeat(self):
        self._json({"ok": True})

    @route("POST", r"/api/bye")
    def api_bye(self):
        self._body()
        Activity.bye()
        self._json({"ok": True})

    @route("GET", r"/api/fonts")
    def api_fonts(self):
        self._json({"families": fonts.public_list()})

    @route("GET", r"/api/fontfile/([\w]+)/(r|b|i|bi)")
    def api_fontfile(self, fid, variant):
        res = fonts.font_file(fid, variant)
        if not res:
            raise HttpError(404, "Font not found")
        data, mime = res
        self._send(200, data, mime, {"Cache-Control": "max-age=86400"})

    @route("POST", r"/api/docs")
    def api_upload(self):
        name = self._q("name") or "document.pdf"
        data = self._body()
        try:
            info = pdfcore.open_document(data, name)
        except pdfcore.NeedPassword as e:
            raise HttpError(401, "This PDF is password protected.",
                            {"needsPassword": True, "pending": str(e)}) from e
        except ValueError as e:
            raise HttpError(400, str(e)) from e
        self._json(info)

    @route("POST", r"/api/unlock/(\w+)")
    def api_unlock(self, pid):
        body = self._json_body()
        try:
            info = pdfcore.unlock(pid, body.get("password") or "")
        except pdfcore.BadPassword as e:
            raise HttpError(403, "Incorrect password.", {"badPassword": True}) from e
        self._json(info)

    @route("GET", r"/api/docs/(\w+)")
    def api_doc(self, sid):
        with pdfcore.LOCK:
            self._json(pdfcore.get(sid).info())

    @route("GET", r"/api/docs/(\w+)/pages/(\d+)/render")
    def api_render(self, sid, index):
        scale = float(self._q("s", "1"))
        hide = []
        h = self._q("h")
        if h:
            for part in h.split(";"):
                vals = [float(v) for v in part.split(",") if v]
                if len(vals) == 4:
                    hide.append(vals)
        fmt = "jpeg" if self._q("f") == "jpeg" else "png"
        data = pdfcore.render(sid, int(index), scale, hide, self._q("nw") == "1", fmt)
        self._send(200, data, "image/jpeg" if fmt == "jpeg" else "image/png",
                   {"Cache-Control": "private, max-age=3600"})

    @route("GET", r"/api/docs/(\w+)/pages/(\d+)/text")
    def api_text(self, sid, index):
        self._json(pdfcore.page_text(sid, int(index)))

    @route("GET", r"/api/docs/(\w+)/pages/(\d+)/fields")
    def api_fields(self, sid, index):
        self._json({"fields": pdfcore.page_fields(sid, int(index))})

    @route("GET", r"/api/docs/(\w+)/fonts/(\d+)")
    def api_docfont(self, sid, xref):
        res = pdfcore.font_for_browser(sid, int(xref))
        if not res:
            raise HttpError(404, "Font not available")
        self._send(200, res[0], res[1], {"Cache-Control": "private, max-age=3600"})

    @route("POST", r"/api/export")
    def api_export(self):
        spec = self._json_body()
        try:
            data = pdfcore.export(spec)
        except ValueError as e:
            raise HttpError(400, str(e)) from e
        self._send(200, data, "application/pdf", {"Cache-Control": "no-store"})


def _watchdog(httpd: ThreadingHTTPServer, idle: float):
    while True:
        time.sleep(5)
        pdfcore.cleanup_pending()
        now = time.time()
        with Activity.lock:
            quiet = now - Activity.last
            bye = Activity.bye_at
        if (bye and now - bye > 25 and quiet > 25) or quiet > idle:
            print(time.strftime("%H:%M:%S"), "no open editor windows - shutting down")
            httpd.shutdown()
            return


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--idle", type=float, default=300, help="seconds without a window before exit")
    ap.add_argument("--no-idle-exit", action="store_true")
    ap.add_argument("--log", action="store_true", help="write output to logs/server.log")
    args = ap.parse_args()

    ThreadingHTTPServer.daemon_threads = True
    httpd = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    threading.Thread(target=fonts.families, daemon=True).start()  # warm the font cache
    if not args.no_idle_exit:
        threading.Thread(target=_watchdog, args=(httpd, args.idle), daemon=True).start()
    print(time.strftime("%Y-%m-%d %H:%M:%S"), f"Folio PDF Editor running on http://127.0.0.1:{args.port}")
    try:
        httpd.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    httpd.server_close()


if __name__ == "__main__":
    main()
