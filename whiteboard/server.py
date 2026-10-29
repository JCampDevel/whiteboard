"""Tiny local web server: serves the page and loads/saves the diagram file."""

from __future__ import annotations

import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import model

STATIC = Path(__file__).parent / "static"
PAGES = {"/": "index.html", "/app.js": "app.js", "/style.css": "style.css"}
MAX_BODY = 5 * 1024 * 1024


def make_server(diagram_file: Path, host: str = "127.0.0.1", port: int = 8000):
    diagram_file = Path(diagram_file)

    class Handler(BaseHTTPRequestHandler):
        def _send(self, status: int, body: bytes, ctype: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status: int, payload: dict) -> None:
            self._send(status, json.dumps(payload).encode(), "application/json")

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path == "/api/diagram":
                try:
                    self._json(200, model.load(diagram_file).to_dict())
                except model.DiagramError as exc:
                    self._json(500, {"error": str(exc)})
            elif path == "/api/tables":
                try:
                    self._json(200, {"tables": model.tables(model.load(diagram_file))})
                except model.DiagramError as exc:
                    self._json(500, {"error": str(exc)})
            elif path in PAGES:
                name = PAGES[path]
                ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
                self._send(200, (STATIC / name).read_bytes(), f"{ctype}; charset=utf-8")
            else:
                self._json(404, {"error": "not found"})

        def do_PUT(self):
            if self.path.split("?", 1)[0] != "/api/diagram":
                return self._json(404, {"error": "not found"})
            try:
                length = int(self.headers.get("Content-Length", ""))
            except ValueError:
                return self._json(411, {"error": "Content-Length required"})
            if not 0 <= length <= MAX_BODY:
                return self._json(413, {"error": "diagram too large"})
            try:
                diagram = model.Diagram.from_dict(json.loads(self.rfile.read(length)))
            except (json.JSONDecodeError, UnicodeDecodeError):
                return self._json(400, {"error": "body is not valid JSON"})
            except model.DiagramError as exc:
                return self._json(400, {"error": str(exc)})
            model.save(diagram, diagram_file)
            self._json(200, {"ok": True})

        def log_message(self, *args):
            pass

    return ThreadingHTTPServer((host, port), Handler)
