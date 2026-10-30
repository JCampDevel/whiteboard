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


class ServerTests(unittest.TestCase):
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
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        if isinstance(body, (dict, list)):
            body = json.dumps(body)
        c.request(method, path, body=body, headers=headers or {})
        r = c.getresponse()
        data = r.read()
        c.close()
        return r.status, data

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
        self.assertEqual((status, json.loads(data)), (200, {"format": "whiteboard-diagram", "format_version": 1, "nodes": [], "edges": []}))

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

    def test_tables_come_from_the_saved_diagram(self):
        self.call("PUT", "/api/diagram", GOOD)
        status, data = self.call("GET", "/api/tables")
        self.assertEqual(status, 200)
        tables = json.loads(data)["tables"]
        self.assertEqual([t["key"] for t in tables], [
            "controller", "control_algorithm", "process_model", "controlled_process", "control_action", "feedback"])
        controller = tables[0]["rows"][0]
        self.assertEqual((controller["id"], controller["control_algorithm"], controller["outgoing"], controller["incoming"]),
                         ("C1", "CA1", ["A1"], ["F1"]))

    def test_tables_for_an_empty_diagram(self):
        status, data = self.call("GET", "/api/tables")
        self.assertEqual(status, 200)
        self.assertEqual(len(json.loads(data)["tables"]), 6)

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
        c.putheader("Content-Length", str(50 * 1024 * 1024))
        c.endheaders()
        self.assertEqual(c.getresponse().status, 413)
        c.close()

    def test_corrupt_file_gives_500_not_a_crash(self):
        self.file.write_text("{broken")
        self.assertEqual(self.call("GET", "/api/diagram")[0], 500)
        self.assertEqual(self.call("GET", "/api/tables")[0], 500)
        self.assertEqual(self.call("GET", "/")[0], 200)


if __name__ == "__main__":
    unittest.main()
