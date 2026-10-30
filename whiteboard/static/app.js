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
const board = $("board"), scroller = $("scroller"), statusEl = $("status");
const styleEl = $("style"), deleteBtn = $("delete"), nameEl = $("name");
const colourBtn = $("colour-btn"), swatchEl = $("colour-swatch"), paletteEl = $("palette"), themeBtn = $("theme");

let diagram = { nodes: [], edges: [] };
let tool = "select";
let selection = new Set();   // ids of selected rectangles and arrows
let view = { x: 0, y: 0 };   // where the world origin sits on screen (panning)
let drag = null;             // current mouse gesture
let spaceDown = false;
let saveTimer = null;
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
    const v = row ? row[k] : undefined;
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
      ...attrs, class: "edge-line", style: `stroke:${paint(e.colour)}`, "stroke-width": 2.5,
      "stroke-dasharray": e.style === "dashed" ? "9 6" : "none", "marker-end": marker(e.colour),
    }, g);
    const shown = shownOf(e), first = [shown.includes("id") ? e.id : "", shown.includes("name") ? e.label : ""].filter(Boolean).join(" ");
    const lines = (first ? [{ text: first, cls: "" }] : []).concat(extraLines(e).map(text => ({ text, cls: " extra" })));
    const top = (ends.y1 + ends.y2) / 2 - 6 - (lines.length - 1) * 14;
    lines.forEach((ln, i) => {
      el("text", { class: "edge-label" + ln.cls, x: (ends.x1 + ends.x2) / 2, y: top + i * 14 }, g).textContent = ln.text;
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
  const item = selection.size === 1 ? itemById([...selection][0]) : null;
  if (item && item.style) styleEl.value = item.style;
  refreshSwatch();
  // The Name box edits the one selected item; with none or several selected it is off.
  nameEl.disabled = !item;
  nameEl.value = item ? item.label : "";
  render();
  if (dockOpen) showSelectionInTables();
}

// Type a name for the selected item; the diagram updates as you type.
nameEl.addEventListener("input", () => {
  const item = selection.size === 1 ? itemById([...selection][0]) : null;
  if (item) { item.label = nameEl.value.slice(0, 200); render(); changed(); }
});
nameEl.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === "Escape") nameEl.blur(); });
function editName() { if (!nameEl.disabled) { nameEl.focus(); nameEl.select(); } }
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
    if (r.ok) { dirty = false; setStatus("Saved"); loadTables(); }
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
  setSelection([]);
  changed();
}
deleteBtn.addEventListener("click", deleteSelected);

const KEYS = { s: "select", h: "pan", c: "controller", p: "controlled_process", a: "control_action", f: "feedback" };
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !paletteEl.hidden) { closePalette(); return; }
  if (ev.target.matches("input, select")) return;
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "a") {
    setSelection([...diagram.nodes, ...diagram.edges].map(i => i.id));
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
  if (document.activeElement === nameEl) nameEl.blur(); // we cancel the default below, so release the box ourselves
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
      fill: "none", style: `stroke:${paint(pen[tool])}`, "stroke-dasharray": "4 4", "stroke-width": 2,
    }, ov);
  } else if (drag.mode === "connect") {
    const over = hit(p), s = anchorPoint(drag.from, drag.anchor);
    const target = over && over !== drag.from ? over : null;
    drag.hover = target ? target.id : null;
    render();
    ov.replaceChildren();
    el("line", {
      x1: s.x, y1: s.y, x2: p.x, y2: p.y, style: `stroke:${paint(pen[tool])}`, "stroke-width": 2.5,
      "stroke-dasharray": styleEl.value === "dashed" ? "9 6" : "none",
    }, ov);
    el("circle", { cx: s.x, cy: s.y, r: 5, style: `fill:${paint(pen[tool])}` }, ov);
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
    editName();
  } else if (d.mode === "connect") {
    const to = hit(p);
    if (!to || to === d.from) {
      setStatus("Drop the arrow on a different rectangle");
      render();
      return;
    }
    const e = {
      id: newId(tool), type: tool, source: d.from.id, target: to.id,
      style: styleEl.value, label: "", colour: pen[tool], shown: [...DEFAULT_SHOWN],
      source_anchor: d.anchor, target_anchor: snapAnchor(to, p),
    };
    diagram.edges.push(e);
    setSelection([e.id]);
    changed();
    editName();
  }
});

// Double-click an item to rename it.
board.addEventListener("dblclick", (ev) => { if (tool === "select") editName(); });

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
    const r = await fetch("/api/tables");
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
  const item = itemById(id);
  if (!item) return;
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

function renderDock() {
  const idLink = (id) => {
    const b = html("button", id, "link");
    b.addEventListener("click", () => goTo(id));
    return b;
  };
  // Text cells (Name, Line) are shown as typed; everything else holds ids, possibly with a note like "(internal)".
  const fill = (td, key, value) => {
    if (key === "name" || key === "line") { td.textContent = value; return; }
    const parts = Array.isArray(value) ? value : value ? [value] : [];
    parts.forEach((part, i) => {
      if (i) td.append(", ");
      const [id, ...note] = part.split(" ");
      td.append(idLink(id));
      if (note.length) td.append(" " + note.join(" "));
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
  lastTab = t.key;
  tablesEl.replaceChildren(html("h2", t.title));
  if (!t.rows.length) {
    tablesEl.append(html("p", `No ${t.title} drawn yet.`, "hint"));
    return;
  }
  tablesEl.append(html("p", "Tick a box to show that property of that item on the diagram.", "hint"));

  const items = t.rows.map(r => itemById(r.id)).filter(Boolean);
  const headerTicks = [];
  const syncHeaderTicks = () => headerTicks.forEach(({ cb, key }) => {
    const on = items.filter(i => shownOf(i).includes(key)).length;
    cb.checked = on === items.length;
    cb.indeterminate = on > 0 && on < items.length;
  });

  const wrap = html("div", undefined, "table-wrap"), table = html("table"), thead = html("thead"), head = html("tr");
  t.columns.forEach(c => {
    // The header box ticks or clears the whole column.
    const th = html("th"), label = html("label"), cb = tickBox(`Show ${c.title} for every ${t.title} on the diagram`);
    cb.addEventListener("change", () => { setShown(items, c.key, cb.checked); renderDock(); });
    headerTicks.push({ cb, key: c.key });
    label.append(cb, c.title);
    th.append(label);
    head.append(th);
  });
  thead.append(head);
  const body = html("tbody");
  for (const row of t.rows) {
    const tr = html("tr"), item = itemById(row.id);
    tr.dataset.id = row.id;
    t.columns.forEach(c => {
      const td = html("td");
      if (item) {
        const cb = tickBox(`Show ${c.title} of ${row.id} on the diagram`);
        cb.checked = shownOf(item).includes(c.key);
        cb.addEventListener("change", () => { setShown([item], c.key, cb.checked); syncHeaderTicks(); });
        td.append(cb);
      }
      fill(td, c.key, row[c.key]);
      tr.append(td);
    });
    body.append(tr);
  }
  table.append(thead, body);
  wrap.append(table);
  tablesEl.append(wrap);
  syncHeaderTicks();
  tablesEl.scrollTop = keepScroll;
  highlightRows();
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
function setShown(items, key, on) {
  for (const item of items) {
    const keys = new Set(shownOf(item));
    on ? keys.add(key) : keys.delete(key);
    item.shown = Object.keys(titleOf[item.type]).filter(k => keys.has(k));
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
