"use strict";

const NS = "http://www.w3.org/2000/svg";
const MIN_SIZE = 40;
const HOME_PAD = 60;         // gap left above/left of the diagram by the Home button
const NODE_TOOLS = ["controller", "controlled_process"];
const EDGE_TOOLS = ["control_action", "feedback"];
const TYPE_NAMES = {
  controller: "Controller", control_algorithm: "Control Algorithm", process_model: "Process Model",
  controlled_process: "Controlled Process", control_action: "Control Action", feedback: "Feedback",
};
// Every item's unique id is its type's prefix and a number: C1, CA1, PM1, CP1, A1, F1.
const ID_PREFIX = {
  controller: "C", control_algorithm: "CA", process_model: "PM",
  controlled_process: "CP", control_action: "A", feedback: "F",
};
const CHILD_TYPES = ["control_algorithm", "process_model"];   // drawn inside a Controller, right half
const CTRL_MIN = { w: 360, h: 140 };                          // a Controller never gets smaller than this
const DEFAULT_SIZE = { controller: { w: 360, h: 140 }, controlled_process: { w: 360, h: 100 } };

const $ = (id) => document.getElementById(id);
const board = $("board"), scroller = $("scroller"), statusEl = $("status");
const colourEl = $("colour"), styleEl = $("style"), deleteBtn = $("delete");

let diagram = { nodes: [], edges: [] };
let tool = "select";
let selection = new Set();   // ids of selected rectangles and arrows
let view = { x: 0, y: 0 };   // where the world origin sits on screen (panning)
let drag = null;             // current mouse gesture
let spaceDown = false;
let saveTimer = null;
let dirty = false;           // changes not yet saved
let inTables = false;

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
  for (const i of diagram.nodes.concat(diagram.edges)) {
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

// Older files have no anchors: start each arrow where the line between centres leaves the rectangle.
function fillMissingAnchors() {
  for (const e of diagram.edges) {
    const a = nodeById(e.source), b = nodeById(e.target);
    if (!a || !b) continue;
    const ca = centre(a), cb = centre(b), len = Math.hypot(cb.x - ca.x, cb.y - ca.y) || 1;
    const d = { x: (cb.x - ca.x) / len, y: (cb.y - ca.y) / len };
    if (!e.source_anchor) e.source_anchor = snapAnchor(a, { x: ca.x + d.x * exitDistance(a, ca, d), y: ca.y + d.y * exitDistance(a, ca, d) });
    if (!e.target_anchor) e.target_anchor = snapAnchor(b, { x: cb.x - d.x * exitDistance(b, cb, { x: -d.x, y: -d.y }), y: cb.y - d.y * exitDistance(b, cb, { x: -d.x, y: -d.y }) });
  }
}

function edgeEnds(e) {
  const a = nodeById(e.source), b = nodeById(e.target);
  if (!a || !b) return null;
  const p1 = anchorPoint(a, e.source_anchor), p2 = anchorPoint(b, e.target_anchor);
  if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 2) return null;
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
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
  const id = "arrow-" + colour.slice(1);
  if (!document.getElementById(id)) {
    const m = el("marker", {
      id, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 9, markerHeight: 9,
      orient: "auto", markerUnits: "userSpaceOnUse",
    }, $("defs"));
    el("path", { d: "M0,0 L10,5 L0,10 z", fill: colour }, m);
  }
  return `url(#${id})`;
}

function applyView() {
  $("world").setAttribute("transform", `translate(${view.x},${view.y})`);
  board.style.backgroundPosition = `${view.x}px ${view.y}px`;
}

function drawNode(n) {
  const child = Boolean(n.parent), hover = drag?.hover === n.id;
  const g = el("g", {
    class: "node" + (child ? " child" : "") + (selection.has(n.id) ? " selected" : "") + (hover ? " target-ok" : ""),
    "data-id": n.id,
  }, $("nodes"));
  el("rect", {
    class: "node-rect", x: n.x, y: n.y, width: n.w, height: n.h, rx: child ? 4 : 6,
    fill: n.colour, stroke: n.colour,
  }, g);
  // Ring round the rectangle an arrow will connect to if released now.
  if (hover) el("rect", { class: "target-ring", x: n.x - 6, y: n.y - 6, width: n.w + 12, height: n.h + 12, rx: 10 }, g);
  el("text", { class: "node-type", x: n.x + 7, y: n.y + 14 }, g).textContent = n.id;
  // A Controller keeps its own label in the left half, clear of the inner boxes.
  const cx = n.type === "controller" ? n.x + n.w / 4 : n.x + n.w / 2;
  el("text", { class: "node-label" + (child ? " small" : ""), x: cx, y: n.y + n.h / 2 + 5 }, g).textContent = n.label;
}

function render() {
  layoutChildren();
  $("nodes").replaceChildren();
  $("edges").replaceChildren();
  $("handles").replaceChildren();

  for (const e of diagram.edges) {
    const ends = edgeEnds(e);
    if (!ends) continue;
    const g = el("g", { class: "edge" + (selection.has(e.id) ? " selected" : ""), "data-id": e.id }, $("edges"));
    const attrs = { x1: ends.x1, y1: ends.y1, x2: ends.x2, y2: ends.y2 };
    el("line", { ...attrs, class: "edge-hit" }, g);
    el("line", {
      ...attrs, class: "edge-line", stroke: e.colour, "stroke-width": 2.5,
      "stroke-dasharray": e.style === "dashed" ? "9 6" : "none", "marker-end": marker(e.colour),
    }, g);
    const t = el("text", {
      class: "edge-label", x: (ends.x1 + ends.x2) / 2, y: (ends.y1 + ends.y2) / 2 - 6,
    }, g);
    t.textContent = [e.id, e.label].filter(Boolean).join(" ");
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
    const e = edgeById(id), ends = e && edgeEnds(e);
    if (!ends) continue;
    for (const [end, x, y] of [["source", ends.x1, ends.y1], ["target", ends.x2, ends.y2]]) {
      el("circle", { class: "anchor-handle", cx: x, cy: y, r: 7, "data-end": end, "data-edge": e.id }, $("handles"));
    }
  }
  deleteBtn.disabled = selection.size === 0;
}

function setSelection(ids) {
  selection = new Set(ids);
  if (selection.size === 1) {
    const item = itemById([...selection][0]);
    if (item) {
      colourEl.value = item.colour;
      if (item.style) styleEl.value = item.style;
    }
  }
  render();
}
function toggle(id) {
  const s = new Set(selection);
  s.has(id) ? s.delete(id) : s.add(id);
  setSelection(s);
}

// ---------- saving ----------
function setStatus(text) { statusEl.textContent = text; }
function changed() {
  dirty = true;
  setStatus("Unsaved…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}
async function save() {
  try {
    const r = await fetch("/api/diagram", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(diagram),
    });
    if (r.ok) { dirty = false; setStatus("Saved"); }
    else setStatus("Not saved: " + ((await r.json()).error || r.status));
  } catch { setStatus("Not saved: server unreachable"); }
}
async function load() {
  try {
    const r = await fetch("/api/diagram");
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    diagram = data;
    layoutChildren();
    fillMissingAnchors();
    setStatus(diagram.nodes.length ? "Loaded" : "New diagram");
  } catch (err) { setStatus("Could not load: " + err.message); }
  goHome();
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
  document.querySelectorAll(".tool").forEach(b => b.classList.toggle("active", b.dataset.tool === t));
  updateCursor();
}
function updateCursor() {
  board.classList.toggle("drawing", NODE_TOOLS.includes(tool) || EDGE_TOOLS.includes(tool));
  board.classList.toggle("pan", tool === "pan" || spaceDown);
  board.classList.toggle("panning", drag?.mode === "pan");
}
document.querySelectorAll(".tool").forEach(b => b.addEventListener("click", () => {
  showDiagram();
  setTool(b.dataset.tool);
}));

colourEl.addEventListener("input", () => {
  const items = [...selection].map(itemById).filter(Boolean);
  if (items.length) { items.forEach(i => { i.colour = colourEl.value; }); render(); changed(); }
});
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
  setSelection([]);
  changed();
}
deleteBtn.addEventListener("click", deleteSelected);

const KEYS = { s: "select", h: "pan", c: "controller", p: "controlled_process", a: "control_action", f: "feedback" };
document.addEventListener("keydown", (ev) => {
  if (ev.target.matches("input, select")) return;
  if (inTables) { if (ev.key === "Escape") showDiagram(); return; }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "a") {
    setSelection([...diagram.nodes, ...diagram.edges].map(i => i.id));
    return ev.preventDefault();
  }
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (ev.key === " ") { spaceDown = true; updateCursor(); ev.preventDefault(); }
  else if (ev.key === "Delete" || ev.key === "Backspace") { deleteSelected(); ev.preventDefault(); }
  else if (ev.key === "Escape") { drag = null; $("overlay").replaceChildren(); setSelection([]); setTool("select"); }
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
  const p = pointer(ev), n = hit(p), edgeEl = ev.target.closest(".edge");
  drag = null;

  if (ev.button === 1 || tool === "pan" || spaceDown) {
    drag = { mode: "pan", sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y };
  } else if (tool === "select") {
    if (ev.target.classList.contains("handle")) {
      drag = { mode: "resize", node: nodeById([...selection][0]), moved: false };
    } else if (ev.target.classList.contains("anchor-handle")) {
      drag = { mode: "anchor", edge: edgeById(ev.target.dataset.edge), end: ev.target.dataset.end, moved: false };
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
        drag = { mode: "anchor", edge: e, end: nearEnd[0], moved: false };
      } else isModifier(ev) ? toggle(e.id) : setSelection([e.id]);
    } else {
      const additive = isModifier(ev);
      drag = { mode: "marquee", start: p, base: additive ? new Set(selection) : new Set() };
      if (!additive) setSelection([]);
    }
  } else if (NODE_TOOLS.includes(tool)) {
    drag = { mode: "create", start: p };
  } else if (EDGE_TOOLS.includes(tool) && n) {
    drag = { mode: "connect", from: n, anchor: snapAnchor(n, p) };
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
    const ends = edgeEnds(e);
    if (ends && inside(ends.x1, ends.y1) && inside(ends.x2, ends.y2)) ids.push(e.id);
  }
  return ids;
}

window.addEventListener("mousemove", (ev) => {
  if (!drag) return;
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
  } else if (drag.mode === "anchor") {
    // Slide the end along its rectangle's border, or drop it on another rectangle to re-attach it.
    const e = drag.edge, otherId = drag.end === "source" ? e.target : e.source;
    let n = hit(p);
    if (!n || n.id === otherId) n = nodeById(e[drag.end]);
    e[drag.end] = n.id;
    e[drag.end + "_anchor"] = snapAnchor(n, p);
    drag.moved = true;
    drag.hover = n.id;
    render();
    ov.replaceChildren();
    const a = anchorPoint(n, e[drag.end + "_anchor"]);
    el("circle", { class: "attach-dot", cx: a.x, cy: a.y, r: 5 }, ov);
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
      fill: "none", stroke: colourEl.value, "stroke-dasharray": "4 4", "stroke-width": 2,
    }, ov);
  } else if (drag.mode === "connect") {
    const over = hit(p), s = anchorPoint(drag.from, drag.anchor);
    const target = over && over !== drag.from ? over : null;
    drag.hover = target ? target.id : null;
    render();
    ov.replaceChildren();
    el("line", {
      x1: s.x, y1: s.y, x2: p.x, y2: p.y, stroke: colourEl.value, "stroke-width": 2.5,
      "stroke-dasharray": styleEl.value === "dashed" ? "9 6" : "none",
    }, ov);
    el("circle", { cx: s.x, cy: s.y, r: 5, fill: colourEl.value }, ov);
    if (target) {
      const a = anchorPoint(target, snapAnchor(target, p));
      el("circle", { class: "attach-dot", cx: a.x, cy: a.y, r: 5 }, ov);
    }
  }
});

window.addEventListener("mouseup", (ev) => {
  if (!drag) return;
  const p = pointer(ev), d = drag;
  drag = null;
  $("overlay").replaceChildren();
  updateCursor();

  if (d.mode === "move" || d.mode === "resize" || d.mode === "anchor") {
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
      label: TYPE_NAMES[tool], colour: colourEl.value,
    };
    diagram.nodes.push(n);
    if (tool === "controller") { // every Controller is born with its two inner boxes
      for (const type of CHILD_TYPES) {
        diagram.nodes.push({
          id: newId(type), type, parent: n.id, x: n.x, y: n.y, w: MIN_SIZE, h: MIN_SIZE,
          label: TYPE_NAMES[type], colour: n.colour,
        });
      }
    }
    setTool("select");
    setSelection([n.id]);
    changed();
  } else if (d.mode === "connect") {
    const to = hit(p);
    if (!to || to === d.from) {
      setStatus("Drop the arrow on a different rectangle");
      render();
      return;
    }
    const e = {
      id: newId(tool), type: tool, source: d.from.id, target: to.id,
      style: styleEl.value, label: "", colour: colourEl.value,
      source_anchor: d.anchor, target_anchor: snapAnchor(to, p),
    };
    diagram.edges.push(e);
    setSelection([e.id]);
    changed();
  }
});

board.addEventListener("dblclick", (ev) => {
  if (tool !== "select") return;
  const n = hit(pointer(ev)), edgeEl = ev.target.closest(".edge");
  const item = n || (edgeEl && edgeById(edgeEl.dataset.id));
  if (!item) return;
  const text = prompt("Label", item.label);
  if (text !== null) { item.label = text.slice(0, 200); render(); changed(); }
});

// ---------- tables ----------
const tablesEl = $("tables"), viewBtn = $("view-toggle");
viewBtn.addEventListener("click", () => (inTables ? showDiagram() : showTables()));

function showDiagram() {
  inTables = false;
  tablesEl.hidden = true;
  viewBtn.textContent = "Tables";
}

async function showTables() {
  clearTimeout(saveTimer);
  if (dirty) await save(); // the tables are worked out from the saved file
  try {
    const r = await fetch("/api/tables");
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    renderTables(data.tables);
  } catch (err) { setStatus("Could not load tables: " + err.message); return; }
  inTables = true;
  tablesEl.hidden = false;
  viewBtn.textContent = "Diagram";
}

// Jump from a table to the item on the diagram.
function goTo(id) {
  showDiagram();
  const item = itemById(id);
  if (!item) return;
  const ends = item.w ? null : edgeEnds(item);
  const c = item.w ? centre(item) : ends && { x: (ends.x1 + ends.x2) / 2, y: (ends.y1 + ends.y2) / 2 };
  if (c) { view = { x: scroller.clientWidth / 2 - c.x, y: scroller.clientHeight / 2 - c.y }; applyView(); }
  setSelection([id]);
}

function renderTables(tables) {
  const h = (tag, text, cls) => {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };
  const idLink = (id) => {
    const b = h("button", id, "link");
    b.addEventListener("click", () => goTo(id));
    return b;
  };
  // Text cells (Name, Line) are shown as typed; everything else holds ids, possibly with a note like "(internal)".
  const fill = (td, key, value) => {
    const parts = Array.isArray(value) ? value : value ? [value] : [];
    if (key === "name" || key === "line") { td.textContent = value; return; }
    parts.forEach((part, i) => {
      if (i) td.append(", ");
      const [id, ...note] = part.split(" ");
      td.append(idLink(id));
      if (note.length) td.append(" " + note.join(" "));
    });
  };

  tablesEl.replaceChildren(h("p", "Click an ID to find it on the diagram.", "hint"));
  for (const t of tables) {
    const section = h("section"), wrap = h("div", undefined, "table-wrap");
    section.append(h("h2", `${t.title} (${t.rows.length})`));
    if (!t.rows.length) section.append(h("p", "None drawn yet.", "hint"));
    else {
      const table = h("table"), thead = h("thead"), head = h("tr");
      t.columns.forEach(c => head.append(h("th", c.title)));
      thead.append(head);
      table.append(thead);
      const body = h("tbody");
      for (const row of t.rows) {
        const tr = h("tr");
        t.columns.forEach(c => { const td = h("td"); fill(td, c.key, row[c.key]); tr.append(td); });
        body.append(tr);
      }
      table.append(body);
      wrap.append(table);
      section.append(wrap);
    }
    tablesEl.append(section);
  }
}

load();
