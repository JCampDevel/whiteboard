"""Diagram model, validation and the entity tables.

Six entity types, each with its own kind of unique ID:

    Controller (C1), Control Algorithm (CA1), Process Model (PM1),
    Controlled Process (CP1)               -> boxes
    Control Action (A1), Feedback (F1)     -> arrows

A Control Algorithm and a Process Model always live inside one Controller
(their ``parent``). An arrow joins two different boxes, so it can never be left
dangling; either end may be on any of the four box types.
"""

from __future__ import annotations

import copy
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

ID_PREFIX = {
    "controller": "C",
    "control_algorithm": "CA",
    "process_model": "PM",
    "controlled_process": "CP",
    "control_action": "A",
    "feedback": "F",
}
TYPE_TITLES = {
    "controller": "Controller",
    "control_algorithm": "Control Algorithm",
    "process_model": "Process Model",
    "controlled_process": "Controlled Process",
    "control_action": "Control Action",
    "feedback": "Feedback",
}
NODE_TYPES = ("controller", "control_algorithm", "process_model", "controlled_process")
CHILD_TYPES = ("control_algorithm", "process_model")  # live inside a controller
EDGE_TYPES = ("control_action", "feedback")
LINE_STYLES = ("full", "dashed")

MIN_NODE_SIZE = 40
AUTO_COLOUR = "auto"  # drawn in the theme's text colour, so it shows on light and dark
_COLOUR = re.compile(r"^#[0-9a-fA-F]{6}$")

_OUT_ACTIONS = ("outgoing", "Outgoing control actions")
_IN_FEEDBACK = ("incoming", "Incoming feedback")
_OTHER = ("other", "Other arrows")
_ARROW_FIELDS = (("id", "ID"), ("name", "Name"), ("line", "Line"), ("source", "From"), ("target", "To"))
# Each entity type's properties, in table-column order. These are the columns of its table and
# also the properties that can be switched on to show on the diagram.
FIELDS = {
    "controller": (
        ("id", "ID"), ("name", "Name"), ("control_algorithm", "Control Algorithm"),
        ("process_model", "Process Model"), _OUT_ACTIONS, _IN_FEEDBACK, _OTHER),
    "control_algorithm": (
        ("id", "ID"), ("name", "Name"), ("controller", "Controller"), _OUT_ACTIONS, _IN_FEEDBACK, _OTHER),
    "process_model": (
        ("id", "ID"), ("name", "Name"), ("controller", "Controller"), _OUT_ACTIONS, _IN_FEEDBACK, _OTHER),
    "controlled_process": (
        ("id", "ID"), ("name", "Name"), ("incoming", "Incoming control actions"),
        ("outgoing", "Outgoing feedback"), _OTHER),
    "control_action": _ARROW_FIELDS,
    "feedback": _ARROW_FIELDS,
}
DEFAULT_SHOWN = ("id", "name")


class DiagramError(ValueError):
    """The diagram data is not valid."""


def _number(value, what: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise DiagramError(f"{what} must be a number")
    if value != value or value in (float("inf"), float("-inf")):
        raise DiagramError(f"{what} must be finite")
    return float(value)


def _colour(value, what: str) -> str:
    if value == AUTO_COLOUR:
        return value
    if not isinstance(value, str) or not _COLOUR.match(value):
        raise DiagramError(f"{what} must be a colour like #1a2b3c, or {AUTO_COLOUR}")
    return value.lower()


def _shown(value, type_: str) -> list[str]:
    """Which of an entity's properties are drawn on the diagram (default: ID and name)."""
    keys = [k for k, _ in FIELDS[type_]]
    if value is None:
        return list(DEFAULT_SHOWN)
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise DiagramError("shown must be a list of property names")
    unknown = [v for v in value if v not in keys]
    if unknown:
        raise DiagramError(f"{TYPE_TITLES[type_]} has no property {unknown[0]!r}")
    return [k for k in keys if k in value]  # tidy: table order, no repeats


def _text(value, what: str) -> str:
    if not isinstance(value, str):
        raise DiagramError(f"{what} must be text")
    return value[:200]


def _anchor(value, what: str) -> list[float] | None:
    """Where an arrow meets a rectangle, as (x, y) fractions of its width and height."""
    if value is None:
        return None
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise DiagramError(f"{what} must be [x, y]")
    x, y = (_number(v, what) for v in value)
    if not (0 <= x <= 1 and 0 <= y <= 1):
        raise DiagramError(f"{what} must be inside the rectangle (0 to 1)")
    return [x, y]


def _unique_id(value, type_: str, what: str) -> str:
    """An id is the type's prefix and a number, e.g. C3 or CA1, so it names its type."""
    prefix = ID_PREFIX[type_]
    if not isinstance(value, str) or not re.fullmatch(re.escape(prefix) + r"\d{1,9}", value):
        raise DiagramError(f"{what} must look like {prefix}1, {prefix}2, ...")
    return value


@dataclass
class Node:
    id: str
    type: str
    x: float
    y: float
    w: float
    h: float
    label: str = ""
    colour: str = "#3b82f6"
    parent: str | None = None  # the Controller a Control Algorithm / Process Model sits in
    shown: list[str] = field(default_factory=lambda: list(DEFAULT_SHOWN))

    @classmethod
    def from_dict(cls, d: dict) -> "Node":
        if not isinstance(d, dict):
            raise DiagramError("a node must be an object")
        if d.get("type") not in NODE_TYPES:
            raise DiagramError(f"node type must be one of {', '.join(NODE_TYPES)}")
        w = _number(d.get("w"), "node width")
        h = _number(d.get("h"), "node height")
        if w < MIN_NODE_SIZE or h < MIN_NODE_SIZE:
            raise DiagramError(f"a node must be at least {MIN_NODE_SIZE} wide and high")
        parent = d.get("parent")
        if parent is not None and not isinstance(parent, str):
            raise DiagramError("node parent must be an id")
        return cls(
            id=_unique_id(d.get("id"), d["type"], "node id"),
            type=d["type"],
            x=_number(d.get("x"), "node x"),
            y=_number(d.get("y"), "node y"),
            w=w,
            h=h,
            label=_text(d.get("label", ""), "node label"),
            colour=_colour(d.get("colour", "#3b82f6"), "node colour"),
            parent=parent,
            shown=_shown(d.get("shown"), d["type"]),
        )


@dataclass
class Edge:
    id: str
    type: str
    source: str
    target: str
    style: str = "full"
    label: str = ""
    colour: str = AUTO_COLOUR
    # Fractions of the rectangle's width/height; None lets the page pick a default.
    source_anchor: list[float] | None = None
    target_anchor: list[float] | None = None
    shown: list[str] = field(default_factory=lambda: list(DEFAULT_SHOWN))

    @classmethod
    def from_dict(cls, d: dict) -> "Edge":
        if not isinstance(d, dict):
            raise DiagramError("an edge must be an object")
        if d.get("type") not in EDGE_TYPES:
            raise DiagramError(f"edge type must be one of {', '.join(EDGE_TYPES)}")
        if d.get("style", "full") not in LINE_STYLES:
            raise DiagramError(f"edge style must be one of {', '.join(LINE_STYLES)}")
        for end in ("source", "target"):
            if not isinstance(d.get(end), str) or not d[end]:
                raise DiagramError(f"edge {end} must be an id")
        return cls(
            id=_unique_id(d.get("id"), d["type"], "edge id"),
            type=d["type"],
            source=d["source"],
            target=d["target"],
            style=d.get("style", "full"),
            label=_text(d.get("label", ""), "edge label"),
            colour=_colour(d.get("colour", AUTO_COLOUR), "edge colour"),
            source_anchor=_anchor(d.get("source_anchor"), "arrow start point"),
            target_anchor=_anchor(d.get("target_anchor"), "arrow end point"),
            shown=_shown(d.get("shown"), d["type"]),
        )


@dataclass
class Diagram:
    nodes: list[Node] = field(default_factory=list)
    edges: list[Edge] = field(default_factory=list)

    @classmethod
    def from_dict(cls, d: dict) -> "Diagram":
        if not isinstance(d, dict):
            raise DiagramError("a diagram must be an object")
        raw_nodes, raw_edges = d.get("nodes", []), d.get("edges", [])
        if not isinstance(raw_nodes, list) or not isinstance(raw_edges, list):
            raise DiagramError("nodes and edges must be lists")
        nodes = [Node.from_dict(n) for n in raw_nodes]
        edges = [Edge.from_dict(e) for e in raw_edges]

        ids = [n.id for n in nodes] + [e.id for e in edges]
        if len(ids) != len(set(ids)):
            raise DiagramError("ids must be unique")
        by_id = {n.id: n for n in nodes}

        taken = set()
        for n in nodes:
            if n.type in CHILD_TYPES:
                parent = by_id.get(n.parent)
                if parent is None or parent.type != "controller":
                    raise DiagramError(f"{n.id} must be inside an existing Controller")
                if (n.parent, n.type) in taken:
                    raise DiagramError(f"{n.parent} can only have one {TYPE_TITLES[n.type]}")
                taken.add((n.parent, n.type))
            elif n.parent is not None:
                raise DiagramError(f"{n.id} cannot be inside another box")

        for e in edges:
            if e.source not in by_id or e.target not in by_id:
                raise DiagramError("an arrow must connect two existing rectangles")
            if e.source == e.target:
                raise DiagramError("an arrow must connect two different rectangles")
        return cls(nodes, edges)

    def to_dict(self) -> dict:
        return {
            "nodes": [vars(n).copy() for n in self.nodes],
            "edges": [vars(e).copy() for e in self.edges],
        }

    def bounds(self) -> tuple[float, float, float, float] | None:
        """(min_x, min_y, max_x, max_y) of all rectangles, or None if empty."""
        if not self.nodes:
            return None
        return (
            min(n.x for n in self.nodes),
            min(n.y for n in self.nodes),
            max(n.x + n.w for n in self.nodes),
            max(n.y + n.h for n in self.nodes),
        )


# ---------- older files ----------


def migrate(raw):
    """Bring an older diagram up to date: give every item an id with its type's
    current prefix (n1 -> C1, e1 -> A1, ALG1 -> CA1, FB1 -> F1, ...) and give each
    Controller its two inner boxes.

    Returns a new dict; anything it cannot make sense of is left for
    Diagram.from_dict to reject.
    """
    if not isinstance(raw, dict):
        return raw
    raw = copy.deepcopy(raw)
    nodes, edges = raw.get("nodes"), raw.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return raw
    items = [i for i in nodes + edges if isinstance(i, dict)]

    def conforming(item):
        prefix = ID_PREFIX.get(item.get("type"))
        return prefix is not None and isinstance(item.get("id"), str) and re.fullmatch(re.escape(prefix) + r"\d+", item["id"])

    used = {i["id"] for i in items if conforming(i)}
    counters: dict[str, int] = {}

    def fresh(type_):
        prefix = ID_PREFIX[type_]
        while True:
            counters[prefix] = counters.get(prefix, 0) + 1
            if f"{prefix}{counters[prefix]}" not in used:
                used.add(f"{prefix}{counters[prefix]}")
                return f"{prefix}{counters[prefix]}"

    # Only boxes are ever referred to (by arrows and inner boxes), so only their renames are looked up.
    # Keeping arrows out matters: an old arrow id like "CA1" can equal a new box id.
    renamed = {}
    for item in items:
        if item.get("type") in ID_PREFIX and not conforming(item) and isinstance(item.get("id"), str):
            new = fresh(item["type"])
            if item["type"] in NODE_TYPES:
                renamed[item["id"]] = new
            item["id"] = new
    for item in items:
        for key in ("source", "target", "parent"):
            if item.get(key) in renamed:
                item[key] = renamed[item[key]]

    # Arrows used to default to near-black, which vanishes on the dark theme; that default is now "auto".
    for e in edges:
        if isinstance(e, dict) and e.get("colour") == "#111827":
            e["colour"] = AUTO_COLOUR

    have = {(n.get("parent"), n.get("type")) for n in nodes if isinstance(n, dict)}
    for c in [n for n in nodes if isinstance(n, dict) and n.get("type") == "controller" and isinstance(n.get("id"), str)]:
        for child_type in CHILD_TYPES:
            if (c["id"], child_type) not in have:
                nodes.append({
                    "id": fresh(child_type), "type": child_type, "parent": c["id"],
                    "x": c.get("x", 0), "y": c.get("y", 0), "w": 100, "h": MIN_NODE_SIZE,  # the page lays these out
                    "label": TYPE_TITLES[child_type], "colour": c.get("colour", "#3b82f6"),
                })
    return raw


# ---------- tables ----------


def _id_order(item_id: str):
    m = re.fullmatch(r"([A-Z]+)(\d+)", item_id)
    return (m.group(1), int(m.group(2))) if m else (item_id, 0)


def tables(diagram: Diagram) -> list[dict]:
    """One table per entity type, each row linking an entity to its neighbours.

    Cells are text or a list of ids. A Controller's links include arrows on its
    own Control Algorithm and Process Model (they are part of it); an arrow
    between a Controller's own inner boxes is listed as "internal" under
    "Other arrows". "Other arrows" also catches any arrow drawn the unusual way
    round (e.g. a Feedback leaving a Controller) so nothing is hidden.
    """
    nodes = {n.id: n for n in diagram.nodes}
    edges = sorted(diagram.edges, key=lambda e: _id_order(e.id))
    inner = {}  # controller id -> {child type: child id}
    for n in diagram.nodes:
        if n.type in CHILD_TYPES:
            inner.setdefault(n.parent, {})[n.type] = n.id

    def links(group: set[str], out_type: str | None, in_type: str | None):
        """(outgoing arrows of out_type, incoming arrows of in_type, everything else attached)."""
        out, into, other = [], [], []
        for e in edges:
            s, t = e.source in group, e.target in group
            if not (s or t):
                continue
            if s and t:
                other.append(f"{e.id} (internal)")
            elif s and e.type == out_type:
                out.append(e.id)
            elif t and e.type == in_type:
                into.append(e.id)
            else:
                other.append(f"{e.id} ({'outgoing' if s else 'incoming'})")
        return out, into, other

    def sorted_nodes(type_):
        return sorted((n for n in diagram.nodes if n.type == type_), key=lambda n: _id_order(n.id))

    def columns(type_):
        return [{"key": k, "title": t} for k, t in FIELDS[type_]]

    result = []

    rows = []
    for n in sorted_nodes("controller"):
        kids = inner.get(n.id, {})
        out, into, other = links({n.id, *kids.values()}, "control_action", "feedback")
        rows.append({
            "id": n.id, "name": n.label,
            "control_algorithm": kids.get("control_algorithm", ""),
            "process_model": kids.get("process_model", ""),
            "outgoing": out, "incoming": into, "other": other,
        })
    result.append({"key": "controller", "title": "Controller", "columns": columns("controller"), "rows": rows})

    for type_ in CHILD_TYPES:
        rows = []
        for n in sorted_nodes(type_):
            out, into, other = links({n.id}, "control_action", "feedback")
            rows.append({
                "id": n.id, "name": n.label, "controller": n.parent or "",
                "outgoing": out, "incoming": into, "other": other,
            })
        result.append({"key": type_, "title": TYPE_TITLES[type_], "columns": columns(type_), "rows": rows})

    rows = []
    for n in sorted_nodes("controlled_process"):
        # A process is controlled *by* actions arriving and reports back by feedback leaving.
        out, into, other = links({n.id}, "feedback", "control_action")
        rows.append({"id": n.id, "name": n.label, "incoming": into, "outgoing": out, "other": other})
    result.append({"key": "controlled_process", "title": "Controlled Process", "columns": columns("controlled_process"), "rows": rows})

    for type_ in EDGE_TYPES:
        rows = [
            {"id": e.id, "name": e.label, "line": e.style, "source": e.source, "target": e.target}
            for e in edges if e.type == type_
        ]
        result.append({"key": type_, "title": TYPE_TITLES[type_], "columns": columns(type_), "rows": rows})
    return result


# ---------- files ----------


def load(path: Path) -> Diagram:
    """Read a diagram file; a missing file is an empty diagram."""
    try:
        text = Path(path).read_text(encoding="utf-8")
    except FileNotFoundError:
        return Diagram()
    try:
        return Diagram.from_dict(migrate(json.loads(text)))
    except json.JSONDecodeError as exc:
        raise DiagramError(f"{path} is not valid JSON: {exc}") from exc


def save(diagram: Diagram, path: Path) -> None:
    """Write atomically so a crash never leaves a half-written file."""
    path = Path(path)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(diagram.to_dict(), indent=2), encoding="utf-8")
    tmp.replace(path)
