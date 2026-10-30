"use strict";

const NS = "http://www.w3.org/2000/svg";
const MIN_SIZE = 40;
const HOME_PAD = 60;         // gap left above/left of the diagram by the Home button
const NODE_TOOLS = ["controller", "controlled_process"];
const EDGE_TOOLS = ["control_action", "feedback"];
const TYPE_NAMES = {
  controller: "Controller", control_algorithm: "Control Algorithm", process_model: "Process Model",
  controlled_process: "Controlled Process", control_action: "Control Action", feedback: "Feedback",
  relationship: "Relationship",
};
// Every item's unique id is its type's prefix and a number: C1, CA1, PM1, CP1, A1, F1.
const ID_PREFIX = {
  controller: "C", control_algorithm: "CA", process_model: "PM",
  controlled_process: "CP", control_action: "A", feedback: "F", relationship: "R",
};
const CHILD_TYPES = ["control_algorithm", "process_model"];   // drawn inside a Controller, right half
const CTRL_MIN = { w: 360, h: 140 };                          // a Controller never gets smaller than this
// The colour chart. "auto" is the theme's own text colour, so it stays visible on light and dark.
const PALETTE = [
  ["Default (follows the theme)", "auto"], ["Red", "#ef4444"], ["Orange", "#f97316"], ["Amber", "#f59e0b"],
  ["Yellow", "#eab308"], ["Lime", "#84cc16"], ["Green", "#22c55e"], ["Teal", "#14b8a6"],
  ["Cyan", "#06b6d4"], ["Blue", "#3b82f6"], ["Indigo", "#6366f1"], ["Violet", "#8b5cf6"],
  ["Purple", "#a855f7"], ["Pink", "#ec4899"], ["Rose", "#f43f5e"], ["Grey", "#6b7280"],
];
// Colour for the next item drawn of each type: the last one you gave that type.
const pen = { controller: "#3b82f6", controlled_process: "#22c55e", control_action: "auto", feedback: "auto" };
const paint = (c) => (c === "auto" ? "var(--fg)" : c);
const DEFAULT_SHOWN = ["id", "name"];                         // what every new item shows on the diagram
const shownOf = (item) => item.shown || DEFAULT_SHOWN;
const DEFAULT_SIZE = { controller: { w: 360, h: 140 }, controlled_process: { w: 360, h: 100 } };

const $ = (id) => document.getElementById(id);
// Every request to the app's own server carries this header: the server refuses API requests without it,
// which stops other web pages open in the browser from using it.
const api = (path, options = {}) => fetch(path, {
  ...options,
  headers: { "X-Whiteboard": "1", ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
});
const board = $("board"), scroller = $("scroller"), statusEl = $("status");
const addRelBtn = $("add-rel");
const styleEl = $("style"), deleteBtn = $("delete"), hideBtn = $("hide-arrow"), unhideBtn = $("unhide"), resetBtn = $("reset-arrow");
const colourBtn = $("colour-btn"), swatchEl = $("colour-swatch"), paletteEl = $("palette"), themeBtn = $("theme");

let diagram = { nodes: [], edges: [] };
let tool = "select";
let selection = new Set();   // ids of selected rectangles and arrows
let view = { x: 0, y: 0 };   // where the world origin sits on screen (panning)
let drag = null;             // current mouse gesture
let spaceDown = false;
let saveTimer = null;
let floating = {};           // arrow id -> {source, target}: where its free-floating ends sit this redraw
let lastArrow = "control_action"; // the kind of arrow drawn by dragging out of a connection point
let dirty = false;           // changes not yet saved
let dockOpen = false;        // tables panel at the bottom: open or minimised
let activeTab = "controller";
let tableData = [];          // last tables fetched from the server
let rowOf = {};              // entity id -> its row of linked ids, from tableData
let titleOf = {};            // entity type -> {property key: column title}, in column order
let lastTab = null;

// ---------- helpers ----------
const el = (name, attrs = {}, parent) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};
// Next free id for a type. Numbers are never reused while a higher one exists.
function newId(type) {
  const prefix = ID_PREFIX[type], re = new RegExp("^" + prefix + "(\\d+)$");
  let max = 0;
  for (const i of diagram.nodes.concat(diagram.edges, diagram.relationships || [])) {
    const m = re.exec(i.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return prefix + (max + 1);
}
const topLevel = (n) => (n.parent ? nodeById(n.parent) : n);
const nodeById = (id) => diagram.nodes.find(n => n.id === id);
const edgeById = (id) => diagram.edges.find(e => e.id === id);
const itemById = (id) => nodeById(id) || edgeById(id);
const centre = (n) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const isModifier = (ev) => ev.shiftKey || ev.ctrlKey || ev.metaKey;

// Mouse position in diagram coordinates (independent of panning).
function pointer(ev) {
  const r = board.getBoundingClientRect();
  return { x: ev.clientX - r.left - view.x, y: ev.clientY - r.top - view.y };
}

// Distance from p along unit vector d until it leaves rectangle n.
function exitDistance(n, p, d) {
  const ts = [];
  if (d.x > 0) ts.push((n.x + n.w - p.x) / d.x); else if (d.x < 0) ts.push((n.x - p.x) / d.x);
  if (d.y > 0) ts.push((n.y + n.h - p.y) / d.y); else if (d.y < 0) ts.push((n.y - p.y) / d.y);
  return Math.max(0, Math.min(...ts));
}

// Where an arrow meets a rectangle: the point on the border nearest to p,
// stored as fractions of the rectangle so it survives moving and resizing.
function snapAnchor(n, p) {
  let fx = clamp01((p.x - n.x) / n.w), fy = clamp01((p.y - n.y) / n.h);
  const nearest = [fx, 1 - fx, fy, 1 - fy];
  switch (nearest.indexOf(Math.min(...nearest))) {
    case 0: fx = 0; break;
    case 1: fx = 1; break;
    case 2: fy = 0; break;
    default: fy = 1;
  }
  return [fx, fy];
}
const anchorPoint = (n, a) => ({ x: n.x + a[0] * n.w, y: n.y + a[1] * n.h });

// Where an arrow can be pinned to a box: three points on each side (a quarter, half and three quarters along).
const CONNECT_POINTS = [];
for (const t of [0.25, 0.5, 0.75]) CONNECT_POINTS.push([t, 0], [1, t], [t, 1], [0, t]);
const SNAP = 12; // how close (px) the mouse must be to a connection point to snap to it

// The connection point of box n within r px of p, if any.
function nearPoint(n, p, r) {
  let best = null, bestD = r;
  for (const a of CONNECT_POINTS) {
    const q = anchorPoint(n, a), d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= bestD) { best = a; bestD = d; }
  }
  return best && [...best];
}

// What attaching an arrow end at p on box n means, as in draw.io: on a connection point or within 8 px of the
// outline, the end is fixed there; anywhere else on the box it floats (null) and picks the best side itself.
function attachAt(n, p) {
  const point = nearPoint(n, p, SNAP);
  if (point) return point;
  const edge = Math.min(p.x - n.x, n.x + n.w - p.x, p.y - n.y, n.y + n.h - p.y);
  return edge < 8 ? snapAnchor(n, p) : null;
}

// The point on n's outline in the direction of p (where a floating end appears while drawing).
function perimeterToward(n, p) {
  const c = centre(n), len = Math.hypot(p.x - c.x, p.y - c.y);
  if (len < 1) return c;
  const d = { x: (p.x - c.x) / len, y: (p.y - c.y) / len }, t = exitDistance(n, c, d);
  return { x: c.x + d.x * t, y: c.y + d.y * t };
}

// ---- floating ends ----
// An end with no fixed point follows its box: it leaves from the side facing the other end (or the next best
// side whose way out is clear), and ends sharing a side are spread evenly along it, ordered to avoid crossing.
const sideAnchor = (side, t) => [[1, t], [t, 1], [0, t], [t, 0]][side]; // side = index into DIRS

function facingSide(a, b) {
  const right = b.x - (a.x + a.w), left = a.x - (b.x + b.w), down = b.y - (a.y + a.h), up = a.y - (b.y + b.h);
  const across = Math.max(right, left), along = Math.max(down, up);
  if (across < 0 && along < 0) { // overlapping, e.g. an inner box and its own Controller: go by the centres
    const ca = centre(a), cb = centre(b);
    if (Math.abs(cb.x - ca.x) >= Math.abs(cb.y - ca.y)) return cb.x >= ca.x ? 0 : 2;
    return cb.y >= ca.y ? 1 : 3;
  }
  if (across >= along) return right >= left ? 0 : 2;
  return down >= up ? 1 : 3;
}

function computeFloating() {
  const out = {}, groups = new Map();
  for (const e of diagram.edges) {
    const a = nodeById(e.source), b = nodeById(e.target);
    if (!a || !b || e.hidden) continue;
    out[e.id] = {};
    const obstacles = obstaclesFor(e);
    for (const [end, n, other] of [["source", a, b], ["target", b, a]]) {
      if (e[end + "_anchor"]) continue;
      const first = facingSide(n, other), ca = centre(n), cb = centre(other);
      const across = first % 2 === 0 ? (cb.y >= ca.y ? [1, 3] : [3, 1]) : (cb.x >= ca.x ? [0, 2] : [2, 0]);
      const prefs = [first, ...across, (first + 2) % 4];
      const side = prefs.find(sd => stubClear(anchorPoint(n, sideAnchor(sd, 0.5)), sd, obstacles)) ?? first;
      const key = `${n.id}:${side}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ e, end, side, other });
    }
  }
  for (const group of groups.values()) {
    const along = (x) => { const c = centre(x.other); return x.side % 2 === 0 ? c.y : c.x; };
    group.sort((p, q) => along(p) - along(q) || (p.e.id < q.e.id ? -1 : p.e.id > q.e.id ? 1 : 0) || (p.end < q.end ? -1 : 1));
    group.forEach((x, i) => { out[x.e.id][x.end] = sideAnchor(x.side, (i + 1) / (group.length + 1)); });
  }
  return out;
}

// Where an arrow's end is attached right now: its fixed point, or where it is floating to.
const anchorOf = (e, end) => e[end + "_anchor"] || floating[e.id]?.[end] || [0.5, 0.5];

function edgeEnds(e) {
  const a = nodeById(e.source), b = nodeById(e.target);
  if (!a || !b) return null;
  const p1 = anchorPoint(a, anchorOf(e, "source")), p2 = anchorPoint(b, anchorOf(e, "target"));
  if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 2) return null;
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
}

// The boxes an arrow must keep clear of: all of them except the two it connects, the Controller around
// an inner box it connects, and the inner boxes of a Controller it connects.
function obstaclesFor(e) {
  const related = (n) => new Set([n.id, n.parent, ...diagram.nodes.filter(k => k.parent === n.id).map(k => k.id)].filter(Boolean));
  const a = nodeById(e.source), b = nodeById(e.target);
  const skip = new Set([...related(a), ...related(b)]);
  return diagram.nodes.filter(n => !skip.has(n.id));
}

// The right-angled route an arrow is drawn along, from its start to its end point.
function edgePath(e) {
  const a = nodeById(e.source), b = nodeById(e.target);
  return routeOrthogonal(
    anchorPoint(a, anchorOf(e, "source")), sideDir(anchorOf(e, "source")),
    anchorPoint(b, anchorOf(e, "target")), sideDir(anchorOf(e, "target")),
    obstaclesFor(e), e.via || [],
  );
}

// The straight runs of an arrow's route that can be dragged sideways: all but the two at its ends.
// Each says its axis (0: horizontal, so it moves up and down; 1: vertical), its middle, the index in
// e.via of a point the user already pinned on it (or null), and where a new pinned point would go in e.via.
function segmentRuns(path) {
  const runs = [];
  let start = 0;
  for (let k = 1; k < path.length; k++) {
    const flat = path[k].y === path[k - 1].y;
    const next = k + 1 < path.length ? path[k + 1].y === path[k].y : null;
    if (next !== flat) { runs.push({ from: start, to: k, axis: flat ? 0 : 1 }); start = k; }
  }
  return runs.filter(r => r.from > 0 && r.to < path.length - 1).map(r => {
    let via = null;
    for (let k = r.from + 1; k < r.to; k++) if (path[k].via !== undefined) via = path[k].via;
    if (via === null) via = path[r.from].via ?? path[r.to].via ?? null; // an older pinned corner
    const a = path[r.from], b = path[r.to];
    return {
      ...r, via, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      insertAt: path.slice(0, r.from + 1).filter(q => q.via !== undefined).length,
    };
  });
}

// Draw a box's connection points (in the overlay), with the one in `hot` filled.
function drawPoints(n, hot) {
  for (const a of CONNECT_POINTS) {
    const q = anchorPoint(n, a), on = hot && hot[0] === a[0] && hot[1] === a[1];
    el("circle", { class: "cpoint" + (on ? " hot" : ""), cx: q.x, cy: q.y, r: on ? 5 : 3.5 }, $("overlay"));
  }
}

// The box under the mouse; an inner box wins over the Controller around it.
function hit(p) {
  const inside = (n) => p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h;
  for (let i = diagram.nodes.length - 1; i >= 0; i--) {
    const n = diagram.nodes[i];
    if (n.parent) continue;
    const inner = diagram.nodes.find(k => k.parent === n.id && inside(k));
    if (inner) return inner;
    if (inside(n)) return n;
  }
  return null;
}

// Control Algorithm (top) and Process Model (below) fill the right half of their Controller.
// Their position is always worked out from the Controller, so they follow it around.
function layoutChildren() {
  for (const c of diagram.nodes) {
    if (c.type !== "controller") continue;
    c.w = Math.max(c.w, CTRL_MIN.w);
    c.h = Math.max(c.h, CTRL_MIN.h);
    const pad = 8, top = c.y + 24, h = (c.h - 24 - 2 * pad) / 2;
    CHILD_TYPES.forEach((type, i) => {
      const k = diagram.nodes.find(n => n.parent === c.id && n.type === type);
      if (k) Object.assign(k, { x: c.x + c.w / 2 + pad, y: top + i * (h + pad), w: c.w / 2 - 2 * pad, h });
    });
  }
}

// ---------- drawing ----------
function marker(colour) {
  const id = "arrow-" + (colour === "auto" ? "auto" : colour.slice(1));
  if (!document.getElementById(id)) {
    const m = el("marker", {
      id, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 9, markerHeight: 9,
      orient: "auto", markerUnits: "userSpaceOnUse",
    }, $("defs"));
    el("path", { d: "M0,0 L10,5 L0,10 z", style: `fill:${paint(colour)}` }, m);
  }
  return `url(#${id})`;
}

function applyView() {
  $("world").setAttribute("transform", `translate(${view.x},${view.y})`);
  board.style.backgroundPosition = `${view.x}px ${view.y}px`;
}

// Text lines for properties other than ID and name, e.g. "Outgoing control actions: A1, A2".
function extraLines(item) {
  const row = rowOf[item.id], titles = titleOf[item.type] || {};
  return shownOf(item).filter(k => k !== "id" && k !== "name").map(k => {
    let v = k === "description" || k === "effect" ? item[k] : row ? row[k] : undefined; // typed text is read live
    if (typeof v === "string" && v.length > 70) v = v.slice(0, 69) + "…"; // long text is cut on the diagram only
    return `${titles[k] || k}: ${(Array.isArray(v) ? v.join(", ") : v) || "—"}`;
  });
}

function drawNode(n) {
  const child = Boolean(n.parent), hover = drag?.hover === n.id, shown = shownOf(n);
  const g = el("g", {
    class: "node" + (child ? " child" : "") + (selection.has(n.id) ? " selected" : "") + (hover ? " target-ok" : ""),
    "data-id": n.id,
  }, $("nodes"));
  el("rect", {
    class: "node-rect", x: n.x, y: n.y, width: n.w, height: n.h, rx: child ? 4 : 6,
    style: `fill:${paint(n.colour)};stroke:${paint(n.colour)}`,
  }, g);
  // Ring round the rectangle an arrow will connect to if released now.
  if (hover) el("rect", { class: "target-ring", x: n.x - 6, y: n.y - 6, width: n.w + 12, height: n.h + 12, rx: 10 }, g);

  // Text is clipped to the box (a Controller's to its left half, clear of the inner boxes).
  const clip = el("clipPath", { id: "clip-" + n.id }, g);
  el("rect", { x: n.x, y: n.y, width: n.type === "controller" ? n.w / 2 - 4 : n.w, height: n.h }, clip);
  const clipped = { "clip-path": `url(#clip-${n.id})` };
  if (shown.includes("id")) el("text", { class: "node-type", x: n.x + 7, y: n.y + 14, ...clipped }, g).textContent = n.id;

  const lines = [];
  if (shown.includes("name")) lines.push({ text: n.label, cls: child ? " small" : "" });
  extraLines(n).forEach(text => lines.push({ text, cls: " extra" }));
  const cx = n.type === "controller" ? n.x + n.w / 4 : n.x + n.w / 2, step = 15;
  const top = n.y + n.h / 2 - ((lines.length - 1) * step) / 2 + 5;
  lines.forEach((ln, i) => {
    el("text", { class: "node-label" + ln.cls, x: cx, y: top + i * step, ...clipped }, g).textContent = ln.text;
  });
}

function render() {
  layoutChildren();
  floating = computeFloating();
  const paths = {}; // arrow id -> the route it was drawn along this time
  $("nodes").replaceChildren();
  $("edges").replaceChildren();
  $("handles").replaceChildren();

  for (const e of diagram.edges) {
    const ends = !e.hidden && edgeEnds(e);
    if (!ends) continue;
    const g = el("g", { class: "edge" + (selection.has(e.id) ? " selected" : ""), "data-id": e.id }, $("edges"));
    const path = (paths[e.id] = edgePath(e)), points = path.map(p => `${p.x},${p.y}`).join(" "), mid = pathMiddle(path);
    el("polyline", { points, class: "edge-hit" }, g);
    el("polyline", {
      points, fill: "none", class: "edge-line", style: `stroke:${paint(e.colour)}`, "stroke-width": 2.5,
      "stroke-linejoin": "round", "stroke-dasharray": e.style === "dashed" ? "9 6" : "none", "marker-end": marker(e.colour),
    }, g);
    const shown = shownOf(e), first = [shown.includes("id") ? e.id : "", shown.includes("name") ? e.label : ""].filter(Boolean).join(" ");
    const lines = (first ? [{ text: first, cls: "" }] : []).concat(extraLines(e).map(text => ({ text, cls: " extra" })));
    const top = mid.y - 6 - (lines.length - 1) * 14;
    lines.forEach((ln, i) => {
      el("text", { class: "edge-label" + ln.cls, x: mid.x, y: top + i * 14 }, g).textContent = ln.text;
    });
  }

  for (const n of diagram.nodes) {
    if (n.parent) continue;
    drawNode(n);
    diagram.nodes.filter(k => k.parent === n.id).forEach(drawNode); // inner boxes on top of their Controller
  }

  // Resize handle for a lone rectangle; end handles on every selected arrow.
  const only = selection.size === 1 ? itemById([...selection][0]) : null;
  if (only && only.w && !only.parent) {
    el("rect", { class: "handle", x: only.x + only.w - 6, y: only.y + only.h - 6, width: 12, height: 12, rx: 2 }, $("handles"));
  }
  for (const id of selection) {
    const e = edgeById(id), ends = e && !e.hidden && edgeEnds(e);
    if (!ends) continue;
    for (const [end, x, y] of [["source", ends.x1, ends.y1], ["target", ends.x2, ends.y2]]) {
      el("circle", { class: "anchor-handle", cx: x, cy: y, r: 7, "data-end": end, "data-edge": e.id }, $("handles"));
    }
    // A handle in the middle of each inner segment: drag it sideways to move that part of the arrow away from
    // other arrows. A filled one is a segment you have moved; double-click it to let it route itself again.
    segmentRuns(paths[e.id] || []).forEach((run, r) => {
      el("rect", {
        class: "seg-handle " + (run.axis === 0 ? "h" : "v") + (run.via !== null ? " pinned" : ""),
        x: run.mid.x - 5, y: run.mid.y - 5, width: 10, height: 10, rx: 2, "data-edge": e.id, "data-run": r,
      }, $("handles"));
    });
  }
  deleteBtn.disabled = selection.size === 0;
  const hiddenCount = diagram.edges.filter(e => e.hidden).length;
  hideBtn.disabled = ![...selection].some(id => edgeById(id) && !edgeById(id).hidden);
  unhideBtn.disabled = !hiddenCount; // always there, so the toolbar doesn't change length
  unhideBtn.textContent = `Unhide arrows (${hiddenCount})`;
  addRelBtn.disabled = selectedArrows().length < 2;
  resetBtn.disabled = ![...selection].map(edgeById).some(e => e && (e.source_anchor || e.target_anchor || (e.via && e.via.length)));
}

function setSelection(ids) {
  selection = new Set(ids);
  const item = selection.size === 1 ? itemById([...selection][0]) : null;
  if (item && item.style) styleEl.value = item.style;
  refreshSwatch();
  render();
  if (dockOpen) showSelectionInTables();
}
function toggle(id) {
  const s = new Set(selection);
  s.has(id) ? s.delete(id) : s.add(id);
  setSelection(s);
}

// ---------- saving ----------
function setStatus(text) { statusEl.textContent = text; statusEl.title = text; }
function changed() {
  dirty = true;
  setStatus("Unsaved…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}
async function save() {
  try {
    const r = await api("/api/diagram", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(diagram),
    });
    if (r.ok) { dirty = false; setStatus("Saved"); await loadTables(); }
    else setStatus("Not saved: " + ((await r.json()).error || r.status));
  } catch { setStatus("Not saved: server unreachable"); }
}
async function load() {
  refreshFileInfo();
  try {
    const r = await api("/api/diagram");
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    diagram = data;
    diagram.relationships = diagram.relationships || []; // files from before 0.13 have none
    layoutChildren();
    setStatus(diagram.nodes.length ? "Loaded" : "New diagram");
  } catch (err) { setStatus("Could not load: " + err.message); }
  goHome();
  loadTables(); // the diagram can show linked ids, which come from the tables
}

// Put the top-left of the diagram near the top-left of the screen.
function goHome() {
  if (diagram.nodes.length) {
    view = {
      x: HOME_PAD - Math.min(...diagram.nodes.map(n => n.x)),
      y: HOME_PAD - Math.min(...diagram.nodes.map(n => n.y)),
    };
  } else view = { x: 0, y: 0 };
  applyView();
  render();
}
$("home").addEventListener("click", goHome);

// ---------- tools ----------
function setTool(t) {
  tool = t;
  if (EDGE_TOOLS.includes(t)) lastArrow = t;
  refreshSwatch();
  document.querySelectorAll(".tool").forEach(b => b.classList.toggle("active", b.dataset.tool === t));
  updateCursor();
}
function updateCursor() {
  board.classList.toggle("drawing", NODE_TOOLS.includes(tool) || EDGE_TOOLS.includes(tool));
  board.classList.toggle("pan", tool === "pan" || spaceDown);
  board.classList.toggle("panning", drag?.mode === "pan");
}
document.querySelectorAll(".tool").forEach(b => b.addEventListener("click", () => setTool(b.dataset.tool)));

// ---------- colour chart ----------
// Applies to the selected items; with nothing selected and a drawing tool active, to the next thing drawn.
function currentColour() {
  const first = [...selection].map(itemById).find(Boolean);
  return first ? first.colour : pen[tool] || pen.controller;
}
function refreshSwatch() {
  const c = currentColour();
  swatchEl.style.background = paint(c);
  paletteEl.querySelectorAll("button").forEach(b => b.classList.toggle("current", b.dataset.colour === c));
}
function applyColour(c) {
  const items = [...selection].map(itemById).filter(Boolean);
  if (items.length) {
    items.forEach(i => { i.colour = c; pen[i.type] = c; });
    render();
    changed();
  } else if (tool in pen) pen[tool] = c;
  else setStatus("Select something, or pick a drawing tool, then choose a colour");
  refreshSwatch();
}
PALETTE.forEach(([name, value]) => {
  const b = document.createElement("button");
  b.dataset.colour = value;
  b.title = name;
  b.setAttribute("role", "menuitem");
  b.setAttribute("aria-label", name);
  if (value === "auto") { b.className = "auto"; b.textContent = "A"; } else b.style.background = value;
  b.addEventListener("click", () => { applyColour(value); closePalette(); });
  paletteEl.append(b);
});
function closePalette() { paletteEl.hidden = true; colourBtn.setAttribute("aria-expanded", "false"); }
colourBtn.addEventListener("click", () => {
  paletteEl.hidden = !paletteEl.hidden;
  colourBtn.setAttribute("aria-expanded", String(!paletteEl.hidden));
  refreshSwatch();
});
document.addEventListener("mousedown", (ev) => {
  if (!paletteEl.hidden && !ev.target.closest("#colour-group")) closePalette();
});

// ---------- theme ----------
const THEMES = ["auto", "light", "dark"];
function applyTheme(t) {
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  themeBtn.textContent = "Theme: " + t[0].toUpperCase() + t.slice(1);
  try { t === "auto" ? localStorage.removeItem("whiteboard-theme") : localStorage.setItem("whiteboard-theme", t); } catch {}
}
themeBtn.addEventListener("click", () => {
  const now = document.documentElement.dataset.theme || "auto";
  applyTheme(THEMES[(THEMES.indexOf(now) + 1) % THEMES.length]);
});
applyTheme(document.documentElement.dataset.theme || "auto");

styleEl.addEventListener("change", () => {
  const edges = [...selection].map(edgeById).filter(Boolean);
  if (edges.length) { edges.forEach(e => { e.style = styleEl.value; }); render(); changed(); }
});

function deleteSelected() {
  // An inner box goes with its Controller, never on its own.
  const doomed = new Set([...selection].filter(id => !nodeById(id)?.parent));
  if (selection.size && !doomed.size) {
    setStatus("Delete the Controller to remove its Control Algorithm / Process Model");
    return;
  }
  if (!doomed.size) return;
  for (const n of diagram.nodes) if (n.parent && doomed.has(n.parent)) doomed.add(n.id);
  diagram.nodes = diagram.nodes.filter(n => !doomed.has(n.id));
  // An arrow can't exist without both ends, so arrows on a deleted rectangle go too.
  diagram.edges = diagram.edges.filter(e => !doomed.has(e.id) && nodeById(e.source) && nodeById(e.target));
  // A relationship needs at least two arrows: forget deleted ones, and drop any left with fewer than two.
  const left = new Set(diagram.edges.map(e => e.id));
  diagram.relationships = (diagram.relationships || [])
    .map(r => ({ ...r, arrows: r.arrows.filter(a => left.has(a)) }))
    .filter(r => r.arrows.length >= 2);
  setSelection([]);
  changed();
}
deleteBtn.addEventListener("click", deleteSelected);
hideBtn.addEventListener("click", () => setHidden([...selection].map(edgeById).filter(Boolean), true));
unhideBtn.addEventListener("click", () => setHidden(diagram.edges.filter(e => e.hidden), false));
// Back to fully automatic: both ends float and the route finds its own way.
resetBtn.addEventListener("click", () => {
  for (const e of [...selection].map(edgeById).filter(Boolean)) { e.source_anchor = e.target_anchor = null; e.via = []; }
  render();
  changed();
});

const KEYS = { s: "select", h: "pan", c: "controller", p: "controlled_process", a: "control_action", f: "feedback" };
document.addEventListener("keydown", (ev) => {
  if (document.querySelector("dialog[open]")) return; // a Save / Open / question box has the keyboard
  if (ev.key === "Escape" && !paletteEl.hidden) { closePalette(); return; }
  if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.key.toLowerCase() === "s") { ev.preventDefault(); openFileDialog("save"); return; }
  if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.key.toLowerCase() === "o") { ev.preventDefault(); openFileDialog("open"); return; }
  if (ev.target.matches("input, select")) return;
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "a") {
    setSelection([...diagram.nodes, ...diagram.edges.filter(e => !e.hidden)].map(i => i.id));
    return ev.preventDefault();
  }
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (ev.key === " ") { spaceDown = true; updateCursor(); ev.preventDefault(); }
  else if (ev.key === "Delete" || ev.key === "Backspace") { deleteSelected(); ev.preventDefault(); }
  else if (ev.key === "Escape") { drag = null; $("overlay").replaceChildren(); setSelection([]); setTool("select"); }
  else if (ev.key.toLowerCase() === "t") toggleDock();
  else if (KEYS[ev.key.toLowerCase()]) setTool(KEYS[ev.key.toLowerCase()]);
});
document.addEventListener("keyup", (ev) => { if (ev.key === " ") { spaceDown = false; updateCursor(); } });

// Trackpad / wheel scrolling pans the canvas too.
board.addEventListener("wheel", (ev) => {
  view.x -= ev.deltaX; view.y -= ev.deltaY;
  applyView();
  ev.preventDefault();
}, { passive: false });

// ---------- mouse ----------
board.addEventListener("mousedown", (ev) => {
  if (ev.button !== 0 && ev.button !== 1) return;
  // We cancel the default below, so release any box being typed in (a name in the tables) ourselves.
  if (document.activeElement && document.activeElement.matches("input, select")) document.activeElement.blur();
  const p = pointer(ev), n = hit(p), edgeEl = ev.target.closest(".edge");
  drag = null;

  if (ev.button === 1 || tool === "pan" || spaceDown) {
    drag = { mode: "pan", sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y };
  } else if (tool === "select") {
    if (ev.target.classList.contains("handle")) {
      drag = { mode: "resize", node: nodeById([...selection][0]), moved: false };
    } else if (ev.target.classList.contains("anchor-handle")) {
      drag = { mode: "anchor", edge: edgeById(ev.target.dataset.edge), end: ev.target.dataset.end, moved: false, from: p };
    } else if (ev.target.classList.contains("seg-handle")) {
      // Grab a segment. If it hasn't been moved before, a pinned point is added when you start dragging.
      const e = edgeById(ev.target.dataset.edge), run = segmentRuns(edgePath(e))[Number(ev.target.dataset.run)];
      if (run) drag = { mode: "segment", edge: e, axis: run.axis, mid: run.mid, at: run.via ?? run.insertAt, fresh: run.via === null, moved: false, from: p };
    } else if (n && !isModifier(ev) && nearPoint(n, p, 7)) {
      // Pressing on a box's connection point draws an arrow out of it (the kind last picked in the toolbar).
      drag = { mode: "connect", from: n, anchor: nearPoint(n, p, 7), type: lastArrow, moved: false };
    } else if (n) {
      let collapse = false;
      if (isModifier(ev)) toggle(n.id);
      else if (!selection.has(n.id)) setSelection([n.id]);
      else collapse = selection.size > 1; // plain click inside a group narrows it on release
      if (selection.has(n.id)) {
        const top = topLevel(n);
        diagram.nodes.push(diagram.nodes.splice(diagram.nodes.indexOf(top), 1)[0]); // bring to front
        // Inner boxes can't move on their own: grabbing one moves its Controller.
        const movers = new Set([...selection].map(nodeById).filter(Boolean).map(topLevel));
        const starts = [...movers].map(m => ({ node: m, x: m.x, y: m.y }));
        drag = { mode: "move", from: p, starts, moved: false, collapse, id: n.id };
        render();
      }
    } else if (edgeEl) {
      const e = edgeById(edgeEl.dataset.id), ends = edgeEnds(e);
      const nearEnd = !isModifier(ev) && ends && [["source", ends.x1, ends.y1], ["target", ends.x2, ends.y2]]
        .find(([, x, y]) => Math.hypot(p.x - x, p.y - y) < 12);
      if (nearEnd) {
        setSelection([e.id]);
        drag = { mode: "anchor", edge: e, end: nearEnd[0], moved: false, from: p };
      } else isModifier(ev) ? toggle(e.id) : setSelection([e.id]);
    } else {
      const additive = isModifier(ev);
      drag = { mode: "marquee", start: p, base: additive ? new Set(selection) : new Set() };
      if (!additive) setSelection([]);
    }
  } else if (NODE_TOOLS.includes(tool)) {
    drag = { mode: "create", start: p };
  } else if (EDGE_TOOLS.includes(tool) && n) {
    drag = { mode: "connect", from: n, anchor: attachAt(n, p), type: tool, moved: false };
  }
  if (drag) { ev.preventDefault(); updateCursor(); }
});

function marqueeHits(a, b) {
  const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
  const inside = (x, y) => x >= x1 && x <= x2 && y >= y1 && y <= y2;
  const ids = [];
  for (const n of diagram.nodes) {
    if (n.x <= x2 && n.x + n.w >= x1 && n.y <= y2 && n.y + n.h >= y1) ids.push(n.id);
  }
  for (const e of diagram.edges) {
    const ends = !e.hidden && edgeEnds(e);
    if (ends && inside(ends.x1, ends.y1) && inside(ends.x2, ends.y2)) ids.push(e.id);
  }
  return ids;
}

// With no button held, show the connection points of the box under the mouse (select and arrow tools).
function showHoverPoints(ev) {
  const ov = $("overlay");
  const live = board.contains(ev.target) && !spaceDown && (tool === "select" || EDGE_TOOLS.includes(tool));
  const n = live ? hit(pointer(ev)) : null;
  const hot = n && nearPoint(n, pointer(ev), tool === "select" ? 7 : SNAP);
  if (ov.childNodes.length || n) ov.replaceChildren();
  if (n) drawPoints(n, hot);
  board.classList.toggle("on-point", Boolean(hot));
}

window.addEventListener("mousemove", (ev) => {
  if (!drag) { showHoverPoints(ev); return; }
  const p = pointer(ev), ov = $("overlay");
  if (drag.mode === "pan") {
    view.x = drag.vx + ev.clientX - drag.sx;
    view.y = drag.vy + ev.clientY - drag.sy;
    applyView();
  } else if (drag.mode === "move") {
    const dx = p.x - drag.from.x, dy = p.y - drag.from.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return; // ignore click jitter
    for (const s of drag.starts) { s.node.x = s.x + dx; s.node.y = s.y + dy; }
    drag.moved = true;
    render();
  } else if (drag.mode === "resize") {
    drag.node.w = Math.max(MIN_SIZE, p.x - drag.node.x);
    drag.node.h = Math.max(MIN_SIZE, p.y - drag.node.y);
    drag.moved = true;
    render();
  } else if ((drag.mode === "anchor" || drag.mode === "segment") && !drag.moved && Math.hypot(p.x - drag.from.x, p.y - drag.from.y) < 3) {
    return; // a click (or a double-click) on a handle must not pin anything
  } else if (drag.mode === "anchor") {
    // Slide the end along its rectangle's border, or drop it on another rectangle to re-attach it.
    const e = drag.edge, otherId = drag.end === "source" ? e.target : e.source;
    let n = hit(p);
    if (!n || n.id === otherId) n = nodeById(e[drag.end]);
    e[drag.end] = n.id;
    e[drag.end + "_anchor"] = attachAt(n, p); // a point, the outline, or (inside the box) floating
    drag.moved = true;
    drag.hover = n.id;
    render();
    ov.replaceChildren();
    drawPoints(n, e[drag.end + "_anchor"]);
    const a = anchorPoint(n, anchorOf(e, drag.end));
    el("circle", { class: "attach-dot", cx: a.x, cy: a.y, r: 5 }, ov);
  } else if (drag.mode === "segment") {
    // The segment slides sideways only: a horizontal one up and down, a vertical one left and right.
    const e = drag.edge, pt = drag.axis === 0 ? [drag.mid.x, p.y, 0] : [p.x, drag.mid.y, 1];
    if (!drag.moved) {
      e.via = e.via || [];
      if (drag.fresh) e.via.splice(drag.at, 0, pt);
    }
    e.via[drag.at] = pt;
    drag.moved = true;
    render();
  } else if (drag.mode === "marquee") {
    ov.replaceChildren();
    el("rect", {
      class: "marquee", x: Math.min(drag.start.x, p.x), y: Math.min(drag.start.y, p.y),
      width: Math.abs(p.x - drag.start.x), height: Math.abs(p.y - drag.start.y),
    }, ov);
    setSelection(new Set([...drag.base, ...marqueeHits(drag.start, p)]));
  } else if (drag.mode === "create") {
    ov.replaceChildren();
    el("rect", {
      x: Math.min(drag.start.x, p.x), y: Math.min(drag.start.y, p.y),
      width: Math.abs(p.x - drag.start.x), height: Math.abs(p.y - drag.start.y),
      fill: "none", style: `stroke:${paint(pen[tool])}`, "stroke-dasharray": "4 4", "stroke-width": 2,
    }, ov);
  } else if (drag.mode === "connect") {
    const over = hit(p), target = over && over !== drag.from ? over : null;
    const s = drag.anchor ? anchorPoint(drag.from, drag.anchor) : perimeterToward(drag.from, p);
    drag.moved = true;
    drag.hover = target ? target.id : null;
    render();
    ov.replaceChildren();
    const colour = paint(pen[drag.type]);
    el("line", {
      x1: s.x, y1: s.y, x2: p.x, y2: p.y, style: `stroke:${colour}`, "stroke-width": 2.5,
      "stroke-dasharray": styleEl.value === "dashed" ? "9 6" : "none",
    }, ov);
    el("circle", { cx: s.x, cy: s.y, r: 5, style: `fill:${colour}` }, ov);
    if (target) { // its points, the one you would snap to filled, and a dot where the end would land
      const a = attachAt(target, p);
      drawPoints(target, a);
      const at = a ? anchorPoint(target, a) : perimeterToward(target, s);
      el("circle", { class: "attach-dot", cx: at.x, cy: at.y, r: 5 }, ov);
    }
  }
});

window.addEventListener("mouseup", (ev) => {
  if (!drag) return;
  const p = pointer(ev), d = drag;
  drag = null;
  $("overlay").replaceChildren();
  updateCursor();

  if (d.mode === "move" || d.mode === "resize" || d.mode === "anchor" || d.mode === "segment") {
    if (d.moved) changed();
    else if (d.collapse) setSelection([d.id]);
    render(); // clears the connect highlight
  } else if (d.mode === "create") {
    let x = Math.min(d.start.x, p.x), y = Math.min(d.start.y, p.y);
    let w = Math.abs(p.x - d.start.x), h = Math.abs(p.y - d.start.y);
    if (w < MIN_SIZE && h < MIN_SIZE) { // plain click: default size, centred on the click
      ({ w, h } = DEFAULT_SIZE[tool]);
      x = d.start.x - w / 2; y = d.start.y - h / 2;
    }
    const n = {
      id: newId(tool), type: tool, x, y, w: Math.max(MIN_SIZE, w), h: Math.max(MIN_SIZE, h),
      label: TYPE_NAMES[tool], colour: pen[tool], shown: [...DEFAULT_SHOWN],
    };
    diagram.nodes.push(n);
    if (tool === "controller") { // every Controller is born with its two inner boxes
      for (const type of CHILD_TYPES) {
        diagram.nodes.push({
          id: newId(type), type, parent: n.id, x: n.x, y: n.y, w: MIN_SIZE, h: MIN_SIZE,
          label: TYPE_NAMES[type], colour: n.colour, shown: [...DEFAULT_SHOWN],
        });
      }
    }
    setTool("select");
    setSelection([n.id]);
    changed();
  } else if (d.mode === "connect") {
    const to = hit(p);
    if (!to || to === d.from) {
      if (d.moved) setStatus("Drop the arrow on a different box");
      render();
      return;
    }
    const e = {
      id: newId(d.type), type: d.type, source: d.from.id, target: to.id,
      style: styleEl.value, label: TYPE_NAMES[d.type], colour: pen[d.type], shown: [...DEFAULT_SHOWN],
      source_anchor: d.anchor, target_anchor: attachAt(to, p), via: [],
    };
    diagram.edges.push(e);
    setSelection([e.id]);
    changed();
  }
});

// Double-click: a moved segment's handle lets it route itself again; an arrow's end handle lets that end
// float again; anything else opens its table with the name ready to edit.
board.addEventListener("dblclick", (ev) => {
  if (tool !== "select") return;
  if (ev.target.classList.contains("seg-handle")) {
    const e = edgeById(ev.target.dataset.edge), run = segmentRuns(edgePath(e))[Number(ev.target.dataset.run)];
    if (run && run.via !== null) { e.via.splice(run.via, 1); render(); changed(); }
    return;
  }
  if (ev.target.classList.contains("anchor-handle")) {
    const e = edgeById(ev.target.dataset.edge);
    if (e) { e[ev.target.dataset.end + "_anchor"] = null; render(); changed(); }
    return;
  }
  const n = hit(pointer(ev)), edgeEl = ev.target.closest(".edge");
  const id = n ? n.id : edgeEl ? edgeEl.dataset.id : null;
  if (id) editNameInTable(id);
});

// ---------- Save as / Open ----------
// The diagram autosaves to the file being worked on. Save as saves it to a file and folder you choose and
// carries on there; Open switches to another file. Both use this page's own dialog (not every browser can
// show a real one), which lists folders through the app's server. Files are indented JSON.
const fileDialog = $("file-dialog"), fdList = $("fd-list"), fdName = $("fd-name"), fdDir = $("fd-dir");
const fdError = $("fd-error"), fdOk = $("fd-ok"), fdUp = $("fd-up"), askDialog = $("ask-dialog"), askOk = $("ask-ok");
let currentFile = null; // {path, name, dir} of the file being worked on
let fd = null;          // the file dialog while it is open: {mode: "save" | "open", dir, parent, home}
let fdBusy = false;
$("save-file").addEventListener("click", () => openFileDialog("save"));
$("open-file-btn").addEventListener("click", () => openFileDialog("open"));

async function refreshFileInfo() {
  try {
    const r = await api("/api/file");
    if (r.ok) { currentFile = await r.json(); showFileName(); }
  } catch { /* the status already says if the server can't be reached */ }
}
function showFileName() {
  const label = $("file-name");
  label.textContent = currentFile ? currentFile.name : "";
  label.title = currentFile ? `Working on ${currentFile.path}` : "";
  document.title = currentFile ? `${currentFile.name} – Whiteboard` : "Whiteboard";
}

function openFileDialog(mode) {
  if (fileDialog.open) return;
  fd = { mode };
  $("fd-title").textContent = mode === "save" ? "Save as" : "Open";
  fdOk.textContent = mode === "save" ? "Save" : "Open";
  fdName.value = mode === "save" && currentFile ? currentFile.name : "";
  fdError.textContent = "";
  fileDialog.showModal();
  fdName.focus();
  fdName.select();
  showFolder(currentFile ? currentFile.dir : "");
}

async function showFolder(dir) {
  fdError.textContent = "";
  let data;
  try {
    const r = await api("/api/browse" + (dir ? "?dir=" + encodeURIComponent(dir) : ""));
    data = await r.json();
    if (!r.ok) throw new Error(data.error);
  } catch (err) { fdError.textContent = err.message; return; }
  Object.assign(fd, { dir: data.dir, parent: data.parent, home: data.home });
  fdDir.textContent = data.dir;
  fdDir.title = data.dir;
  fdUp.disabled = !data.parent;
  fdList.replaceChildren();
  const entry = (text, cls, onClick, onDouble) => {
    const li = html("li"), b = html("button", text, cls);
    b.type = "button";
    b.addEventListener("click", onClick);
    if (onDouble) b.addEventListener("dblclick", onDouble);
    li.append(b);
    fdList.append(li);
    return b;
  };
  for (const f of data.folders) entry(f.name, "folder", () => showFolder(f.path));
  for (const f of data.files) {
    const b = entry(f.name, "file", () => {
      fdName.value = f.name;
      fdList.querySelectorAll(".chosen").forEach(x => x.classList.remove("chosen"));
      b.classList.add("chosen");
    }, () => { fdName.value = f.name; submitFileDialog(); });
  }
  if (!data.folders.length && !data.files.length) fdList.append(html("li", "No folders or diagram files here.", "hint"));
}

fdUp.addEventListener("click", () => { if (fd && fd.parent) showFolder(fd.parent); });
$("fd-home").addEventListener("click", () => { if (fd) showFolder(fd.home || ""); });
$("fd-cancel").addEventListener("click", () => fileDialog.close());
$("fd-form").addEventListener("submit", (ev) => { ev.preventDefault(); submitFileDialog(); });

async function submitFileDialog() {
  if (fdBusy || !fd) return;
  const name = fdName.value.trim();
  if (!name) { fdError.textContent = "Type a file name, or pick a file from the list."; return; }
  fdBusy = true;
  try {
    if (fd.mode === "save") await saveAs(name, false);
    else await openFile(name);
  } catch { fdError.textContent = "The app's server can't be reached. Is it still running?"; }
  finally { fdBusy = false; }
}

async function saveAs(name, overwrite) {
  const r = await api("/api/save-as", { method: "POST", body: JSON.stringify({ dir: fd.dir, name, overwrite, diagram }) });
  const data = await r.json();
  if (r.status === 409 && data.exists) {
    if (await ask(`${data.name} already exists in this folder.\nDo you want to replace it?`, "Replace")) return saveAs(name, true);
    return;
  }
  if (!r.ok) { fdError.textContent = data.error; return; }
  clearTimeout(saveTimer); // everything on screen is now in the new file
  dirty = false;
  currentFile = data.file;
  showFileName();
  fileDialog.close();
  setStatus(`Saved as ${data.file.name}`);
}

async function openFile(name) {
  if (!(await ask(`Open ${name}?\nAny unsaved changes will be lost.`, "Open"))) {
    fileDialog.close(); // Cancel cancels the whole thing
    return;
  }
  const r = await api("/api/open", { method: "POST", body: JSON.stringify({ dir: fd.dir, name }) });
  const data = await r.json();
  if (!r.ok) { fdError.textContent = data.error; return; } // nothing has changed; pick another file
  clearTimeout(saveTimer); // anything not yet autosaved is dropped, as the question said
  dirty = false;
  editing = null;
  currentFile = data.file;
  showFileName();
  fileDialog.close();
  selection = new Set();
  await load();
  setStatus(`Opened ${data.file.name}`);
}

// A question with two buttons: resolves true for the OK button (labelled okLabel), false for Cancel or Esc.
function ask(message, okLabel) {
  return new Promise((resolve) => {
    $("ask-text").textContent = message;
    askOk.textContent = okLabel;
    askDialog.returnValue = "";
    askDialog.addEventListener("close", () => resolve(askDialog.returnValue === "ok"), { once: true });
    askDialog.showModal();
    askOk.focus();
  });
}

// ---------- relationships ----------
// Two or more arrows the user says are related (say a Control Action and the Feedback that reports its result),
// with a description. Made from the selected arrows; listed, edited and removed in the Relationships table.
const relDialog = $("rel-dialog"), relText = $("rel-text");
let relArrows = [];
const relById = (id) => (diagram.relationships || []).find(r => r.id === id);
function selectedArrows() { return [...selection].map(edgeById).filter(e => e && !e.hidden); }

addRelBtn.addEventListener("click", () => {
  relArrows = selectedArrows().map(e => e.id);
  if (relArrows.length < 2) return;
  $("rel-arrows").textContent = "Between " + relArrows.map(id => {
    const e = edgeById(id);
    return e.label ? `${id} (${e.label})` : id;
  }).join(", ");
  relText.value = "";
  relDialog.showModal();
  relText.focus();
});
$("rel-cancel").addEventListener("click", () => relDialog.close());
$("rel-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const r = { id: newId("relationship"), arrows: relArrows, description: relText.value.slice(0, 1000) };
  diagram.relationships.push(r);
  relDialog.close();
  changed();
  setStatus(`Added relationship ${r.id}`);
  // Show it in its table.
  setSelection([]);
  activeTab = "relationship";
  if (!dockOpen) await openDock();
});

function removeRelationship(rel) {
  diagram.relationships = diagram.relationships.filter(r => r !== rel);
  const t = tableData.find(x => x.key === "relationship");
  if (t) t.rows = t.rows.filter(row => row.id !== rel.id); // gone at once, before the save comes back
  changed();
  renderDock();
  setStatus(`Removed relationship ${rel.id}`);
}

// Select a relationship's arrows on the diagram and centre on them, staying on the Relationships table.
function selectRelationship(rel) {
  const tab = activeTab;
  const shown = rel.arrows.map(edgeById).filter(e => e && !e.hidden);
  const ends = shown.map(edgeEnds).filter(Boolean);
  if (ends.length) {
    const xs = ends.flatMap(e => [e.x1, e.x2]), ys = ends.flatMap(e => [e.y1, e.y2]);
    const c = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    view = { x: scroller.clientWidth / 2 - c.x, y: scroller.clientHeight / 2 - c.y };
    applyView();
  }
  if (shown.length < rel.arrows.length) setStatus(`Some of ${rel.id}'s arrows are hidden`);
  setSelection(shown.map(e => e.id));
  if (activeTab !== tab) { activeTab = tab; renderDock(); }
}

// ---------- tables ----------
// A panel under the diagram, one tab per entity type. Selecting something on the diagram
// switches to its table and highlights its row; clicking an ID in a table selects it on the diagram.
const dockEl = $("dock"), tablesEl = $("tables"), tabsEl = $("tabs"), dockBtn = $("dock-toggle");
dockBtn.addEventListener("click", toggleDock);

function toggleDock() { return dockOpen ? closeDock() : openDock(); }

function closeDock() {
  dockOpen = false;
  tablesEl.hidden = tabsEl.hidden = true;
  dockEl.classList.remove("open");
  dockBtn.textContent = "▲ Tables";
  dockBtn.setAttribute("aria-expanded", "false");
}

async function openDock() {
  clearTimeout(saveTimer);
  if (dirty) await save(); // the tables are worked out from the saved file
  if (!(await loadTables())) return;
  dockOpen = true;
  tablesEl.hidden = tabsEl.hidden = false;
  dockEl.classList.add("open");
  dockBtn.textContent = "▼ Tables";
  dockBtn.setAttribute("aria-expanded", "true");
  renderDock();
  showSelectionInTables();
}

async function loadTables() {
  try {
    const r = await api("/api/tables");
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    tableData = data.tables;
  } catch (err) { setStatus("Could not load tables: " + err.message); return false; }
  rowOf = {};
  titleOf = {};
  for (const t of tableData) {
    titleOf[t.key] = Object.fromEntries(t.columns.map(c => [c.key, c.title]));
    for (const row of t.rows) rowOf[row.id] = row;
  }
  if (dockOpen) renderDock();
  render();
  return true;
}

// Switch to the table of the item selected last, and highlight every selected row in it.
function showSelectionInTables() {
  const item = itemById([...selection].at(-1));
  if (item && item.type !== activeTab && tableData.some(t => t.key === item.type)) {
    activeTab = item.type;
    renderDock();
  } else highlightRows();
}

function highlightRows() {
  tablesEl.querySelectorAll("tr.row-hl").forEach(r => r.classList.remove("row-hl"));
  let first = null;
  for (const id of selection) {
    const tr = tablesEl.querySelector(`tr[data-id="${id}"]`);
    if (tr) { tr.classList.add("row-hl"); first = first || tr; }
  }
  if (first) first.scrollIntoView({ block: "nearest" });
}

// Jump from a table to the item on the diagram.
function goTo(id) {
  const rel = relById(id);
  if (rel) { selectRelationship(rel); return; }
  const item = itemById(id);
  if (!item) return;
  if (item.hidden) setStatus(`${id} is hidden: tick "On diagram" in its table to draw it`);
  const ends = item.w ? null : edgeEnds(item);
  const c = item.w ? centre(item) : ends && { x: (ends.x1 + ends.x2) / 2, y: (ends.y1 + ends.y2) / 2 };
  if (c) { view = { x: scroller.clientWidth / 2 - c.x, y: scroller.clientHeight / 2 - c.y }; applyView(); }
  setSelection([id]);
}

const html = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};

// Column widths the user has dragged, remembered between visits ("tab:column" -> pixels).
const colWidths = (() => {
  try { return JSON.parse(localStorage.getItem("whiteboard-col-widths")) || {}; } catch { return {}; }
})();
let minColPx = 0;
// No column can be narrower than 10 characters of text plus its tick box and padding.
function minCol() {
  if (!minColPx) {
    const probe = html("span");
    probe.style.cssText = "position:absolute;visibility:hidden;width:10ch";
    tablesEl.append(probe);
    const w = probe.offsetWidth;
    probe.remove();
    if (w) minColPx = w + 50;
  }
  return minColPx || 130;
}
const defaultColWidth = (key) => (key === "description" || key === "effect" ? 300 : key === "name" ? 240 : key === "id" || key === "drawn" ? 110 : 190);

let editing = null;        // "id:property" of the table cell open for typing (a name, description or effect)
let rebuilding = false;    // true while the table is being redrawn, so a vanishing text box isn't treated as "finished"

function renderDock() {
  const idLink = (id) => {
    const b = html("button", id, "link");
    b.addEventListener("click", () => goTo(id));
    return b;
  };
  // Cells other than the name hold ids (possibly with a note like "(internal)") or plain text (the line style).
  const fill = (cell, key, value) => {
    if (key === "line") { cell.append(String(value ?? "")); return; }
    const parts = Array.isArray(value) ? value : value ? [value] : [];
    parts.forEach((part, i) => {
      if (i) cell.append(", ");
      const [id, ...note] = part.split(" ");
      cell.append(idLink(id));
      if (note.length) cell.append(" " + note.join(" "));
    });
  };

  tabsEl.replaceChildren(...tableData.map(t => {
    const b = html("button", `${t.title} (${t.rows.length})`, t.key === activeTab ? "active" : "");
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(t.key === activeTab));
    b.addEventListener("click", () => { activeTab = t.key; renderDock(); });
    return b;
  }));

  const t = tableData.find(x => x.key === activeTab) || tableData[0];
  if (!t) return;
  const keepScroll = lastTab === t.key ? tablesEl.scrollTop : 0; // a refresh must not jump back to the top
  const typing = document.activeElement && tablesEl.contains(document.activeElement) && document.activeElement.dataset.edit
    ? { from: document.activeElement.selectionStart, to: document.activeElement.selectionEnd }
    : null; // a name being typed must keep the cursor when the table redraws after a save
  lastTab = t.key;
  rebuilding = true;
  tablesEl.replaceChildren(html("h2", t.title));
  rebuilding = false;
  if (!t.rows.length) {
    tablesEl.append(html("p", t.key === "relationship"
      ? "No relationships yet. Select two or more arrows on the diagram (Shift+click), then click Add relationship."
      : `No ${t.title} drawn yet.`, "hint"));
    return;
  }
  const isRel = t.key === "relationship";
  tablesEl.append(html("p", isRel
    ? "Click a relationship's ID to select its arrows on the diagram. Double-click a description to edit it."
    : "Double-click a name, description or effect to edit it. Tick a box to show that property of that item on the diagram. Drag the right edge of a heading to resize the column.", "hint"));

  const items = t.rows.map(r => itemById(r.id)).filter(Boolean);
  // Arrows get one more column: whether the arrow is drawn on the diagram at all.
  const arrows = t.key === "control_action" || t.key === "feedback";
  // Relationships aren't drawn, so their table has no tick boxes; it has a Remove button instead.
  const specs = t.columns.map(c => ({ ...c, kind: "property" }))
    .concat(arrows ? [{ key: "drawn", title: "On diagram", kind: "drawn" }] : [])
    .concat(isRel ? [{ key: "remove", title: "", kind: "remove" }] : []);

  const headerTicks = [];
  const syncHeaderTicks = () => headerTicks.forEach(({ cb, spec }) => {
    const on = items.filter(i => (spec.kind === "drawn" ? !i.hidden : shownOf(i).includes(spec.key))).length;
    cb.checked = on === items.length;
    cb.indeterminate = on > 0 && on < items.length;
  });

  const wrap = html("div", undefined, "table-wrap"), table = html("table"), colgroup = html("colgroup");
  const thead = html("thead"), head = html("tr");
  const cols = specs.map(spec => {
    const col = html("col");
    col.style.width = Math.max(minCol(), colWidths[`${t.key}:${spec.key}`] || defaultColWidth(spec.key)) + "px";
    colgroup.append(col);
    return col;
  });
  const fitTable = () => { table.style.width = cols.reduce((sum, col) => sum + parseFloat(col.style.width), 0) + "px"; };

  specs.forEach((spec, k) => {
    // The header box ticks or clears the whole column.
    const th = html("th"), label = html("label");
    const cb = tickBox(spec.kind === "drawn" ? `Draw every ${t.title} on the diagram` : `Show ${spec.title} for every ${t.title} on the diagram`);
    cb.addEventListener("change", () => {
      if (spec.kind === "drawn") setHidden(items, !cb.checked);
      else setShown(items, spec.key, cb.checked);
      renderDock();
    });
    if (isRel) label.append(html("span", spec.title));
    else { headerTicks.push({ cb, spec }); label.append(cb, html("span", spec.title)); }
    const grip = html("div", undefined, "col-grip");
    grip.title = "Drag to resize";
    grip.addEventListener("mousedown", (ev) => {
      const startX = ev.clientX, startW = parseFloat(cols[k].style.width);
      const move = (e) => {
        const w = Math.max(minCol(), startW + e.clientX - startX);
        cols[k].style.width = w + "px";
        colWidths[`${t.key}:${spec.key}`] = w;
        fitTable();
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        try { localStorage.setItem("whiteboard-col-widths", JSON.stringify(colWidths)); } catch {}
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      ev.preventDefault();
      ev.stopPropagation();
    });
    th.append(label, grip);
    head.append(th);
  });
  thead.append(head);

  const body = html("tbody");
  for (const row of t.rows) {
    const tr = html("tr"), item = isRel ? relById(row.id) : itemById(row.id);
    tr.dataset.id = row.id;
    specs.forEach(spec => {
      const td = html("td"), cell = html("div", undefined, "cell"); // tick box on the left, value after it
      td.append(cell);
      if (isRel && item && spec.kind === "remove") {
        const b = html("button", "Remove");
        b.title = `Remove relationship ${row.id} (the arrows stay)`;
        b.addEventListener("click", () => removeRelationship(item));
        cell.append(b);
      } else if (isRel) {
        // no tick boxes: a relationship isn't drawn
      } else if (item && spec.kind === "drawn") {
        const cb = tickBox(`Draw ${row.id} on the diagram`);
        cb.checked = !item.hidden;
        cb.addEventListener("change", () => { setHidden([item], !cb.checked); syncHeaderTicks(); });
        cell.append(cb);
      } else if (item) {
        const cb = tickBox(`Show ${spec.title} of ${row.id} on the diagram`);
        cb.checked = shownOf(item).includes(spec.key);
        cb.addEventListener("change", () => { setShown([item], spec.key, cb.checked); syncHeaderTicks(); });
        cell.append(cb);
      }
      if (spec.kind === "property") {
        if (TEXT_KEYS.includes(spec.key) && item) cell.append(textCell(item, spec.key));
        else if (TEXT_KEYS.includes(spec.key)) cell.append(String(row[spec.key] ?? ""));
        else fill(cell, spec.key, row[spec.key]);
      }
      tr.append(td);
    });
    body.append(tr);
  }
  table.append(colgroup, thead, body);
  fitTable();
  wrap.append(table);
  tablesEl.append(wrap);
  syncHeaderTicks();
  tablesEl.scrollTop = keepScroll;
  highlightRows();

  const open = editing && tablesEl.querySelector(`input[data-edit="${editing}"]`);
  if (open && typing) { open.focus(); open.setSelectionRange(typing.from, typing.to); }
  else if (!open) editing = null; // the cell being edited is not in this table any more
}

// Text a person types, in the tables: every entity's name, a Control Action's description, a Feedback's effect.
const TEXT_KEYS = ["name", "description", "effect"];
const TEXT_LIMIT = { name: 200, description: 1000, effect: 1000 };
const TEXT_EMPTY = { name: "(no name)", description: "(no description)", effect: "(no effect)" };
const textOf = (item, key) => (key === "name" ? item.label : item[key]) || "";
function setText(item, key, value) { if (key === "name") item.label = value; else item[key] = value; }

// It is plain text until you double-click it; then it is a text box. (So a stray click can't change it.)
function textCell(item, key) {
  if (editing === `${item.id}:${key}`) return textInput(item, key);
  const text = textOf(item, key);
  const span = html("span", text || TEXT_EMPTY[key], "name-text" + (text ? "" : " empty"));
  span.title = text ? `${text}\n(double-click to edit)` : "Double-click to edit";
  span.addEventListener("dblclick", () => startEditing(item.id, key));
  return span;
}

function startEditing(id, key = "name") {
  editing = `${id}:${key}`;
  renderDock();
  const box = tablesEl.querySelector(`input[data-edit="${editing}"]`);
  if (box) { box.focus(); box.select(); }
}

// Typing changes the diagram at once. Enter keeps it, Esc puts the old text back.
function textInput(item, key) {
  const box = document.createElement("input");
  const original = textOf(item, key), mine = `${item.id}:${key}`;
  box.type = "text";
  box.className = "name-input";
  box.maxLength = TEXT_LIMIT[key];
  box.value = original;
  box.dataset.edit = mine;
  box.setAttribute("aria-label", `${key} of ${item.id}`);
  box.addEventListener("input", () => { setText(item, key, box.value.slice(0, TEXT_LIMIT[key])); render(); changed(); });
  box.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { setText(item, key, original); render(); changed(); }
    if (ev.key === "Enter" || ev.key === "Escape") box.blur();
  });
  box.addEventListener("blur", () => {
    if (rebuilding || editing !== mine) return;
    editing = null;
    renderDock();
  });
  return box;
}

// Open the tables on this item's row with its name ready to type over.
async function editNameInTable(id) {
  if (!itemById(id)) return;
  if (!dockOpen) await openDock();
  else if (dirty) { clearTimeout(saveTimer); await save(); } // a brand new item is only in the tables once saved
  if (!dockOpen) return;
  setSelection([id]); // switches to its table and highlights the row
  startEditing(id, "name");
}

function tickBox(description) {
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "tick";
  cb.title = description;
  cb.setAttribute("aria-label", description);
  return cb;
}

// Show or hide one property on the diagram for some items; kept in the table's column order.
// Draw or hide arrows on the diagram. A hidden arrow stays in the tables and keeps its links.
function setHidden(items, hide) {
  for (const item of items) item.hidden = hide;
  if (hide) setSelection([...selection].filter(id => !edgeById(id)?.hidden)); // it can't be selected if it can't be seen
  else render();
  changed();
}

function setShown(items, key, on) {
  for (const item of items) {
    const keys = new Set(shownOf(item));
    on ? keys.add(key) : keys.delete(key);
    // Keep the table's column order when we know it; otherwise (tables not loaded yet) just add or remove.
    item.shown = titleOf[item.type] ? Object.keys(titleOf[item.type]).filter(k => keys.has(k)) : [...keys];
  }
  render();
  changed();
}

// Drag the top edge of the panel to resize it.
$("dock-grip").addEventListener("mousedown", (ev) => {
  const startY = ev.clientY, startH = tablesEl.offsetHeight;
  const move = (e) => {
    tablesEl.style.height = Math.max(100, Math.min(window.innerHeight - 260, startH + startY - e.clientY)) + "px";
  };
  const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
  ev.preventDefault();
});

load();
