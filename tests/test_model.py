import json
import tempfile
import unittest
from pathlib import Path

from whiteboard import model
from whiteboard.model import Diagram, DiagramError


def node(id, type="controller", **kw):
    d = {"id": id, "type": type, "x": 0, "y": 0, "w": 100, "h": 60, **kw}
    if type in model.CHILD_TYPES:
        d.setdefault("parent", "C1")
    return d


def edge(id, s, t, type="control_action", **kw):
    return {"id": id, "type": type, "source": s, "target": t, **kw}


def full_controller(n=1):
    """A Controller with its two inner boxes."""
    return [
        node(f"C{n}"),
        node(f"CA{n}", "control_algorithm", parent=f"C{n}"),
        node(f"PM{n}", "process_model", parent=f"C{n}"),
    ]


class DiagramValidation(unittest.TestCase):
    def test_valid_diagram_round_trips(self):
        data = {
            "nodes": [node("C1"), node("CP1", "controlled_process", colour="#ff0000")],
            "edges": [
                edge("A1", "C1", "CP1", style="dashed"),
                edge("F1", "CP1", "C1", "feedback", colour="#00ff00"),
            ],
        }
        d = Diagram.from_dict(data)
        self.assertEqual([n.type for n in d.nodes], ["controller", "controlled_process"])
        self.assertEqual(d.edges[0].style, "dashed")
        self.assertEqual(Diagram.from_dict(d.to_dict()), d)

    def test_empty_diagram_is_valid(self):
        d = Diagram.from_dict({})
        self.assertEqual((d.nodes, d.edges), ([], []))
        self.assertIsNone(d.bounds())

    def test_arrows_cannot_be_rectangles_and_rectangles_cannot_be_arrows(self):
        with self.assertRaises(DiagramError):
            Diagram.from_dict({"nodes": [node("C1", "feedback")]})
        with self.assertRaises(DiagramError):
            Diagram.from_dict({"nodes": [node("C1"), node("CP1", "controlled_process")],
                               "edges": [edge("A1", "C1", "CP1", "controller")]})

    def test_ids_must_match_their_type(self):
        for bad in (node("n1"), node("CP1", "controller"), node("C"), node("C1x"), node("c1"), node("CA1")):
            with self.subTest(bad=bad["id"]), self.assertRaises(DiagramError):
                Diagram.from_dict({"nodes": [bad]})
        nodes = [node("C1"), node("CP1", "controlled_process")]
        for bad_edge in (edge("e1", "C1", "CP1"), edge("F1", "C1", "CP1"), edge("A1", "C1", "CP1", "feedback")):
            with self.subTest(bad=bad_edge["id"]), self.assertRaises(DiagramError):
                Diagram.from_dict({"nodes": nodes, "edges": [bad_edge]})

    def test_arrow_must_join_two_existing_rectangles(self):
        with self.assertRaises(DiagramError):
            Diagram.from_dict({"nodes": [node("C1")], "edges": [edge("A1", "C1", "CP9")]})
        with self.assertRaises(DiagramError):
            Diagram.from_dict({"nodes": [node("C1")], "edges": [edge("A1", "CP9", "C1")]})

    def test_arrow_cannot_start_and_end_on_same_rectangle(self):
        with self.assertRaises(DiagramError):
            Diagram.from_dict({"nodes": [node("C1")], "edges": [edge("A1", "C1", "C1")]})

    def test_arrow_cannot_connect_to_an_arrow(self):
        data = {"nodes": [node("C1"), node("CP1", "controlled_process")],
                "edges": [edge("A1", "C1", "CP1"), edge("A2", "C1", "A1")]}
        with self.assertRaises(DiagramError):
            Diagram.from_dict(data)

    def test_arrows_can_connect_to_the_inner_boxes(self):
        data = {"nodes": full_controller() + [node("CP1", "controlled_process")],
                "edges": [edge("A1", "CA1", "CP1"), edge("F1", "CP1", "PM1", "feedback")]}
        d = Diagram.from_dict(data)
        self.assertEqual((d.edges[0].source, d.edges[1].target), ("CA1", "PM1"))

    def test_inner_boxes_need_exactly_a_controller_parent(self):
        cp = node("CP1", "controlled_process")
        bad = [
            [node("CA1", "control_algorithm", parent=None)],                  # no parent
            [node("CA1", "control_algorithm", parent="C9")],                  # parent missing
            [cp, node("CA1", "control_algorithm", parent="CP1")],             # parent not a controller
            [node("C1"), node("C2", parent="C1")],                             # a controller inside a controller
            [cp, node("CP2", "controlled_process", parent="CP1")],
            full_controller() + [node("CA2", "control_algorithm", parent="C1")],  # second algorithm
            full_controller() + [node("PM2", "process_model", parent="C1")],
        ]
        for nodes in bad:
            with self.subTest(nodes=[n["id"] for n in nodes]), self.assertRaises(DiagramError):
                Diagram.from_dict({"nodes": nodes})
        Diagram.from_dict({"nodes": full_controller(1) + full_controller(2)})

    def test_duplicate_ids_rejected(self):
        with self.assertRaises(DiagramError):
            Diagram.from_dict({"nodes": [node("C1"), node("C1")]})

    def test_bad_values_rejected(self):
        bad_nodes = [
            node("C1", colour="red"),
            node("C1", colour="#12345"),
            node("C1", w=10),
            node("C1", h=-5),
            node("C1", x="3"),
            node("C1", x=True),
            node("C1", x=float("nan")),
            node("C1", label=5),
            node(""),
            node("C1", parent=5),
        ]
        for n in bad_nodes:
            with self.subTest(n=n), self.assertRaises(DiagramError):
                Diagram.from_dict({"nodes": [n]})
        with self.assertRaises(DiagramError):
            Diagram.from_dict({"nodes": [node("C1"), node("CP1", "controlled_process")],
                               "edges": [edge("A1", "C1", "CP1", style="wavy")]})

    def test_non_object_input_rejected(self):
        for bad in ([], "x", None, {"nodes": 3}, {"nodes": ["a"]}, {"edges": {}}):
            with self.subTest(bad=bad), self.assertRaises(DiagramError):
                Diagram.from_dict(bad)

    def test_arrow_anchors_round_trip_and_are_optional(self):
        nodes = [node("C1"), node("CP1", "controlled_process")]
        d = Diagram.from_dict({"nodes": nodes, "edges": [
            edge("A1", "C1", "CP1", source_anchor=[1, 0.25], target_anchor=(0, 0.75)),
            edge("A2", "C1", "CP1"),
        ]})
        self.assertEqual(d.edges[0].source_anchor, [1.0, 0.25])
        self.assertEqual(d.edges[0].target_anchor, [0.0, 0.75])
        self.assertIsNone(d.edges[1].source_anchor)
        self.assertEqual(Diagram.from_dict(d.to_dict()), d)

    def test_bad_anchors_rejected(self):
        for bad in ([0.5], [0.5, 0.5, 0.5], [1.1, 0], [0, -0.1], ["a", 0], [True, 0], "x", 5, [float("nan"), 0]):
            with self.subTest(bad=bad), self.assertRaises(DiagramError):
                Diagram.from_dict({"nodes": [node("C1"), node("CP1", "controlled_process")],
                                   "edges": [edge("A1", "C1", "CP1", target_anchor=bad)]})

    def test_negative_positions_are_allowed(self):
        d = Diagram.from_dict({"nodes": [node("C1", x=-500, y=-20)]})
        self.assertEqual(d.bounds(), (-500, -20, -400, 40))

    def test_long_labels_are_truncated(self):
        d = Diagram.from_dict({"nodes": [node("C1", label="x" * 500)]})
        self.assertEqual(len(d.nodes[0].label), 200)

    def test_bounds_cover_every_rectangle(self):
        d = Diagram.from_dict({"nodes": [node("C1", x=10, y=20), node("CP1", "controlled_process", x=500, y=900)]})
        self.assertEqual(d.bounds(), (10, 20, 600, 960))


class Migration(unittest.TestCase):
    OLD = {
        "nodes": [node("n1", colour="#ff0000"), node("n2", "controlled_process")],
        "edges": [edge("e1", "n1", "n2"), edge("e2", "n2", "n1", "feedback")],
    }

    def test_old_ids_become_typed_ids_and_references_follow(self):
        d = Diagram.from_dict(model.migrate(self.OLD))
        ids = {n.id: n for n in d.nodes}
        self.assertEqual(ids["C1"].colour, "#ff0000")
        self.assertIn("CP1", ids)
        self.assertEqual([(e.id, e.source, e.target) for e in d.edges],
                         [("A1", "C1", "CP1"), ("F1", "CP1", "C1")])

    def test_every_controller_gets_its_two_inner_boxes(self):
        d = Diagram.from_dict(model.migrate(self.OLD))
        kids = {n.type: n for n in d.nodes if n.parent}
        self.assertEqual(set(kids), {"control_algorithm", "process_model"})
        self.assertTrue(all(k.parent == "C1" for k in kids.values()))
        self.assertEqual(kids["control_algorithm"].label, "Control Algorithm")
        self.assertEqual(kids["process_model"].label, "Process Model")

    def test_does_not_touch_ids_that_are_already_right_or_change_the_input(self):
        raw = {"nodes": [node("C7"), node("n1", "controlled_process")], "edges": []}
        before = json.dumps(raw)
        new = model.migrate(raw)
        self.assertEqual(json.dumps(raw), before)
        self.assertEqual({n["id"] for n in new["nodes"] if n["type"] == "controller"}, {"C7"})
        self.assertEqual([n["id"] for n in new["nodes"] if n["type"] == "controlled_process"], ["CP1"])

    def test_new_ids_never_collide_with_existing_ones(self):
        raw = {"nodes": [node("C1"), node("x", "controller"), node("CA1", "control_algorithm", parent="C1")], "edges": []}
        d = Diagram.from_dict(model.migrate(raw))
        ids = [n.id for n in d.nodes]
        self.assertEqual(len(ids), len(set(ids)))

    def test_files_saved_with_the_previous_prefixes_are_renamed_without_mixing_them_up(self):
        # Before: Control Algorithm was ALG, Control Action was CA, Feedback was FB. Now CA means Control Algorithm.
        old = {
            "nodes": [node("C1"), node("ALG1", "control_algorithm", parent="C1"),
                      node("PM1", "process_model", parent="C1"), node("CP1", "controlled_process")],
            "edges": [edge("CA1", "ALG1", "CP1"), edge("CA2", "ALG1", "PM1"), edge("FB1", "CP1", "PM1", "feedback")],
        }
        d = Diagram.from_dict(model.migrate(old))
        self.assertEqual(sorted(n.id for n in d.nodes), ["C1", "CA1", "CP1", "PM1"])
        self.assertEqual([(e.id, e.type, e.source, e.target) for e in d.edges], [
            ("A1", "control_action", "CA1", "CP1"),
            ("A2", "control_action", "CA1", "PM1"),
            ("F1", "feedback", "CP1", "PM1"),
        ])
        self.assertEqual({n.parent for n in d.nodes if n.type in model.CHILD_TYPES}, {"C1"})

    def test_migrating_twice_changes_nothing(self):
        once = model.migrate(self.OLD)
        self.assertEqual(model.migrate(once), once)

    def test_garbage_is_left_for_validation_to_reject(self):
        for bad in (None, [], {"nodes": 3, "edges": []}, {"nodes": ["x"], "edges": []}):
            with self.subTest(bad=bad):
                out = model.migrate(bad)
                with self.assertRaises(DiagramError):
                    Diagram.from_dict(out)


def table(tables, key):
    return next(t for t in tables if t["key"] == key)


def row(tables, key, id):
    return next(r for r in table(tables, key)["rows"] if r["id"] == id)


class Tables(unittest.TestCase):
    def setUp(self):
        self.d = Diagram.from_dict({
            "nodes": full_controller(1) + [node("CP1", "controlled_process", label="Plant"), node("CP2", "controlled_process")],
            "edges": [
                edge("A1", "CA1", "CP1", label="Open valve", style="dashed"),
                edge("F1", "CP1", "PM1", "feedback"),
                edge("A2", "C1", "CP2"),          # from the controller box itself
                edge("F2", "CP2", "C1", "feedback"),
                edge("A3", "CA1", "PM1"),        # inside the controller
                edge("F3", "C1", "CP1", "feedback"),  # unusual direction
            ],
        })
        self.t = model.tables(self.d)

    def test_there_is_one_table_per_entity_type_in_order(self):
        self.assertEqual([t["key"] for t in self.t], [
            "controller", "control_algorithm", "process_model", "controlled_process", "control_action", "feedback"])
        self.assertEqual([t["title"] for t in self.t][:4],
                         ["Controller", "Control Algorithm", "Process Model", "Controlled Process"])

    def test_every_table_starts_with_the_unique_id_column(self):
        for t in self.t:
            with self.subTest(t=t["key"]):
                self.assertEqual(t["columns"][0], {"key": "id", "title": "ID"})
                for r in t["rows"]:
                    self.assertEqual(set(r), {c["key"] for c in t["columns"]})

    def test_controller_row_links_its_inner_boxes_and_rolls_up_their_arrows(self):
        r = row(self.t, "controller", "C1")
        self.assertEqual((r["control_algorithm"], r["process_model"]), ("CA1", "PM1"))
        self.assertEqual(r["outgoing"], ["A1", "A2"])   # A1 leaves CA1, A2 leaves C1
        self.assertEqual(r["incoming"], ["F1", "F2"])   # F1 enters PM1, F2 enters C1
        self.assertEqual(r["other"], ["A3 (internal)", "F3 (outgoing)"])

    def test_inner_box_rows_show_only_their_own_arrows_and_their_controller(self):
        alg, pm = row(self.t, "control_algorithm", "CA1"), row(self.t, "process_model", "PM1")
        self.assertEqual((alg["controller"], pm["controller"]), ("C1", "C1"))
        self.assertEqual((alg["outgoing"], alg["incoming"], alg["other"]), (["A1", "A3"], [], []))
        self.assertEqual((pm["outgoing"], pm["incoming"], pm["other"]), ([], ["F1"], ["A3 (incoming)"]))

    def test_controlled_process_rows(self):
        cp1, cp2 = row(self.t, "controlled_process", "CP1"), row(self.t, "controlled_process", "CP2")
        self.assertEqual(cp1["name"], "Plant")
        self.assertEqual((cp1["incoming"], cp1["outgoing"], cp1["other"]), (["A1"], ["F1"], ["F3 (incoming)"]))
        self.assertEqual((cp2["incoming"], cp2["outgoing"], cp2["other"]), (["A2"], ["F2"], []))

    def test_arrow_rows_show_line_and_both_ends(self):
        r = row(self.t, "control_action", "A1")
        self.assertEqual((r["name"], r["line"], r["source"], r["target"]), ("Open valve", "dashed", "CA1", "CP1"))
        self.assertEqual([r["id"] for r in table(self.t, "feedback")["rows"]], ["F1", "F2", "F3"])

    def test_rows_sort_by_number_not_text(self):
        d = Diagram.from_dict({"nodes": [node("CP10", "controlled_process"), node("CP2", "controlled_process")]})
        self.assertEqual([r["id"] for r in table(model.tables(d), "controlled_process")["rows"]], ["CP2", "CP10"])

    def test_empty_diagram_gives_six_empty_tables(self):
        t = model.tables(Diagram())
        self.assertEqual(len(t), 6)
        self.assertTrue(all(x["rows"] == [] for x in t))

    def test_controller_without_inner_boxes_has_blank_links(self):
        d = Diagram.from_dict({"nodes": [node("C1")]})
        r = row(model.tables(d), "controller", "C1")
        self.assertEqual((r["control_algorithm"], r["process_model"]), ("", ""))


class Persistence(unittest.TestCase):
    def test_missing_file_is_empty_diagram(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(model.load(Path(tmp) / "none.json"), Diagram())

    def test_save_then_load(self):
        d = Diagram.from_dict({"nodes": full_controller() + [node("CP1", "controlled_process")],
                               "edges": [edge("A1", "CA1", "CP1")]})
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "d.json"
            model.save(d, path)
            self.assertEqual(model.load(path), d)
            self.assertEqual([p.name for p in Path(tmp).iterdir()], ["d.json"])  # no temp file left

    def test_loading_an_old_file_upgrades_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "old.json"
            path.write_text(json.dumps(Migration.OLD))
            d = model.load(path)
            self.assertEqual(sorted(n.id for n in d.nodes), ["C1", "CA1", "CP1", "PM1"])

    def test_corrupt_file_reports_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "d.json"
            path.write_text("{not json")
            with self.assertRaises(DiagramError):
                model.load(path)
            path.write_text(json.dumps({"nodes": [node("C1", "nope")]}))
            with self.assertRaises(DiagramError):
                model.load(path)


if __name__ == "__main__":
    unittest.main()
