"""Tiny local web server: serves the page, and creates, opens, saves and closes project files.

A project is one diagram file. The page starts with no project open (a start screen) unless one was
named on the command line; New and Open choose one, Save writes it, Close puts the page back to the
start screen. To let the page offer its own file dialogs (browsers can't show real ones everywhere),
the server can also list folders and write a copy to a file the user picks.

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
from urllib.parse import parse_qs, unquote, urlsplit

from . import model

STATIC = Path(__file__).parent / "static"
PAGES = {"/": "index.html", "/app.js": "app.js", "/route.js": "route.js", "/style.css": "style.css"}
MAX_BODY = 5 * 1024 * 1024
API_HEADER = "X-Whiteboard"
FILE_HEADER = "X-Whiteboard-File"  # on an autosave: the file the page thinks it is editing (URL-encoded)


class HttpError(Exception):
    def __init__(self, status: int, message: str, **extra):
        super().__init__(message)
        self.status, self.payload = status, {"error": message, **extra}


def file_info(path: Path) -> dict:
    return {"path": str(path), "name": path.name, "dir": str(path.parent)}


def as_folder(directory: str) -> Path:
    """A folder path typed or sent by the page, as an absolute path (or a 400 explaining what is wrong)."""
    try:
        folder = Path(directory).expanduser()  # RuntimeError for ~someone who doesn't exist
        if not folder.is_absolute():
            raise HttpError(400, "the folder must be a full path")
        folder.stat()  # ValueError for a NUL in the path; missing folders are reported by the caller
    except (RuntimeError, ValueError) as exc:
        raise HttpError(400, f"{directory} is not a usable folder: {exc}")
    except OSError:
        pass
    return folder


def browse(directory: str) -> dict:
    """The sub-folders and .json files in a folder (hidden ones left out), for the Save / Open dialogs."""
    folder = as_folder(directory).resolve()
    try:
        entries = list(folder.iterdir())
    except FileNotFoundError:
        raise HttpError(404, f"there is no folder {folder}")
    except NotADirectoryError:
        raise HttpError(400, f"{folder} is not a folder")
    except PermissionError:
        raise HttpError(403, f"you don't have permission to open {folder}")
    except OSError as exc:
        raise HttpError(400, f"{folder} can't be opened: {exc.strerror or exc}")

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
    folder = as_folder(directory)
    if not folder.is_dir():
        raise HttpError(400, f"there is no folder {folder}")
    # A symbolic link means the file it points to, so saving later writes that file and keeps the link.
    return (folder.resolve() / name).resolve()


def default_folder() -> Path:
    """Where the New / Open dialogs start when nothing has been opened yet: Documents, if there is one."""
    documents = Path.home() / "Documents"
    return documents if documents.is_dir() else Path.home()


def make_server(diagram_file: Path | None = None, host: str = "127.0.0.1", port: int = 8000):
    """With diagram_file, that project is open from the start; without, the page shows its start screen."""
    # The open project's file (None: no project open), and why it couldn't be read, if it couldn't: then
    # saving refuses to write, so a file this app can't open is never replaced by an empty diagram.
    first = Path(diagram_file).resolve() if diagram_file is not None else None
    state = {"file": first, "load_error": None, "folder": first.parent if first else default_folder()}
    lock = threading.Lock()  # one read or write of the project file at a time

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
            except (json.JSONDecodeError, UnicodeDecodeError, RecursionError):
                raise HttpError(400, "body is not valid JSON")

        def _object(self) -> dict:
            body = self._body()
            if not isinstance(body, dict):
                raise HttpError(400, "expected an object")
            return body

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
            except Exception as exc:  # a bug: still answer, so the page shows a reason, not "server unreachable"
                self._json(500, {"error": f"internal error: {exc!r}"})

        @staticmethod
        def _project() -> Path:
            if state["file"] is None:
                raise HttpError(409, "no project is open")
            return state["file"]

        @staticmethod
        def _valid(raw) -> model.Diagram:
            try:
                # Upgrading is harmless for current diagrams and lets an older one be saved or opened.
                return model.Diagram.from_dict(model.migrate(raw))
            except model.DiagramError as exc:
                raise HttpError(400, str(exc))

        # ---------- GET ----------
        def do_GET(self):
            self._handle({
                "/api/diagram": self._get_diagram,
                "/api/file": self._get_file,
                "/api/browse": self._get_browse,
                **{page: self._get_page for page in PAGES},
            })

        def _get_file(self, url):
            self._json(200, {"open": False} if state["file"] is None else {"open": True, **file_info(state["file"])})

        def _get_diagram(self, url):
            with lock:
                path = self._project()
                try:
                    diagram = model.load(path)
                except (ValueError, OSError) as exc:  # DiagramError is a ValueError
                    state["load_error"] = str(exc) if isinstance(exc, ValueError) else f"{path}: {exc.strerror or exc}"
                    raise HttpError(500, state["load_error"])
                state["load_error"] = None
            self._json(200, diagram.to_dict())

        def _get_browse(self, url):
            self._json(200, browse(parse_qs(url.query).get("dir", [""])[0] or str(state["folder"])))

        def _get_page(self, url):
            name = PAGES[url.path]
            ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
            self._send(200, (STATIC / name).read_bytes(), f"{ctype}; charset=utf-8")

        # ---------- PUT: Save ----------
        def do_PUT(self):
            self._handle({"/api/diagram": self._put_diagram})

        def _put_diagram(self, url):
            diagram = self._valid(self._body())
            claimed = self.headers.get(FILE_HEADER)
            with lock:
                current = self._project()
                if state["load_error"]:
                    raise HttpError(409, f"{current.name} couldn't be opened ({state['load_error']}), so it is not "
                                         "being overwritten. Use Save copy… to keep this drawing in another file.")
                if claimed is not None and unquote(claimed) != str(current):
                    # Sent for a project that has since been closed or switched.
                    raise HttpError(409, f"not saved: this was for {unquote(claimed)}, but the project open now is {current}")
                try:
                    model.save(diagram, current)
                except OSError as exc:
                    raise HttpError(500, f"could not save {current.name}: {exc.strerror or exc}")
            self._json(200, {"ok": True})

        # ---------- POST: projects ----------
        def do_POST(self):
            self._handle({
                "/api/new": self._new, "/api/open": self._open, "/api/close": self._close,
                "/api/save-copy": self._save_copy, "/api/tables": self._tables,
            })

        @staticmethod
        def _free(path: Path, body: dict) -> None:
            """Refuse to write over a folder, or over a file unless the page says the user agreed."""
            if path.is_dir():
                raise HttpError(400, f"{path.name} is a folder")
            if (path.exists() or path.is_symlink()) and body.get("overwrite") is not True:
                raise HttpError(409, f"{path.name} already exists", exists=True, name=path.name)

        @staticmethod
        def _write(diagram: model.Diagram, path: Path) -> None:
            try:
                model.save(diagram, path)
            except OSError as exc:
                raise HttpError(400, f"could not save {path.name}: {exc.strerror or exc}")

        def _new(self, url):
            """Start a new project: an empty diagram, saved straight away under the name given."""
            body = self._object()
            path = target_path(body.get("dir"), body.get("name"))
            self._free(path, body)
            diagram = model.Diagram()
            with lock:
                self._write(diagram, path)
                state.update(file=path, load_error=None, folder=path.parent)
            self._json(200, {"file": file_info(path), "diagram": diagram.to_dict()})

        def _open(self, url):
            body = self._object()
            path = target_path(body.get("dir"), body.get("name"))
            if not path.is_file():
                raise HttpError(404, f"there is no file {path.name} in {path.parent}")
            try:
                diagram = model.load(path)  # checks it, and upgrades a file from an older version
            except (ValueError, OSError) as exc:  # DiagramError is a ValueError; so is bad UTF-8
                raise HttpError(400, f"{path.name} can't be opened: {exc}")
            with lock:
                state.update(file=path, load_error=None, folder=path.parent)
            self._json(200, {"file": file_info(path), "diagram": diagram.to_dict()})

        def _close(self, url):
            # The page saves first if the user asked it to; closing itself never writes anything.
            with lock:
                state.update(file=None, load_error=None)
            self._json(200, {"ok": True})

        def _save_copy(self, url):
            """Write the diagram to another file. The project stays the open one, so later saves don't touch the copy."""
            body = self._object()
            path = target_path(body.get("dir"), body.get("name"))
            diagram = self._valid(body.get("diagram"))
            if path == state["file"]:
                raise HttpError(400, f"{path.name} is the project itself; give the copy a different name")
            self._free(path, body)
            with lock:
                self._write(diagram, path)
                state["folder"] = path.parent
            self._json(200, {"file": file_info(path)})

        def _tables(self, url):
            # From the diagram on screen (saved or not), so the tables always match what you see.
            self._json(200, {"tables": model.tables(self._valid(self._body()))})

        def log_message(self, *args):
            pass

    return ThreadingHTTPServer((host, port), Handler)
