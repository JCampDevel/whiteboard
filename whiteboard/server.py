"""Tiny local web server: serves the page, and loads and saves the diagram file it is working on.

The file being worked on can change: Save as and Open switch to another file, as in a desktop app.
To let the page offer its own Save and Open dialogs (browsers can't show real ones everywhere), the
server can also list folders and save to or open a file the user picks.

Because that reaches the user's files, the server answers only requests addressed to it on this
machine (127.0.0.1 / localhost, which stops DNS-rebinding tricks) and, for anything under /api/,
only requests carrying an X-Whiteboard header. A web page from another site can't add that header
without the browser first asking this server's permission, which it never gives.
"""

from __future__ import annotations

import json
import mimetypes
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from . import model

STATIC = Path(__file__).parent / "static"
PAGES = {"/": "index.html", "/app.js": "app.js", "/route.js": "route.js", "/style.css": "style.css"}
MAX_BODY = 5 * 1024 * 1024
API_HEADER = "X-Whiteboard"


class HttpError(Exception):
    def __init__(self, status: int, message: str, **extra):
        super().__init__(message)
        self.status, self.payload = status, {"error": message, **extra}


def file_info(path: Path) -> dict:
    return {"path": str(path), "name": path.name, "dir": str(path.parent)}


def browse(directory: str) -> dict:
    """The sub-folders and .json files in a folder (hidden ones left out), for the Save / Open dialogs."""
    folder = Path(directory).expanduser()
    if not folder.is_absolute():
        raise HttpError(400, "the folder must be a full path")
    folder = folder.resolve()
    try:
        entries = list(folder.iterdir())
    except FileNotFoundError:
        raise HttpError(404, f"there is no folder {folder}")
    except NotADirectoryError:
        raise HttpError(400, f"{folder} is not a folder")
    except PermissionError:
        raise HttpError(403, f"you don't have permission to open {folder}")

    def kind(entry: Path) -> str | None:
        if entry.name.startswith("."):
            return None
        try:
            if entry.is_dir():
                return "folder"
            if entry.is_file() and entry.suffix.lower() == ".json":
                return "file"
        except OSError:
            pass
        return None

    listed = sorted(((kind(e), e) for e in entries), key=lambda ke: ke[1].name.lower())
    return {
        "dir": str(folder),
        "parent": str(folder.parent) if folder.parent != folder else None,
        "home": str(Path.home()),
        "folders": [{"name": e.name, "path": str(e)} for k, e in listed if k == "folder"],
        "files": [{"name": e.name, "path": str(e)} for k, e in listed if k == "file"],
    }


def target_path(directory, name) -> Path:
    """The file a name typed in the Save / Open dialog means: in that folder, ending in .json."""
    if not isinstance(directory, str) or not isinstance(name, str):
        raise HttpError(400, "a folder and a file name are needed")
    name = name.strip()
    if not name or name in (".", "..") or any(c in name for c in "/\\\0"):
        raise HttpError(400, f"{name or 'an empty name'} is not a valid file name")
    if not name.lower().endswith(".json"):
        name += ".json"
    folder = Path(directory).expanduser()
    if not folder.is_absolute():
        raise HttpError(400, "the folder must be a full path")
    if not folder.is_dir():
        raise HttpError(400, f"there is no folder {folder}")
    return folder.resolve() / name


def make_server(diagram_file: Path, host: str = "127.0.0.1", port: int = 8000):
    state = {"file": Path(diagram_file).resolve()}  # the file being worked on; Save as / Open change it
    lock = threading.Lock()  # one read or write of the working file at a time

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

        def _check(self, path: str) -> None:
            own = self.server.server_address[1]
            if self.headers.get("Host") not in (f"127.0.0.1:{own}", f"localhost:{own}"):
                raise HttpError(403, "this server only answers requests to 127.0.0.1 or localhost")
            if path.startswith("/api/") and self.headers.get(API_HEADER) != "1":
                raise HttpError(403, f"requests to the API must carry the {API_HEADER} header")

        def _body(self):
            try:
                length = int(self.headers.get("Content-Length", ""))
            except ValueError:
                raise HttpError(411, "Content-Length required")
            if not 0 <= length <= MAX_BODY:
                raise HttpError(413, "diagram too large")
            try:
                return json.loads(self.rfile.read(length))
            except (json.JSONDecodeError, UnicodeDecodeError):
                raise HttpError(400, "body is not valid JSON")

        def _handle(self, routes: dict) -> None:
            url = urlsplit(self.path)
            try:
                self._check(url.path)
                route = routes.get(url.path)
                if route is None:
                    raise HttpError(404, "not found")
                route(url)
            except HttpError as exc:
                self._json(exc.status, exc.payload)

        # ---------- GET ----------
        def do_GET(self):
            self._handle({
                "/api/diagram": self._get_diagram, "/api/tables": self._get_tables,
                "/api/file": lambda url: self._json(200, file_info(state["file"])),
                "/api/browse": self._get_browse,
                **{page: self._get_page for page in PAGES},
            })

        def _load_current(self) -> model.Diagram:
            try:
                with lock:
                    return model.load(state["file"])
            except model.DiagramError as exc:
                raise HttpError(500, str(exc))

        def _get_diagram(self, url):
            self._json(200, self._load_current().to_dict())

        def _get_tables(self, url):
            self._json(200, {"tables": model.tables(self._load_current())})

        def _get_browse(self, url):
            folder = parse_qs(url.query).get("dir", [""])[0] or str(state["file"].parent)
            self._json(200, browse(folder))

        def _get_page(self, url):
            name = PAGES[url.path]
            ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
            self._send(200, (STATIC / name).read_bytes(), f"{ctype}; charset=utf-8")

        # ---------- PUT: autosave ----------
        def do_PUT(self):
            self._handle({"/api/diagram": self._put_diagram})

        @staticmethod
        def _valid(raw) -> model.Diagram:
            try:
                # Upgrading is harmless for current diagrams and lets an older one be saved or opened.
                return model.Diagram.from_dict(model.migrate(raw))
            except model.DiagramError as exc:
                raise HttpError(400, str(exc))

        def _put_diagram(self, url):
            diagram = self._valid(self._body())
            with lock:
                model.save(diagram, state["file"])
            self._json(200, {"ok": True})

        # ---------- POST: Save as / Open ----------
        def do_POST(self):
            self._handle({"/api/save-as": self._save_as, "/api/open": self._open})

        def _save_as(self, url):
            body = self._body()
            if not isinstance(body, dict):
                raise HttpError(400, "expected an object")
            path = target_path(body.get("dir"), body.get("name"))
            diagram = self._valid(body.get("diagram"))
            if path.is_dir():
                raise HttpError(400, f"{path.name} is a folder")
            if path.exists() and body.get("overwrite") is not True:
                raise HttpError(409, f"{path.name} already exists", exists=True, name=path.name)
            with lock:
                try:
                    model.save(diagram, path)
                except OSError as exc:
                    raise HttpError(400, f"could not save {path.name}: {exc.strerror or exc}")
                state["file"] = path
            self._json(200, {"file": file_info(path)})

        def _open(self, url):
            body = self._body()
            if not isinstance(body, dict):
                raise HttpError(400, "expected an object")
            path = target_path(body.get("dir"), body.get("name"))
            if not path.is_file():
                raise HttpError(404, f"there is no file {path.name} in {path.parent}")
            try:
                diagram = model.load(path)  # checks it, and upgrades a file from an older version
            except (ValueError, OSError) as exc:  # DiagramError is a ValueError; so is bad UTF-8
                raise HttpError(400, f"{path.name} can't be opened: {exc}")
            with lock:
                state["file"] = path
            self._json(200, {"file": file_info(path), "diagram": diagram.to_dict()})

        def log_message(self, *args):
            pass

    return ThreadingHTTPServer((host, port), Handler)
