# Whiteboard

Draw control-structure diagrams in your browser. No installs: Python 3 standard library only.

```
python3 -m whiteboard                      # opens http://127.0.0.1:8000, saves to ./diagram.json
python3 -m whiteboard --file my.json --port 9000 --no-browser
```

## What you can draw

| Entity | Drawn as | Unique ID |
|---|---|---|
| Controller | rectangle | C1, C2, ... |
| Control Algorithm | box inside a Controller (right half, top) | CA1, ... |
| Process Model | box inside a Controller (right half, below) | PM1, ... |
| Controlled Process | rectangle | CP1, ... |
| Control Action | arrow, full or dashed | A1, ... |
| Feedback | arrow, full or dashed | F1, ... |

Every Controller is created with one Control Algorithm and one Process Model inside it, labelled with those names. They stay in the right half whatever you do to the Controller (the Controller's own label moves to the left half), and they are deleted with it. Every item has its own colour and its ID is shown on it (on arrows, before the label). IDs are fixed; deleting an item never renumbers the others.

Arrows can start and end on any of the four boxes: Controller, Control Algorithm, Process Model or Controlled Process. You drag from one box and drop on another, and an arrow can't be left loose. Moving or resizing a rectangle drags its arrows with it. Deleting a rectangle deletes its arrows.

The canvas has no edges: pan in any direction and draw anywhere.

## Using it

- **Rectangle:** pick Controller or Controlled Process, then drag out a box (or just click for a default size). A Controller is at least 360 x 140 so its two inner boxes fit.
- **Inner boxes:** press and drag on a Control Algorithm or Process Model to move the whole Controller. Draw arrows to and from them like any other box. Double-click to rename.
- **Arrow:** pick Control Action or Feedback, choose Full or Dashed, then press on the rectangle where the arrow should start and release on the rectangle where it should end. The arrow attaches to the border at the nearest point to where you pressed and released.
- **Edit an arrow:** click an arrow to select it; a round handle appears at each end. Drag either handle to slide that end around its rectangle, or drop it on a different rectangle to re-attach it. Each end is edited on its own. While you drag, the rectangle it will connect to is ringed and a dot shows the exact attachment point (the same happens when you draw a new arrow). You can also press right on the outside of an arrow's end and drag without selecting first.
- **Pan:** use the Pan tool (or hold Space, or use the middle mouse button) and drag the canvas. The mouse wheel / trackpad pans too. Home returns the view to your diagram.
- **Select several:** Shift+click or Ctrl+click adds or removes an item; with the Select tool, drag across empty space to box-select (hold Shift/Ctrl to add to the current selection); Ctrl+A selects everything. Drag any selected rectangle to move the whole group.
- **Colour:** set it before drawing, or select one or more items and change it. Arrow line (Full/Dashed) applies to all selected arrows.
- **Select tool, one item:** drag the corner square to resize a rectangle, double-click to edit a label, Delete to remove the selection.
- **Keys:** S select, H pan, C controller, P controlled process, A control action, F feedback, Esc cancel and deselect.

## Tables

Click **Tables** (top right) for one table per entity type: Controller, Control Algorithm, Process Model, Controlled Process, Control Action, Feedback. Click **Diagram** (or Esc) to go back, or click any ID to jump to it on the diagram.

| Table | Columns |
|---|---|
| Controller | ID, Name, Control Algorithm, Process Model, Outgoing control actions, Incoming feedback, Other arrows |
| Control Algorithm / Process Model | ID, Name, Controller, Outgoing control actions, Incoming feedback, Other arrows |
| Controlled Process | ID, Name, Incoming control actions, Outgoing feedback, Other arrows |
| Control Action / Feedback | ID, Name, Line (full/dashed), From, To |

A Controller's row also counts arrows on its own Control Algorithm and Process Model, since they are part of it. **Other arrows** lists anything attached the unusual way round (for example a Feedback leaving a Controller) and arrows between a Controller's own inner boxes, marked "(internal)", so nothing is hidden. The tables are built from the saved file; the page saves first, then shows them.

Files from earlier versions are upgraded when opened: items get IDs with the current prefixes (n1 becomes C1, an old ALG1 becomes CA1, an old CA1 or FB1 becomes A1 or F1, and so on) and every Controller gets its two inner boxes. The file on disk changes the next time you edit.

The diagram saves automatically (status shown top right) to the JSON file.

## Tests

```
python3 -m unittest discover -s tests -t .
```

Tests use temporary files and a random localhost port only. The drawing code in `whiteboard/static/app.js` has no automated tests yet; see [CHANGELOG.md](CHANGELOG.md).

See [docs/DESIGN.md](docs/DESIGN.md) for how it is put together.
