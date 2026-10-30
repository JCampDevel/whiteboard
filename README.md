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

Every Controller is created with one Control Algorithm and one Process Model inside it, labelled with those names. They stay in the right half whatever you do to the Controller (the Controller's own label moves to the left half), and they are deleted with it. Every item has its own colour. IDs are fixed; deleting an item never renumbers the others.

Arrows can start and end on any of the four boxes: Controller, Control Algorithm, Process Model or Controlled Process. You drag from one box and drop on another, and an arrow can't be left loose. Moving or resizing a rectangle drags its arrows with it. Deleting a rectangle deletes its arrows.

The canvas has no edges: pan in any direction and draw anywhere.

## Using it

- **Rectangle:** pick Controller or Controlled Process, then drag out a box (or just click for a default size). A Controller is at least 360 x 140 so its two inner boxes fit.
- **Inner boxes:** press and drag on a Control Algorithm or Process Model to move the whole Controller. Draw arrows to and from them like any other box.
- **Name:** select one item (Controller, Controlled Process, Control Action, Feedback, or an inner box) and type in the **Name** box in the toolbar; the diagram and the tables update as you type. Double-click an item to jump to the box. A newly drawn item puts the cursor there already, so you can name it straight away. Enter or Esc leaves the box.
- **Arrow:** pick Control Action or Feedback, choose Full or Dashed, then press on the rectangle where the arrow should start and release on the rectangle where it should end. The arrow attaches to the border at the nearest point to where you pressed and released.
- **Edit an arrow:** click an arrow to select it; a round handle appears at each end. Drag either handle to slide that end around its rectangle, or drop it on a different rectangle to re-attach it. Each end is edited on its own. While you drag, the rectangle it will connect to is ringed and a dot shows the exact attachment point (the same happens when you draw a new arrow). You can also press right on the outside of an arrow's end and drag without selecting first.
- **Pan:** use the Pan tool (or hold Space, or use the middle mouse button) and drag the canvas. The mouse wheel / trackpad pans too. Home returns the view to your diagram.
- **Select several:** Shift+click or Ctrl+click adds or removes an item; with the Select tool, drag across empty space to box-select (hold Shift/Ctrl to add to the current selection); Ctrl+A selects everything. Drag any selected rectangle to move the whole group.
- **Colour:** click the Colour button for the colour chart. It colours the selected items; with nothing selected and a drawing tool picked, it sets the colour of the next item you draw. Each type remembers its last colour. **A** (Default) follows the theme: dark on light, light on dark; it is the default for arrows. Arrow line (Full/Dashed) applies to all selected arrows.
- **Theme:** the Theme button cycles Auto (follow your system), Light and Dark, and remembers a forced choice.
- **Select tool, one item:** drag the corner square to resize a rectangle, double-click to edit a label, Delete to remove the selection.
- **Keys:** S select, H pan, C controller, P controlled process, A control action, F feedback, Esc cancel and deselect.

## Tables

The **Tables** bar sits along the bottom of the screen (press T, or click it, to open or minimise). Open, it shows one tab per entity type (Controller, Control Algorithm, Process Model, Controlled Process, Control Action, Feedback) under the diagram, which stays visible and usable above it. Drag the panel's top edge to resize it. Minimise it and it leaves just the bar.

- **Diagram to table:** while the panel is open, selecting an item on the diagram switches to its table, scrolls to its row and highlights it. Select several and every selected row in that table is highlighted. If the panel is minimised, nothing opens by itself; the item is found when you open it.
- **Show on the diagram:** every table cell has a tick box. Tick it to show that property of that entity on the diagram, untick to hide it; the tick box in a column heading ticks or clears the whole column. By default each entity shows its ID and name. Other properties appear as smaller grey lines (for example "Outgoing control actions: A1, A2" in a Controller, or "From: C1" on an arrow). Text is cut off at the edge of its box, so make a box bigger to see a long list. These lines can lag an edit by a moment.
- **Table to diagram:** click any ID in a table to select that item and centre it on the diagram (and show its own table, if you clicked a link to a different type).
- The panel refreshes itself after each autosave.

| Table | Columns |
|---|---|
| Controller | ID, Name, Control Algorithm, Process Model, Outgoing control actions, Incoming feedback, Other arrows |
| Control Algorithm / Process Model | ID, Name, Controller, Outgoing control actions, Incoming feedback, Other arrows |
| Controlled Process | ID, Name, Incoming control actions, Outgoing feedback, Other arrows |
| Control Action / Feedback | ID, Name, Line (full/dashed), From, To |

A Controller's row also counts arrows on its own Control Algorithm and Process Model, since they are part of it. **Other arrows** is a catch-all so that nothing is silently missing from the tables: it lists arrows attached the unusual way round (for example a Feedback leaving a Controller, or a Control Action arriving at one) and arrows between a Controller's own inner boxes, marked "(internal)". In a tidy diagram it stays empty. The tables are built from the saved file; the page saves first, then shows them (so they trail your last edit by a moment).

Files from earlier versions are upgraded when opened: items get IDs with the current prefixes (n1 becomes C1, an old ALG1 becomes CA1, an old CA1 or FB1 becomes A1 or F1, and so on) and every Controller gets its two inner boxes. The file on disk changes the next time you edit.

The diagram saves automatically (status shown top right) to the JSON file.

## Tests

```
python3 -m unittest discover -s tests -t .
```

Tests use temporary files and a random localhost port only. The drawing code in `whiteboard/static/app.js` has no automated tests yet; see [CHANGELOG.md](CHANGELOG.md).

See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for what it must do and [docs/DESIGN.md](docs/DESIGN.md) for how it is put together.
