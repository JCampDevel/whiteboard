# Whiteboard

Draw control-structure diagrams in your browser. No installs: Python 3 standard library only.

**New here?** [GETTING_STARTED.md](GETTING_STARTED.md) shows how to get the project and run it, step by step.

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
- **Name:** names are changed in the tables (there is no name box in the toolbar). Open the **Tables** panel, pick the entity's tab and double-click the name in its row; the diagram updates as you type. The tick box in the same cell shows or hides that name on the diagram. To rename something you are looking at, double-click it on the diagram: the tables open on its row with the name ready to type over. A new item starts named after its type.
- **Arrow:** hover over a box and its connection points appear (small circles, three on each side). **Drag out of one** to draw an arrow, and drop it on another box. This draws the kind of arrow last picked in the toolbar (Control Action to start with); you can also pick **Control Action** or **Feedback** in the toolbar and drag from anywhere on a box. Where you drop decides how the end attaches, as in draw.io: on a connection point (it snaps, and the point fills in) or on the box's outline, the end is **fixed** there; anywhere in the middle of the box, the end **follows the box**: it uses whichever side faces the other box and moves round when you move boxes. Arrows that follow share a side tidily, so a Control Action and its Feedback between the same two boxes sit side by side. Full or Dashed applies as you draw.
- **Arrow routes:** arrows are drawn with right-angled bends and go round boxes rather than across them, as in Visio. An arrow may only cross the boxes it connects to: an arrow on a Controller can pass over that Controller's Control Algorithm and Process Model, and an arrow on an inner box can cross the Controller around it. Where there is no room to go round (boxes very close together) it takes a plain line that may cross a box.
- **Edit an arrow:** click it to select it. **Round handles** at the ends: drag one to another point, onto the outline, into the middle of the box (follow the box) or onto a different box; double-click one to make that end follow its box again. **Square handles** sit in the middle of each inner segment: drag one sideways to move that part of the arrow, for example away from another arrow (it turns solid); double-click a solid one to let it route itself again. **Reset arrow** in the toolbar puts the selected arrows back to fully automatic (both ends follow their boxes, no moved segments); select everything and Reset to tidy a whole diagram, including arrows drawn with older versions, whose ends were all fixed.
- **Pan:** use the Pan tool (or hold Space, or use the middle mouse button) and drag the canvas. The mouse wheel / trackpad pans too. Home returns the view to your diagram.
- **Select several:** Shift+click or Ctrl+click adds or removes an item; with the Select tool, drag across empty space to box-select (hold Shift/Ctrl to add to the current selection); Ctrl+A selects everything. Drag any selected rectangle to move the whole group.
- **Colour:** click the Colour button for the colour chart. It colours the selected items; with nothing selected and a drawing tool picked, it sets the colour of the next item you draw. Each type remembers its last colour. **A** (Default) follows the theme: dark on light, light on dark; it is the default for arrows. Arrow line (Full/Dashed) applies to all selected arrows.
- **Theme:** the Theme button cycles Auto (follow your system), Light and Dark, and remembers a forced choice.
- **Select tool, one item:** drag the corner square to resize a rectangle, double-click to edit a label, Delete to remove the selection.
- **Keys:** S select, H pan, C controller, P controlled process, A control action, F feedback, Esc cancel and deselect.

## Tables

The **Tables** bar sits along the bottom of the screen (press T, or click it, to open or minimise). Open, it shows one tab per entity type (Controller, Control Algorithm, Process Model, Controlled Process, Control Action, Feedback) under the diagram, which stays visible and usable above it. Drag the panel's top edge to resize it. Minimise it and it leaves just the bar.

- **Diagram to table:** while the panel is open, selecting an item on the diagram switches to its table, scrolls to its row and highlights it. Select several and every selected row in that table is highlighted. If the panel is minimised, nothing opens by itself; the item is found when you open it.
- **Description and effect:** a Control Action has a **Description** and a Feedback has an **Effect** (what that feedback would do to the entity it points at, i.e. the one in its **To** column). Double-click the cell in the arrow's table to write it, like a name. Tick the box in the cell to show it on the diagram (long text is cut short there; the table shows all of it).
- **Rename in the table:** double-click a name to turn it into a text box; the diagram changes as you type. Enter keeps it, Esc puts the old name back. A single click does nothing, so names can't be changed by accident.
- **Resize columns:** drag the right edge of a column heading. A column can't be narrower than about ten characters. Your widths are remembered.
- **Hide an arrow:** untick **On diagram** in the arrow's row (Control Action and Feedback tables; the box in the heading does the whole table), or select the arrow and click **Hide arrow** in the toolbar. A hidden arrow isn't drawn or selectable but stays in the tables with its links. **Unhide arrows (n)** in the toolbar brings them all back.
- **Show on the diagram:** every table cell has a tick box. Tick it to show that property of that entity on the diagram, untick to hide it; the tick box in a column heading ticks or clears the whole column. By default each entity shows its ID and name; a new item's name starts as its type ("Controller", "Feedback" and so on), for you to change. Other properties appear as smaller grey lines (for example "Outgoing control actions: A1, A2" in a Controller, or "From: C1" on an arrow). Text is cut off at the edge of its box, so make a box bigger to see a long list. These lines can lag an edit by a moment.
- **Table to diagram:** click any ID in a table to select that item and centre it on the diagram (and show its own table, if you clicked a link to a different type).
- The panel refreshes itself after each autosave.

| Table | Columns |
|---|---|
| Controller | ID, Name, Control Algorithm, Process Model, Outgoing control actions, Incoming feedback, Other arrows |
| Control Algorithm / Process Model | ID, Name, Controller, Outgoing control actions, Incoming feedback, Other arrows |
| Controlled Process | ID, Name, Incoming control actions, Outgoing feedback, Other arrows |
| Control Action | ID, Name, Description, Line (full/dashed), From, To, On diagram |
| Feedback | ID, Name, Effect, Line (full/dashed), From, To, On diagram |

A Controller's row also counts arrows on its own Control Algorithm and Process Model, since they are part of it. **Other arrows** is a catch-all so that nothing is silently missing from the tables: it lists arrows attached the unusual way round (for example a Feedback leaving a Controller, or a Control Action arriving at one) and arrows between a Controller's own inner boxes, marked "(internal)". In a tidy diagram it stays empty. The tables are built from the saved file; the page saves first, then shows them (so they trail your last edit by a moment).

Files from earlier versions are upgraded when opened: items get IDs with the current prefixes (n1 becomes C1, an old ALG1 becomes CA1, an old CA1 or FB1 becomes A1 or F1, and so on) and every Controller gets its two inner boxes. The file on disk changes the next time you edit.

## Saving and opening

The diagram saves automatically (status shown top right) to the file the app was started with (`diagram.json` unless you gave `--file`).

- **Save as…** (Ctrl+S) saves a copy to a JSON file. Chrome and Edge ask where to put it; other browsers put it in your downloads as `diagram-<date>.json`.
- **Open…** (Ctrl+O) opens a diagram from a JSON file. It replaces the diagram on screen (it asks first), so Save as… before if you want to keep the current one. Files from older versions of the app are upgraded as they open; a file that isn't a diagram is refused and nothing changes.

Files are plain, indented JSON, one field per line, starting with `"format": "whiteboard-diagram"`, so you can read them, compare versions, keep them in git or edit them in a text editor. If you edit one by hand and make a mistake, Open… tells you what is wrong rather than loading it.

## Tests

```
python3 -m unittest discover -s tests -t .
```

Tests use temporary files and a random localhost port only. The drawing code in `whiteboard/static/app.js` has no automated tests yet; see [CHANGELOG.md](CHANGELOG.md).

See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for what it must do and [docs/DESIGN.md](docs/DESIGN.md) for how it is put together.
