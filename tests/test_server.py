import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path

from whiteboard.server import make_server

GOOD = {
    "nodes": [
        {"id": "C1", "type": "controller", "x": 0, "y": 0, "w": 360, "h": 140},
        {"id": "CA1", "type": "control_algorithm", "parent": "C1", "x": 190, "y": 26, "w": 164, "h": 47},
        {"id": "PM1", "type": "process_model", "parent": "C1", "x": 190, "y": 83, "w": 164, "h": 47},
        {"id": "CP1", "type": "controlled_process", "x": 0, "y": 300, "w": 360, "h": 100},
    ],
    "edges": [
        {"id": "A1", "type": "control_action", "source": "CA1", "target": "CP1"},
        {"id": "F1", "type": "feedback", "source": "CP1", "target": "PM1", "style": "dashed"},
    ],
}


class ServerCase(unittest.TestCase):
    """Starts a server on a free localhost port with its file in a temporary folder."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.file = Path(self.tmp.name) / "d.json"
        self.server = make_server(self.file, port=0)  # port 0: any free port, localhost only
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.port = self.server.server_address[1]

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def call(self, method, path, body=None, headers=None):
        """A request as the page makes it (with the API header), unless `headers` says otherwise."""
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        if isinstance(body, (dict, list)):
            body = json.dumps(body)
        c.request(method, path, body=body, headers={"X-Whiteboard": "1", **(headers or {})})
        r = c.getresponse()
        data = r.read()
        c.close()
        return r.status, data


class ServerTests(ServerCase):
    def test_binds_to_localhost_only(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")

    def test_pages_are_served(self):
        for path, marker in (("/", b"<svg"), ("/app.js", b"use strict"), ("/route.js", b"routeOrthogonal"), ("/style.css", b"--bg")):
            with self.subTest(path=path):
                status, data = self.call("GET", path)
                self.assertEqual(status, 200)
                self.assertIn(marker, data)

    def test_unknown_and_traversal_paths_404(self):
        for path in ("/nope", "/../server.py", "/static/app.js", "/%2e%2e/server.py"):
            with self.subTest(path=path):
                self.assertEqual(self.call("GET", path)[0], 404)

    def test_new_diagram_is_empty(self):
        status, data = self.call("GET", "/api/diagram")
        self.assertEqual((status, json.loads(data)), (200, {"format": "whiteboard-diagram", "format_version": 1, "nodes": [], "edges": [], "relationships": []}))

    def test_put_saves_and_get_returns_it(self):
        status, _ = self.call("PUT", "/api/diagram", GOOD)
        self.assertEqual(status, 200)
        self.assertTrue(self.file.exists())
        got = json.loads(self.call("GET", "/api/diagram")[1])
        self.assertEqual([n["id"] for n in got["nodes"]], ["C1", "CA1", "PM1", "CP1"])
        self.assertEqual(got["edges"][1]["style"], "dashed")

    def test_an_older_file_can_be_opened_through_the_page(self):
        old = {"nodes": [{"id": "n1", "type": "controller", "x": 0, "y": 0, "w": 100, "h": 60},
                         {"id": "n2", "type": "controlled_process", "x": 0, "y": 300, "w": 100, "h": 60}],
               "edges": [{"id": "e1", "type": "control_action", "source": "n1", "target": "n2"}]}
        self.assertEqual(self.call("PUT", "/api/diagram", old)[0], 200)
        got = json.loads(self.call("GET", "/api/diagram")[1])
        self.assertEqual(got["format"], "whiteboard-diagram")
        self.assertEqual([(e["id"], e["source"], e["target"]) for e in got["edges"]], [("A1", "C1", "CP1")])

    def test_opening_something_that_is_not_a_diagram_changes_nothing(self):
        self.call("PUT", "/api/diagram", GOOD)
        before = self.file.read_text()
        status, data = self.call("PUT", "/api/diagram", {"format": "spreadsheet", "rows": []})
        self.assertEqual(status, 400)
        self.assertIn("not a whiteboard diagram", json.loads(data)["error"])
        self.assertEqual(self.file.read_text(), before)

    def test_tables_come_from_the_diagram_sent_not_the_file(self):
        # The page asks for tables of what is on screen, saved or not.
        status, data = self.call("POST", "/api/tables", GOOD)
        self.assertEqual(status, 200)
        tables = json.loads(data)["tables"]
        self.assertEqual([t["key"] for t in tables], [
            "controller", "control_algorithm", "process_model", "controlled_process", "control_action", "feedback",
            "relationship"])
        controller = tables[0]["rows"][0]
        self.assertEqual((controller["id"], controller["control_algorithm"], controller["outgoing"], controller["incoming"]),
                         ("C1", "CA1", ["A1"], ["F1"]))
        self.assertFalse(self.file.exists())  # nothing was written

    def test_tables_for_an_empty_diagram_and_a_bad_one(self):
        status, data = self.call("POST", "/api/tables", {"nodes": [], "edges": []})
        self.assertEqual((status, len(json.loads(data)["tables"])), (200, 7))
        self.assertEqual(self.call("POST", "/api/tables", {"nodes": [{"id": "C1"}]})[0], 400)

    def test_an_old_format_file_is_upgraded_when_opened(self):
        self.file.write_text(json.dumps({
            "nodes": [{"id": "n1", "type": "controller", "x": 0, "y": 0, "w": 100, "h": 60}], "edges": []}))
        got = json.loads(self.call("GET", "/api/diagram")[1])
        self.assertEqual(sorted(n["id"] for n in got["nodes"]), ["C1", "CA1", "PM1"])

    def test_invalid_diagram_is_rejected_and_nothing_written(self):
        bad = {"nodes": GOOD["nodes"], "edges": [{"id": "F1", "type": "feedback", "source": "CP1", "target": "PM9"}]}
        status, data = self.call("PUT", "/api/diagram", bad)
        self.assertEqual(status, 400)
        self.assertIn("error", json.loads(data))
        self.assertFalse(self.file.exists())

    def test_non_json_body_rejected(self):
        self.assertEqual(self.call("PUT", "/api/diagram", "{oops")[0], 400)

    def test_oversize_body_rejected_without_reading_it(self):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        c.putrequest("PUT", "/api/diagram")
        c.putheader("X-Whiteboard", "1")
        c.putheader("Content-Length", str(50 * 1024 * 1024))
        c.endheaders()
        self.assertEqual(c.getresponse().status, 413)
        c.close()

    def test_corrupt_file_gives_500_not_a_crash(self):
        self.file.write_text("{broken")
        self.assertEqual(self.call("GET", "/api/diagram")[0], 500)
        self.assertEqual(self.call("GET", "/")[0], 200)


if __name__ == "__main__":
    unittest.main()


class ProtectionTests(ServerCase):
    """Other web pages open in the same browser must not be able to use the API."""

    def test_api_needs_the_page_header(self):
        for method, path, body in (("GET", "/api/diagram", None), ("GET", "/api/browse", None),
                                   ("PUT", "/api/diagram", GOOD), ("POST", "/api/open", {"dir": "/", "name": "x"})):
            with self.subTest(path=path):
                c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
                c.request(method, path, body=json.dumps(body) if body else None)
                self.assertEqual(c.getresponse().status, 403)
                c.close()
        self.assertFalse(self.file.exists())

    def test_requests_for_another_host_name_are_refused(self):
        # What a DNS-rebinding page would send: our address, but its own host name.
        for path in ("/", "/api/diagram"):
            with self.subTest(path=path):
                status, _ = self.call("GET", path, headers={"Host": f"evil.example:{self.port}"})
                self.assertEqual(status, 403)
        self.assertEqual(self.call("GET", "/", headers={"Host": f"localhost:{self.port}"})[0], 200)


class FileTests(ServerCase):
    """Save as and Open: the page's own dialogs, which switch the file being worked on."""

    def setUp(self):
        super().setUp()
        self.dir = Path(self.tmp.name)
        (self.dir / "sub").mkdir()
        (self.dir / ".hidden").mkdir()
        (self.dir / "notes.txt").write_text("x")
        (self.dir / "B.json").write_text("{}")
        (self.dir / "a.json").write_text("{}")

    def post(self, path, body):
        status, data = self.call("POST", path, body)
        return status, json.loads(data)

    def test_current_file(self):
        status, data = self.call("GET", "/api/file")
        self.assertEqual((status, json.loads(data)["open"], json.loads(data)["name"]), (200, True, "d.json"))

    def test_browse_lists_folders_and_json_files_only(self):
        status, data = self.call("GET", "/api/browse")  # defaults to the current file's folder
        data = json.loads(data)
        self.assertEqual(status, 200)
        self.assertEqual(data["dir"], str(self.dir.resolve()))
        self.assertEqual([f["name"] for f in data["folders"]], ["sub"])
        self.assertEqual([f["name"] for f in data["files"]], ["a.json", "B.json"])
        self.assertEqual(data["parent"], str(self.dir.resolve().parent))

    def test_browse_errors(self):
        from urllib.parse import quote
        self.assertEqual(self.call("GET", "/api/browse?dir=" + quote(str(self.dir / "missing")))[0], 404)
        self.assertEqual(self.call("GET", "/api/browse?dir=relative/path")[0], 400)
        self.assertEqual(self.call("GET", "/api/browse?dir=" + quote(str(self.dir / "a.json")))[0], 400)

    def test_new_project_creates_an_empty_file_and_opens_it(self):
        status, data = self.post("/api/new", {"dir": str(self.dir / "sub"), "name": "Pump system"})
        self.assertEqual(status, 200)
        new = self.dir.resolve() / "sub" / "Pump system.json"  # the name is the file name; .json added
        self.assertEqual((data["file"]["path"], data["diagram"]["nodes"]), (str(new), []))
        self.assertEqual(json.loads(new.read_text())["format"], "whiteboard-diagram")
        self.call("PUT", "/api/diagram", GOOD)  # Save now writes the new project
        self.assertEqual(len(json.loads(new.read_text())["nodes"]), 4)
        self.assertFalse(self.file.exists())

    def test_new_project_asks_before_replacing_a_file(self):
        status, data = self.post("/api/new", {"dir": str(self.dir), "name": "a"})
        self.assertEqual((status, data["exists"], data["name"]), (409, True, "a.json"))
        self.assertEqual((self.dir / "a.json").read_text(), "{}")
        self.assertEqual(json.loads(self.call("GET", "/api/file")[1])["name"], "d.json")  # still the old project
        self.assertEqual(self.post("/api/new", {"dir": str(self.dir), "name": "a", "overwrite": True})[0], 200)
        self.assertEqual(json.loads((self.dir / "a.json").read_text())["nodes"], [])

    def test_save_copy_writes_a_copy_and_stays_on_the_project(self):
        self.call("PUT", "/api/diagram", GOOD)
        status, data = self.post("/api/save-copy", {"dir": str(self.dir), "name": "snapshot", "diagram": GOOD})
        self.assertEqual((status, data["file"]["name"]), (200, "snapshot.json"))
        copy = self.dir / "snapshot.json"
        self.assertEqual(len(json.loads(copy.read_text())["nodes"]), 4)
        # Saving the project afterwards leaves the copy as it was.
        self.call("PUT", "/api/diagram", {"nodes": [], "edges": []})
        self.assertEqual(len(json.loads(copy.read_text())["nodes"]), 4)
        self.assertEqual(json.loads(self.file.read_text())["nodes"], [])
        self.assertEqual(json.loads(self.call("GET", "/api/file")[1])["name"], "d.json")

    def test_save_copy_asks_before_replacing_and_never_onto_the_project_itself(self):
        status, data = self.post("/api/save-copy", {"dir": str(self.dir), "name": "a.json", "diagram": GOOD})
        self.assertEqual((status, data["exists"]), (409, True))
        self.assertEqual(self.post("/api/save-copy", {"dir": str(self.dir), "name": "a.json", "diagram": GOOD, "overwrite": True})[0], 200)
        status, data = self.post("/api/save-copy", {"dir": str(self.dir), "name": "d", "diagram": GOOD, "overwrite": True})
        self.assertEqual(status, 400)
        self.assertIn("project itself", data["error"])

    def test_bad_names_folders_and_diagrams_are_refused(self):
        for path, body in (
            ("/api/new", {"dir": str(self.dir), "name": ""}),
            ("/api/new", {"dir": str(self.dir), "name": "../escape"}),
            ("/api/new", {"dir": str(self.dir), "name": "a/b"}),
            ("/api/new", {"dir": str(self.dir / "missing"), "name": "x"}),
            ("/api/new", {"dir": "relative", "name": "x"}),
            ("/api/new", ["not", "an", "object"]),
            ("/api/save-copy", {"dir": str(self.dir), "name": "x", "diagram": {"nodes": [{"id": "C1"}]}}),
            ("/api/save-copy", {"dir": str(self.dir), "name": "../escape", "diagram": GOOD}),
        ):
            with self.subTest(path=path, body=str(body)[:60]):
                self.assertEqual(self.call("POST", path, body)[0], 400)
        (self.dir / "folder.json").mkdir()
        self.assertEqual(self.post("/api/new", {"dir": str(self.dir), "name": "folder.json", "overwrite": True})[0], 400)
        self.assertFalse((self.dir.parent / "escape.json").exists())

    def test_close_leaves_no_project_open(self):
        self.call("PUT", "/api/diagram", GOOD)
        self.assertEqual(self.call("POST", "/api/close", {})[0], 200)
        self.assertEqual(json.loads(self.call("GET", "/api/file")[1]), {"open": False})
        self.assertEqual(self.call("GET", "/api/diagram")[0], 409)
        self.assertEqual(self.call("PUT", "/api/diagram", {"nodes": [], "edges": []})[0], 409)  # nothing to save into
        self.assertEqual(len(json.loads(self.file.read_text())["nodes"]), 4)  # closing wrote nothing
        # The dialogs carry on in the last folder used.
        self.assertEqual(json.loads(self.call("GET", "/api/browse")[1])["dir"], str(self.dir.resolve()))

    def test_open_switches_to_the_file_and_returns_its_diagram(self):
        good = self.dir / "good.json"
        good.write_text(json.dumps(GOOD))
        status, data = self.post("/api/open", {"dir": str(self.dir), "name": "good.json"})
        self.assertEqual(status, 200)
        self.assertEqual((data["file"]["name"], len(data["diagram"]["nodes"])), ("good.json", 4))
        self.call("PUT", "/api/diagram", {"nodes": [], "edges": []})  # autosave now goes to good.json
        self.assertEqual(json.loads(good.read_text())["nodes"], [])

    def test_open_upgrades_an_older_file(self):
        (self.dir / "old.json").write_text(json.dumps({
            "nodes": [{"id": "n1", "type": "controller", "x": 0, "y": 0, "w": 100, "h": 60}], "edges": []}))
        status, data = self.post("/api/open", {"dir": str(self.dir), "name": "old"})  # .json added here too
        self.assertEqual(status, 200)
        self.assertEqual(sorted(n["id"] for n in data["diagram"]["nodes"]), ["C1", "CA1", "PM1"])

    def test_a_file_that_cannot_be_opened_changes_nothing(self):
        self.call("PUT", "/api/diagram", GOOD)
        (self.dir / "bad.json").write_text('{"format": "spreadsheet"}')
        (self.dir / "broken.json").write_text("{not json")
        for name, status in (("bad.json", 400), ("broken.json", 400), ("missing.json", 404)):
            with self.subTest(name=name):
                got, data = self.post("/api/open", {"dir": str(self.dir), "name": name})
                self.assertEqual(got, status)
                self.assertIn(name, data["error"])
        self.assertEqual(json.loads(self.call("GET", "/api/file")[1])["name"], "d.json")
        self.assertEqual(len(json.loads(self.file.read_text())["nodes"]), 4)


class RobustnessTests(ServerCase):
    """Problems found in review: each of these used to lose data or drop the connection."""

    def test_a_file_that_cannot_be_read_is_never_overwritten_by_autosave(self):
        original = json.dumps({"format": "whiteboard-diagram", "format_version": 99, "nodes": [], "edges": []})
        self.file.write_text(original)
        self.assertEqual(self.call("GET", "/api/diagram")[0], 500)  # the page shows "Could not load"
        status, data = self.call("PUT", "/api/diagram", GOOD)       # ...and the user draws something
        self.assertEqual(status, 409)
        self.assertIn("Save copy", json.loads(data)["error"])
        self.assertEqual(self.file.read_text(), original)
        # Save copy still works, so the drawing can be kept.
        status, _ = self.call("POST", "/api/save-copy", {"dir": self.tmp.name, "name": "rescued", "diagram": GOOD})
        self.assertEqual(status, 200)
        self.assertEqual(self.file.read_text(), original)

    def test_unreadable_working_files_give_a_reason_not_a_dropped_connection(self):
        self.file.write_bytes(b"\xff\xfe not text")
        status, data = self.call("GET", "/api/diagram")
        self.assertEqual(status, 500)
        self.assertIn("not a text file", json.loads(data)["error"])
        self.file.unlink()
        self.file.mkdir()  # a folder where the file should be
        self.assertEqual(self.call("GET", "/api/diagram")[0], 500)

    def test_odd_bodies_and_paths_get_an_answer(self):
        odd = [
            ("PUT", "/api/diagram", {"nodes": [{"id": "C1", "type": [], "x": 0, "y": 0, "w": 50, "h": 50}], "edges": []}),
            ("PUT", "/api/diagram", {"nodes": [], "edges": [{"id": "A1", "type": "control_action", "source": [1], "target": "x"}]}),
            ("PUT", "/api/diagram", {"nodes": [{"id": "CA1", "type": "control_algorithm", "parent": {}, "x": 0, "y": 0, "w": 50, "h": 50}], "edges": []}),
            ("PUT", "/api/diagram", "[" * 100000),
            ("GET", "/api/browse?dir=~nosuchuser_xyz/x", None),
            ("GET", "/api/browse?dir=/tmp%00x", None),
            ("POST", "/api/save-copy", {"dir": "~nosuchuser_xyz", "name": "x", "diagram": GOOD}),
            ("POST", "/api/new", {"dir": "/tmp%00x", "name": "x"}),
        ]
        for method, path, body in odd:
            with self.subTest(path=path, body=str(body)[:60]):
                status, data = self.call(method, path, body)  # would raise RemoteDisconnected before
                self.assertEqual(status, 400)
                self.assertIn("error", json.loads(data))

    def test_a_save_that_cannot_be_written_says_why(self):
        if hasattr(__import__("os"), "geteuid") and __import__("os").geteuid() == 0:
            self.skipTest("root can write anywhere")
        locked = Path(self.tmp.name) / "locked"
        locked.mkdir()
        (locked / "d.json").write_text(json.dumps(GOOD))
        self.assertEqual(self.call("POST", "/api/open", {"dir": str(locked), "name": "d.json"})[0], 200)
        locked.chmod(0o500)
        try:
            status, data = self.call("PUT", "/api/diagram", GOOD)
            self.assertEqual(status, 500)
            self.assertIn("could not save", json.loads(data)["error"])
        finally:
            locked.chmod(0o700)

    def test_a_save_meant_for_another_file_is_refused(self):
        # An autosave sent just before Open switched files must not land in the newly opened file.
        other = Path(self.tmp.name) / "other.json"
        other.write_text(json.dumps(GOOD))
        self.call("POST", "/api/open", {"dir": self.tmp.name, "name": "other.json"})
        from urllib.parse import quote
        status, _ = self.call("PUT", "/api/diagram", {"nodes": [], "edges": []},
                              headers={"X-Whiteboard-File": quote(str(self.file.resolve()))})
        self.assertEqual(status, 409)
        self.assertEqual(len(json.loads(other.read_text())["nodes"]), 4)
        status, _ = self.call("PUT", "/api/diagram", {"nodes": [], "edges": []},
                              headers={"X-Whiteboard-File": quote(str(other.resolve()))})
        self.assertEqual(status, 200)

    def test_saving_through_a_symbolic_link_keeps_the_link(self):
        real = Path(self.tmp.name) / "real.json"
        real.write_text(json.dumps(GOOD))
        link = Path(self.tmp.name) / "link.json"
        link.symlink_to(real)
        self.call("POST", "/api/open", {"dir": self.tmp.name, "name": "link.json"})
        self.assertEqual(self.call("PUT", "/api/diagram", {"nodes": [], "edges": []})[0], 200)
        self.assertTrue(link.is_symlink())
        self.assertEqual(json.loads(real.read_text())["nodes"], [])
        # Save copy onto a link that points at a missing file writes that file and keeps the link.
        dangling = Path(self.tmp.name) / "dangling.json"
        dangling.symlink_to(Path(self.tmp.name) / "nowhere.json")
        status, _ = self.call("POST", "/api/save-copy", {"dir": self.tmp.name, "name": "dangling.json", "diagram": GOOD})
        self.assertEqual(status, 200)
        self.assertTrue(dangling.is_symlink())
        self.assertEqual(len(json.loads((Path(self.tmp.name) / "nowhere.json").read_text())["nodes"]), 4)


class StartScreenTests(ServerCase):
    """Started without --file: no project is open until the page creates or opens one."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.file = Path(self.tmp.name) / "unused.json"
        self.server = make_server(None, port=0)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.port = self.server.server_address[1]

    def test_nothing_is_open_and_nothing_can_be_saved(self):
        self.assertEqual(json.loads(self.call("GET", "/api/file")[1]), {"open": False})
        self.assertEqual(self.call("GET", "/api/diagram")[0], 409)
        self.assertEqual(self.call("PUT", "/api/diagram", GOOD)[0], 409)
        self.assertEqual(self.call("GET", "/")[0], 200)

    def test_the_dialogs_start_in_documents_or_home(self):
        start = json.loads(self.call("GET", "/api/browse")[1])["dir"]
        self.assertIn(start, (str((Path.home() / "Documents").resolve()), str(Path.home().resolve())))

    def test_new_then_save(self):
        status, data = self.call("POST", "/api/new", {"dir": self.tmp.name, "name": "first"})
        self.assertEqual(status, 200)
        self.assertEqual(self.call("PUT", "/api/diagram", GOOD)[0], 200)
        self.assertEqual(len(json.loads((Path(self.tmp.name) / "first.json").read_text())["nodes"]), 4)
