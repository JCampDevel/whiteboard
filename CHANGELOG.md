# Changelog

Every change to the code, tests or docs gets an entry here, newest first.

---

## 0.3.1, 2026-10-29: ID prefixes changed

**Changed**
- Unique ID prefixes are now: **C** Controller, **CA** Control Algorithm, **PM** Process Model, **CP** Controlled Process, **A** Control Action, **F** Feedback (was C, ALG, PM, CP, CA, FB). So a Control Action is now A1 and a Control Algorithm is CA1.
- Files saved with the 0.3.0 prefixes are renamed when opened (ALG1 -> CA1, CA1 -> A1, FB1 -> F1) with arrow ends and inner-box parents following. Because an old arrow id like CA1 equals a new box id, the rename looks up references through boxes only, so they cannot be mixed up.

**Docs**: README and docs/DESIGN.md.

**Tests**: 49 (was 48): new test that a 0.3.0-prefix file is renamed without mixing up CA1. Existing tests moved to the new prefixes.

**Not verified**: the browser code has still not been run; the only change there is the prefix table in `app.js`.

---

## 0.3.0, 2026-10-29: Inner boxes, unique IDs and entity tables

**Added**
- **Control Algorithm** and **Process Model** boxes. Every Controller is created with one of each inside it, on its right half (Control Algorithm above, Process Model below). Arrows can be drawn to and from them and edited like any other arrow.
- **Unique IDs** for all six entity types: C1, ALG1, PM1, CP1, CA1, FB1. Shown on every box and before the label on arrows. The model refuses an ID that doesn't match its type or is used twice.
- **Tables** view (toolbar button; Esc returns): one table per entity type with the entity's ID and its linked entities (Controller: Control Algorithm, Process Model, outgoing control actions, incoming feedback; and so on, see the README). Click any ID to jump to it on the diagram.
- `GET /api/tables`, and `model.tables`, `model.migrate`.

**Changed**
- Arrows may now end on any of the four box types (before: Controller or Controlled Process).
- A Controller's own label sits in the left half; minimum Controller size is 360 x 140. Inner boxes follow the Controller, cannot be moved or deleted alone (grabbing one moves the Controller), and are deleted with it.
- New arrows start with no label (they show their ID); new rectangles still start labelled with their type name. Box captions now show the ID instead of the type name.
- Older files are upgraded on open: n1 -> C1, e1 -> CA1 and so on, with inner boxes added to each Controller. The file on disk is rewritten the next time you edit.

**Docs**: README (entities, IDs, tables), docs/DESIGN.md (requirements 7 to 9, IDs, inner boxes, tables, migration).

**Tests**: 48 (was 26), all passing: ID/type matching, inner-box rules (one of each, Controller parent only), arrows to inner boxes, migration (renaming, references, idempotent, no collisions, garbage left for validation), every table's columns and links, ordering, empty diagram, `/api/tables`, upgrade-on-open. Existing tests were updated for the new ID format.

**Not verified**
- The browser code has still never been run (no Node; Firefox won't start headless here). Check by hand: a new Controller shows both inner boxes in its right half; resizing and moving the Controller keeps them there; drawing an arrow to an inner box highlights that box rather than the Controller; Tables opens, shows rows for what you drew, and clicking an ID jumps to it; opening a v0.2 file.
- Decisions I made that you may want different: a Controller's row counts arrows on its inner boxes; inner boxes can't be moved separately; IDs can't be edited.

---

## 0.2.1, 2026-10-29: Easier arrow editing, clear connection highlight

**Changed**
- Arrow-end handles now appear on every selected arrow (not just a lone one), are larger, and each end can be dragged on its own to a new point on the same rectangle or onto a different rectangle.
- Pressing just outside an arrow's end and dragging edits that end without selecting the arrow first.
- While drawing an arrow or dragging an end, the rectangle it will connect to gets a ring and tint, and a dot marks the exact border point. The highlight now also works when re-attaching an existing arrow (before it only existed for new arrows, and was a thin outline).
- Selected arrows are drawn thicker.

**Docs**: README and docs/DESIGN.md.

**Tests**: no new automated tests; this is all in the browser code, which has no test harness here. Model and server tests still pass (26).

**Not verified**: not run in a browser (no Node, and Firefox won't start headless in this sandbox). Check: select an arrow and drag each end to a new spot and to another rectangle; the ring appears on the right rectangle and disappears on release; releasing over empty space leaves the arrow as it was.

---

## 0.2.0, 2026-10-29: Pan by dragging, multi-select, choose where arrows attach

**Added**
- Pan by dragging the canvas: Pan tool (H), Space+drag, middle mouse button, or the wheel/trackpad. Home button returns to the diagram.
- Multi-select: Shift/Ctrl+click toggles, drag across empty space to box-select (Shift/Ctrl adds), Ctrl+A selects all. Dragging any selected rectangle moves the group. Colour, Full/Dashed and Delete apply to the whole selection.
- Arrows attach where you press and release on the rectangles (snapped to the nearest border point) and stay at that relative position when rectangles move or resize. Select an arrow and drag a round end handle to slide it round the border or re-attach it to another rectangle.
- Model: optional `source_anchor` / `target_anchor` on edges (`[x, y]` in 0 to 1), validated.

**Changed**
- The canvas is now unbounded with a view offset instead of a scrolling box, so there are no scrollbars and rectangles can sit at negative coordinates (the 0.1.0 "grow with a margin" rule and the clamp at 0 are gone).
- The old automatic side-by-side offset for opposite arrows is gone, because you now place the ends yourself. Files from 0.1.0 load with anchors computed from the old centre-to-centre line, so they look about the same.

**Docs**: README and docs/DESIGN.md updated (requirements 5 and 6, panning, selection, anchors).

**Tests**: 26 (was 23): anchors round-trip and are optional, bad anchors rejected, negative positions allowed.

**Not verified**
- Still none of the browser code has been run: Node is not installed and Firefox would not start headless in this sandbox. Everything in `app.js` (panning, box select, group drag, arrow end handles, 0.1.0-file migration) needs trying by hand. Possible rough edges to look for: a plain click on one rectangle of a selected group, dragging an arrow end onto a rectangle, and the Esc key.

---

## 0.1.0, 2026-10-29: First version

**Added**
- Browser whiteboard (`python3 -m whiteboard`): Controller and Controlled Process rectangles; Control Action and Feedback arrows, full or dashed; per-item colour; drag to move, corner handle to resize, double-click to label, Delete to remove.
- Arrows are created by dragging from one rectangle to another and always stay attached to both; deleting a rectangle removes its arrows.
- Board grows with the diagram (furthest edge + 300 px, never smaller than the window).
- Autosave to a JSON file; local server on 127.0.0.1 only.

**Docs**: README, docs/DESIGN.md.

**Tests**: 23 unittest tests covering model validation (types, ids, colours, sizes, dangling/self/arrow-to-arrow edges), save/load, and the server (routes, validation, size limit, corrupt file). Temporary files and a random localhost port only.

**Not verified**
- The browser code (`app.js`) has not been run or tested: Node is not installed here and I could not open a browser. Syntax errors or drawing bugs are possible. First thing to do: run it and try each tool.
