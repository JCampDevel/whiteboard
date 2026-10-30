# Changelog

Every change to the code, tests or docs gets an entry here, newest first.

---

## 0.12.0, 2026-10-30: Real Save as / Open, a proper Open prompt, steady toolbar

Asked: when saving, choose the file name and folder; when opening, a prompt saying unsaved changes will be lost, with Open (opens it) and Cancel (cancels); and the toolbar shouldn't jump to two lines and back when saving.

**Added**
- **The app's own Save and Open dialog**, in every browser: browse folders (Up, Home folder), see the diagram files there, type or pick a name. Before, only Chrome and Edge let you choose where to save; Firefox put the file in Downloads with a fixed name.
- **Open asks first**: "Open X? Any unsaved changes will be lost." with **Open** and **Cancel**. Cancel cancels everything.
- **Save as asks before replacing** an existing file (Replace / Cancel).
- **The file you are working on** is shown in the toolbar and the browser tab.
- Server: `GET /api/file`, `GET /api/browse`, `POST /api/save-as`, `POST /api/open`.
- **Server safety**: requests must be addressed to 127.0.0.1 / localhost (stops DNS rebinding) and API requests must carry an `X-Whiteboard` header (stops other web pages in the same browser from using the server). Needed now that the server can list folders and write files.

**Changed**
- **Save as and Open switch the file being worked on**, like a desktop app. Before, Save as only saved a copy, and Open *copied the opened file over the current one* (`diagram.json`), which lost the diagram you had been working on if you hadn't saved a copy. Now opening leaves the previous file untouched.
- **The toolbar no longer changes length**: the status and file name share a space that shrinks (long messages end in "…", full text on hover); the Theme button has a fixed width; **Unhide arrows (n)** is always shown and greyed out at 0, instead of appearing and disappearing.
- Removed: the browser's own file picker and download for Open / Save as.
- Requirement R16 rewritten.

**Docs**: REQUIREMENTS.md (R16), DESIGN.md (Save as / Open, server safety, toolbar), README (Saving and opening), GETTING_STARTED.md (where work is saved, one more troubleshooting row).

**Tests**: 85 (was 74). New: the API refuses requests without the header and requests for another host name; the current file; browsing (folders and `.json` files only, hidden ones left out, sorted; errors for missing, relative and non-folder paths); Save as (writes, adds `.json`, switches autosave to the new file and leaves the old one, asks before replacing, refuses bad names, folders and diagrams); Open (switches to the file, upgrades an old file, refuses bad / broken / missing files and changes nothing). Server tests now share a base class instead of re-running each other.

**Not verified**: the dialogs and toolbar are browser code and have not been run. Check: Save as into another folder and keep drawing (the toolbar name changes and the new file updates); Save as over an existing file (asks); Open then Cancel (nothing changes); Open then Open; Open a non-diagram (refused, reason shown); Esc in each dialog; the toolbar at a narrow window width while the status changes.

---

## 0.11.1, 2026-10-30: Getting started guide

**Docs**
- New `GETTING_STARTED.md`: what you need, cloning (SSH or HTTPS), starting the app, a first diagram in four steps, where work is saved, options, updating with `git pull`, running the tests, and fixes for common problems. Linked from the top of the README.
- Checked against the app: the `--help` output and the "No module named whiteboard" message when started from the wrong folder are as the guide describes. Only Python 3.14 has actually been used; the guide says 3.8 or newer should work, which is from reading the code, not from trying it.

No code changes.

---

## 0.11.0, 2026-10-30: Save as and Open, labelled JSON files

**Added**
- **Save as…** (Ctrl+S) saves a copy of the diagram to a JSON file: through the browser's save dialog in Chrome and Edge, otherwise as a download.
- **Open…** (Ctrl+O) opens a diagram from a JSON file, replacing the one on screen after asking. The server checks it first; a file from an older version is upgraded, and anything that isn't a valid diagram is refused with the reason and changes nothing.
- Saved files now begin with `"format": "whiteboard-diagram"` and `"format_version": 1`, so a file says what it is. Files without them (all earlier versions) still open. A file of a different format, or from a newer format version, is refused with a clear message.

**Changed**
- Saving through the page now also upgrades an older-version diagram (needed for Open…; no effect on current diagrams).
- Requirement R16 rewritten (human-readable format, save a copy, open a file).

**Unchanged**: autosave still writes to the file the app was started with, as indented JSON. Opening a file copies its diagram into that file; it does not switch which file is autosaved to.

**Docs**: REQUIREMENTS.md (R16), DESIGN.md (file format, Save as / Open), README (new Saving and opening section).

**Tests**: 74 (was 69): the saved file is labelled and indented one field per line and reads back the same; unlabelled files still open; other formats and newer versions are refused; an older file opened through the page is upgraded; opening a non-diagram leaves the working file untouched.

**Not verified**: the two buttons and shortcuts are browser code and have not been run. Check Save as… in your browser (dialog or download), Open… with a saved copy, with an old diagram.json, and with some other JSON file (should be refused, diagram unchanged).

---

## 0.10.0, 2026-10-30: Arrows that work like other drawing tools

Asked: the arrows aren't very usable; make them work like arrows in other drawing tools. Modelled on draw.io / Visio / Lucidchart.

**Added**
- **Connection points.** Hovering a box shows three points on each side; the one you would snap to fills in. **Drag out of a point to draw an arrow** without picking an arrow tool first (it draws the kind last picked in the toolbar, Control Action at first).
- **Ends that follow their box** (floating, the default when you drop an end in the middle of a box). Such an end leaves from the side facing the other box, avoids a side whose way out is blocked, re-chooses as you move boxes, and shares a side evenly with other arrows, so a Control Action and Feedback between the same two boxes get separate lanes automatically.
- **Segment handles.** A selected arrow has a square handle in the middle of each inner segment. Drag it sideways to move that part of the arrow (the segment stays straight and the rest re-routes round boxes). Double-click a moved one to release it.
- **Reset arrow** (toolbar): both ends follow their boxes again and moved segments are released, for all selected arrows.
- Double-click an end handle to make that end follow its box again.
- Model: a pinned route point may carry an axis, `[x, y, 0|1]`.

**Changed**
- Dropping an end now works as in draw.io: on a connection point or within 8 px of the outline it is fixed there; elsewhere on the box it follows the box. (Before, every end was fixed wherever it was pressed or dropped.)
- The 0.7 corner handles are replaced by segment handles. Older pinned corners still work and can be released by double-click or Reset.
- Clicking or double-clicking a handle with a slight wobble (under 3 px) no longer pins anything.
- Requirements R5 and R18 rewritten.

**Not changed (on purpose)**
- Arrows in existing diagrams keep their fixed ends, so nothing moves when you open a file. Select all and **Reset arrow** to switch them to following their boxes.

**Docs**: REQUIREMENTS.md (R5, R18), DESIGN.md (arrow ends, moving segments, connection feedback), README.

**Tests**: 69 (was 67): route points with an axis, bad axes rejected, floating ends allowed. **The new behaviour is all JavaScript and has no automated test** (no JavaScript engine here).

**Not verified**
- None of this has been run in a browser. It is the largest change to the arrows so far. Most worth checking: hover points appearing and not getting in the way of moving boxes (pressing exactly on a point now starts an arrow); which side floating ends choose, especially for arrows to the Control Algorithm / Process Model; dragging a segment; double-click on handles; and Reset on an old diagram.

---

## 0.9.0, 2026-10-30: Description for Control Actions, effect for Feedback

**Added**
- A **Description** field on every Control Action, and an **Effect** field on every Feedback (what that feedback would do to the entity it points at). Each has its own column in the arrow's table, right after Name, edited by double-clicking like a name, and can be ticked to show on the diagram (as a small grey line on the arrow; long text is cut to 70 characters there, the table has all of it).
- Saved as `description` / `effect` on the arrow (up to 1000 characters). Existing diagrams open as before, with both empty. A Control Action cannot carry an effect and a Feedback cannot carry a description.
- Requirement R20.

**Changed**
- Arrow table columns are now ID, Name, Description or Effect, Line, From, To, On diagram.

**Docs**: REQUIREMENTS.md, DESIGN.md, README.

**Tests**: 67 (was 62): defaults and round trip, each field only on its own arrow type, type and length limits, the new columns and rows, showing them on the diagram. No JavaScript test exists or can be run here.

**Not verified**: not run in a browser. Check: double-clicking a description or effect, typing, Enter and Esc; ticking it to show on the arrow; that the cursor survives the table redraw after each save while typing a longer text.

---

## 0.8.0, 2026-10-30: Resizable table columns, double-click names, hide arrows

**Added**
- **Resizable table columns.** Drag the right edge of any column heading. Minimum width is about ten characters (plus the tick box and padding). Widths are remembered between visits.
- **Hide and unhide arrows.** Each arrow has an **On diagram** tick in its table row (the heading tick does the whole table), plus **Hide arrow** in the toolbar for the selected arrows and **Unhide arrows (n)** which appears while any are hidden. A hidden arrow is not drawn and cannot be selected, but keeps its row and links. Saved with the diagram (`hidden`).

**Changed**
- **Names need a double-click to edit** in the tables: they show as plain text (or "(no name)") until double-clicked. Enter keeps the change and Esc restores the old name.
- **The tick box in a Name cell is now to the left of the name**, not above it. Every cell is now tick-then-value.
- Select all and box-select skip hidden arrows, so Delete can't remove something you can't see.
- Requirements: R7 (double-click), R13 (resizable columns, tick position), new R19 (hiding arrows).

**Fixed**
- The tick box in the arrows' **Line** column was being wiped out when the cell's text was filled in (it never showed). Found while rewriting the cells.

**Docs**: REQUIREMENTS.md, DESIGN.md (table layout, hiding), README.

**Tests**: 62 (was 59): hidden defaults, round trip, must be true/false, hidden arrows still in tables. No JavaScript test exists or can be run here.

**Not verified**
- Nothing in the browser has been run. Check: dragging column edges (the minimum, and that the width survives a refresh), double-click to edit then Enter/Esc/click away, that the cursor survives the redraw after each save while typing, hide from the table and the toolbar and unhide, and that a hidden arrow's row still highlights and its links still appear on its boxes.
- Hiding is per arrow, not "all arrows"; say if you wanted a single switch for every arrow.

---

## 0.7.0, 2026-10-30: Names live in the tables; drag arrow bends

**Added**
- **Edit an arrow's bends.** Select an arrow and drag a square handle on any of its bends to move it away from other arrows. This pins a waypoint (`via` in the saved file); the router still goes round boxes between the waypoints. Pinned bends are filled; double-click one to unpin it.
- **Rename in the tables.** The Name cell of every row is a text box, next to its show/hide tick. The diagram updates as you type, and the cursor stays in the box when the table redraws after a save.
- **Double-click an item on the diagram** to open the tables on its row with the cursor in its Name cell.

**Removed**
- The Name box and Show tick from the toolbar (added in 0.3.2 and 0.6.0). Names are edited, and shown or hidden, in the tables only. A newly drawn item no longer jumps the cursor into a name box; it starts named after its type.

**Changed**
- Saving now waits for the tables to refresh before it reports done, so something that saves then looks in the tables sees the new row.
- Clicking the diagram releases any box being typed in, so Delete and the tool keys work straight away.
- Requirements: R7 (names are edited from the table), R15 (toolbar sentence removed), R18 (bends can be dragged).

**Docs**: REQUIREMENTS.md, DESIGN.md (names, waypoints), README.

**Tests**: 59 (was 57): arrows' `via` defaults to empty, round-trips, and bad points are rejected. Still **no test of any JavaScript** (no JavaScript engine is available here; the sandbox refused installing one).

**Not verified**
- Nothing in the browser has been run. In particular the new things: typing in a table Name cell (the cursor must survive the redraw after each save), double-click to rename, and dragging bend handles (a new waypoint going in at the right place, several waypoints on one arrow, double-click to unpin). The router was also changed to work leg by leg through waypoints; with no waypoints it should behave as before, but that is untested too.

---

## 0.6.0, 2026-10-30: Arrows route around boxes; Show tick for names

**Added**
- **Routed arrows.** Arrows are drawn as right-angled connectors that bend to go round boxes instead of crossing them, like Visio. They leave and enter a box straight out of the side they are attached to. An arrow may cross only the boxes it is connected to, the Controller around an inner box it is connected to, and the inner boxes of a Controller it is connected to; every other box is avoided with a 10 px margin. Moving a box re-routes its arrows. New `static/route.js` (served at `/route.js`).
- **Show tick beside the Name box** shows or hides the name on the diagram for the selected items. It does the same thing as the Name column in the tables (it was already possible per entity there; this puts it where you are working). It works on several selected items and is half-ticked for a mixed selection.
- Requirement R18 (routed arrows); R7 and R15 reworded for the Show tick.

**Changed**
- An arrow's label now sits half way along its route.
- Selecting, end handles, centring and box-select still use the arrow's two end points, so they behave as before.

**Docs**: REQUIREMENTS.md (R7, R15, R18), DESIGN.md (routing), README.

**Tests**: 57 pass. One check added that `/route.js` is served. **The routing itself has no automated test**: it is JavaScript and there is no JavaScript engine on this machine (I tried to install one in a throwaway virtual environment and the sandbox refused it).

**Not verified**
- None of this has been run, including the routing, which is new and fairly intricate. I walked a simple two-box case through by hand (it should give a Z-shape with the bend half way) but nothing more. Things most likely to need fixing: an arrow taking a strange detour, an arrow still crossing a box it should avoid, a slow drag when there are many boxes and arrows (routes are recomputed on every redraw), and labels landing on top of their own line.

---

## 0.5.1, 2026-10-30: New arrows start with a name

**Changed**
- New Control Actions and Feedback arrows are named "Control Action" / "Feedback" to begin with (they used to start blank, so with Name ticked, as it is by default, only the ID showed). Boxes already did this. Arrows already in a diagram keep whatever name they have, including none.
- Name was, and remains, ticked by default for every entity (with ID); nothing about the tick boxes changed.

**Docs**: README.

**Tests**: none (browser-only change); 57 existing tests pass.

**Not verified**: not run in a browser.

---

## 0.5.0, 2026-10-30: Dark theme, colour chart, choose what the diagram shows

**Added**
- **Dark theme.** A Theme button cycles Auto (follow the system), Light and Dark; a forced choice is remembered and applied before the page paints. The page already followed the system's dark setting; now it can be chosen.
- **Colour chart** replaces the browser's colour picker: 16 swatches (15 colours and Default). It colours the selected items, or the next item drawn of the active tool's type; every entity type, including the two inner boxes and both arrow types, can be coloured.
- **Show properties on the diagram.** Every table cell has a tick box that shows or hides that property of that entity on the diagram; a tick box in each column heading does the whole column. Default: ID and name. Other properties draw as small grey lines on the box or arrow (linked ids, line style, from/to). Saved with the diagram (`shown`).
- Colour `auto` (the theme's text colour), used as the new default for arrows.
- `docs/REQUIREMENTS.md`: the requirements as one current list (R1 to R17).

**Changed**
- **Requirements rewritten to the new set only.** Superseded wording is gone: the old "different colours" (a picker, four types), "arrows connect a Controller or Controlled Process" and the per-version lists in DESIGN.md. DESIGN.md now points at REQUIREMENTS.md and cites R-numbers.
- Default colours: Controller blue (#3b82f6, was #2563eb), Controlled Process green, arrows `auto` (was near-black #111827, which is invisible on dark). Arrows saved with the old default become `auto` when opened; other colours are untouched.
- The tables panel and the diagram now refetch the tables after every save (the diagram needs them for the new lines), and keep their scroll position when they refresh.
- Table columns now come from one list in the model (`FIELDS`), shared with the validation of which properties can be shown.

**Docs**: README, docs/DESIGN.md (colours, theme, properties shown), docs/REQUIREMENTS.md (new).

**Tests**: 57 (was 49), all passing: `auto` and hex colours accepted and others rejected; defaults; `shown` default, tidying, round trip, rejects properties a type doesn't have; table columns equal the showable properties for every type; old near-black arrows become `auto`.

**Not verified**
- None of the browser side has been run (no Node; Firefox won't start headless here): theme switching, the colour chart, the tick boxes and the extra lines on boxes and arrows. Things to look at in particular: text in small boxes being cut off, the colour chart opening over the diagram and closing on a click elsewhere, ticking a box in a table then seeing the diagram change without the table jumping to the top, and that nothing looks wrong in dark.
- "Other arrows" is still there; see the answer in the conversation. It can be removed if you don't want it.

---

## 0.4.0, 2026-10-29: Tables dock at the bottom

**Added**
- The tables now open in a panel along the bottom of the screen, under the diagram instead of over it, and can be minimised to a bar (T, or click the bar). Drag its top edge to resize.
- Tabs, one per entity type, with row counts.
- Selecting something on the diagram switches to its table and highlights its row (all selected rows, for several items). Clicking an ID in a table selects that item and centres it on the diagram.
- The panel refreshes after every autosave.

**Changed**
- Replaces the full-screen Tables view and its toolbar button. Esc no longer closes the tables; minimise with the bar or T.
- A minimised panel does not open by itself when you click things.

**Docs**: README, docs/DESIGN.md.

**Tests**: none new (browser-only change; the table contents are unchanged). 49 existing tests pass.

**Not verified**: not run in a browser. Check: open the panel and the diagram is still usable above it; click a Controller, then a Feedback arrow, and the tab and highlighted row follow; click an ID inside a table; minimise and reopen; drag the top edge; draw something new and see its row appear after the save.

---

## 0.3.2, 2026-10-29: Name box

**Added**
- A **Name** box in the toolbar sets the name of the selected Controller, Controlled Process, Control Action, Feedback (and Control Algorithm / Process Model). Updates the diagram and tables as you type. A newly drawn item focuses it so you can type straight away.

**Changed**
- Double-click now jumps to the Name box instead of opening a pop-up prompt.

**Docs**: README, docs/DESIGN.md.

**Tests**: none new; the server and model already stored names (`label`, max 200 characters), and this is browser-only. 49 existing tests still pass.

**Not verified**: not run in a browser. Check: draw a Controller and type a name straight away; select an arrow and rename it; select two items (Name box should switch off); Delete/letter shortcuts must not fire while typing in the box.

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
