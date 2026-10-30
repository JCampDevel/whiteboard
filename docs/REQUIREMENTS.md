# Requirements (v0.5)

What the whiteboard must do. This is the current list only; wording from earlier versions that no longer holds has been replaced, not kept. Numbers are stable labels and are not renumbered when a requirement is added, so they are not always in order. [DESIGN.md](DESIGN.md) says how each is met.

## Entities

- **R1. Six entity types.** Controller, Control Algorithm, Process Model and Controlled Process are boxes. Control Action and Feedback are arrows.
- **R2. Inner boxes.** A Controller contains one Control Algorithm and one Process Model, drawn in its right half. They are created with the Controller, move and resize with it, and are deleted with it. Arrows can start and end on them.
- **R3. Arrow lines.** An arrow of either type can be a full line or a dashed line.
- **R4. Connected arrows.** Every arrow is connected at both ends to a box (a Controller, Control Algorithm, Process Model or Controlled Process) and can never be left loose.
- **R5. Connecting and editing connections, as in common drawing tools.** Boxes show connection points (three on each side) when the mouse is over them. An arrow can be drawn by dragging out of a connection point, or with an arrow tool. Each end of an arrow either follows its box (it uses the side facing the other end and spreads out from other arrows on that side, and re-chooses as boxes move) or is fixed to a point the user chooses: a connection point or any point on the box's outline. Either end can be edited afterwards: moved to another point, onto another box, or set back to following its box. While an end is being dragged, the box it would connect to is highlighted with its connection points.
- **R6. Unique IDs.** Every entity has a unique ID that names its type and never changes: C (Controller), CA (Control Algorithm), PM (Process Model), CP (Controlled Process), A (Control Action), F (Feedback), each followed by a number.
- **R7. Names.** The user can set the name of every entity from its table (by double-clicking the name there, so it is not changed by accident), and can show or hide the name on each individual entity, also from its table.
- **R8. Colours.** The user can give every entity a colour chosen from a colour chart. The default colours are readable on both themes.
- **R18. Routed arrows.** Arrows are drawn with right-angled bends so that they go round boxes instead of across them, as Visio connectors do. An arrow may cross only the boxes it is connected to, the Controller around an inner box it is connected to, and the inner boxes of a Controller it is connected to. The user can drag a middle segment of an arrow sideways to move it away from other arrows, and can return an arrow to fully automatic routing.
- **R20. Control Action description and Feedback effect.** A Control Action has a description field. A Feedback has an effect field, saying what effect that feedback would have on the entity it points at. Both are edited in the entity's table and can be shown on the diagram like any other property.
- **R21. Relationships between arrows.** The user can select two or more arrows and add a relationship between them, describing it in a box that appears. Each relationship has a unique ID (R1, R2, ...) and is listed in a Relationships table with the arrows it links and its description, which can be edited there. A relationship can be removed without removing its arrows. Each arrow's table shows the relationships it is part of, which, like its other properties, can be shown on the diagram.
- **R19. Hiding arrows.** The user can hide an arrow from the diagram and unhide it again. A hidden arrow stays in the tables, with its links.
- **R9. Dark theme.** The page can be shown light or dark, or follow the system setting. The choice is remembered.

## Canvas

- **R10. Unbounded canvas.** The canvas has no edges. The user moves around it by dragging, not by scrolling.
- **R11. Multi-select.** The user can select several items with Shift+click, Ctrl+click or by dragging a box over them, and can drag the selected boxes together.

## Tables

- **R12. One table per entity type.** Controller, Control Algorithm, Process Model, Controlled Process, Control Action and Feedback each have a table with a column for the entity's unique ID, its name, and columns for the entities linked to it (for a Controller: its Control Algorithm, Process Model, outgoing control actions and incoming feedback).
- **R13. Tables panel.** The tables open in a panel at the bottom of the screen that can be minimised, while the diagram stays visible and usable. The user can resize the columns of a table, down to a minimum of about ten characters. The tick box in a Name cell sits to the left of the name.
- **R14. Linking diagram and tables.** Selecting an element on the diagram takes the user to the right table and highlights the element's row. Clicking an ID in a table takes the user to that element on the diagram.
- **R15. Fields shown on the diagram.** For each entity and each property (each cell of its table) the user can tick whether that property is shown on the diagram. By default the ID and name are shown.

## Files

- **R16. Saving and opening.** A diagram is saved in a human-readable format (indented JSON, one field per line, labelled as a whiteboard diagram) and saves automatically to the file being worked on. The user can save it to a file name and folder of their choice (Save as), after which that file is the one being worked on, and can open a diagram file, which then becomes the one being worked on. Before opening, the user is asked to confirm that any unsaved changes will be lost, with Open and Cancel; Cancel cancels the whole operation. Saving over an existing file asks first. Files from earlier versions open and are upgraded; a file that is not a diagram is refused without changing anything. Saving and opening never change the toolbar's layout.
- **R17. Local only.** The app runs on the user's own machine and is not reachable from other machines.
