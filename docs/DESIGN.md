# Design

## Requirements (v0.1)

1. Draw rectangles, full arrows and dashed arrows, in different colours.
2. Four entity types: Controller and Controlled Process are rectangles; Control Action and Feedback are arrows (full or dashed, chosen independently of the type).
3. The board extends as the diagram grows (v0.2: an unbounded canvas).
4. Every arrow is connected at both ends to a Controller or a Controlled Process.
5. (v0.2) The user pans by dragging the canvas, selects several items (Shift/Ctrl+click, box select) and drags them together.
6. (v0.2) The user chooses where on each rectangle an arrow starts and ends.
7. (v0.3) A Controller has two boxes inside it, on its right half: Control Algorithm and Process Model. Arrows can go to and from them.
8. (v0.3) All six entity types, including the two inner boxes, have a unique ID.
9. (v0.3) One table per entity type, with the entity's ID and columns linking it to related entities.

## Parts

- `whiteboard/model.py`: the diagram data and all validation. Requirement 4 is enforced here (an edge's source and target must be two different, existing nodes), so the server rejects a bad diagram even if the page has a bug.
- `whiteboard/server.py`: `http.server` on 127.0.0.1 only. `GET /api/diagram`, `PUT /api/diagram` (validated, written atomically), and three fixed static files. Nothing else is served, so there is no path to traverse.
- `whiteboard/static/`: single-page SVG editor. Holds the diagram in memory, redraws on every change, and autosaves 400 ms after the last change.

## Decisions

- **Browser, not Tkinter:** `tkinter` is not installed for the system Python, and installing it needs sudo. The browser version needs nothing.
- **Arrow ends:** an arrow stores the ids of its two rectangles plus `source_anchor` and `target_anchor`: a point on each rectangle's border as fractions `[x, y]` of its width and height (so it stays put when the rectangle is moved or resized). The page snaps whatever point the user presses to the nearest side. The arrow is a straight line between the two points. Files without anchors (v0.1) get them filled in on load, where the line between the rectangle centres crosses the border.
- **Panning, not scrolling:** the page keeps a view offset and draws everything in a translated group, so the canvas is unbounded in every direction (negative coordinates are fine) and there are no scrollbars. Pan = Pan tool, Space+drag, middle button or wheel.
- **Selection:** a set of ids (rectangles and arrows). Dragging empty space with the Select tool draws a box that selects rectangles it touches and arrows whose both ends are inside it. Dragging any selected rectangle moves all selected rectangles; arrows follow because they only store anchors. A plain click inside a group that doesn't move narrows the selection to that item. The resize handle shows only when exactly one rectangle is selected; arrow-end handles show on every selected arrow.
- **Connection feedback:** while drawing an arrow or dragging an arrow end, the drag state records the rectangle under the pointer; `render()` rings it (and tints it) and the overlay shows a dot at the border point the end will attach to. A drag released over empty space or the arrow's other rectangle does not change the connection.
- **Unique IDs:** an ID is the type's prefix plus a number (C Controller, CA Control Algorithm, PM Process Model, CP Controlled Process, A Control Action, F Feedback). The model rejects an ID whose prefix doesn't match the item's type, and duplicates across all items, so an ID identifies exactly one entity and says what it is. The page picks the next number as highest-in-use plus one; a number is reused only if the highest one was deleted.
- **Inner boxes:** a Control Algorithm / Process Model is an ordinary node with a `parent` (a Controller); the model allows at most one of each per Controller and nothing else may have a parent. Their position and size are *derived* from the Controller by the page on every draw (so they follow it), but are still saved with the other geometry. They can't be moved, resized or deleted separately. Arrow anchors work on them exactly as on other boxes.
- **Tables:** built in Python (`model.tables`, served at `GET /api/tables`) rather than in the page, so the linking rules are unit tested. The page saves any pending change before asking. Direction rules: a Controller / Control Algorithm / Process Model lists *outgoing Control Actions* and *incoming Feedback*; a Controlled Process lists *incoming Control Actions* and *outgoing Feedback*. Arrows of any other kind or direction land in "Other arrows". For a Controller, the arrows of its two inner boxes count as its own, and arrows between its own inner boxes are listed as "(internal)".
- **Old files:** `model.migrate` upgrades v0.1/0.2 files when they are read (typed IDs, inner boxes added). It is idempotent and doesn't change the input.
- **File format:** JSON, `{nodes: [...], edges: [...]}`. Node: id, type, x, y, w, h, label, colour, parent (inner boxes only). Edge: id, type, source, target, style, label, colour, source_anchor, target_anchor.
