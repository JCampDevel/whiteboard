# Requirements (v0.5)

What the whiteboard must do. This is the current list only; wording from earlier versions that no longer holds has been replaced, not kept. [DESIGN.md](DESIGN.md) says how each is met.

## Entities

- **R1. Six entity types.** Controller, Control Algorithm, Process Model and Controlled Process are boxes. Control Action and Feedback are arrows.
- **R2. Inner boxes.** A Controller contains one Control Algorithm and one Process Model, drawn in its right half. They are created with the Controller, move and resize with it, and are deleted with it. Arrows can start and end on them.
- **R3. Arrow lines.** An arrow of either type can be a full line or a dashed line.
- **R4. Connected arrows.** Every arrow is connected at both ends to a box (a Controller, Control Algorithm, Process Model or Controlled Process) and can never be left loose.
- **R5. Choosing and editing connections.** The user chooses where on a box each end of an arrow attaches. Either end can be edited afterwards, both its position on the box and which box it is attached to. While an end is being dragged, the box it would connect to is highlighted.
- **R6. Unique IDs.** Every entity has a unique ID that names its type and never changes: C (Controller), CA (Control Algorithm), PM (Process Model), CP (Controlled Process), A (Control Action), F (Feedback), each followed by a number.
- **R7. Names.** The user can set the name of every entity.
- **R8. Colours.** The user can give every entity a colour chosen from a colour chart. The default colours are readable on both themes.
- **R9. Dark theme.** The page can be shown light or dark, or follow the system setting. The choice is remembered.

## Canvas

- **R10. Unbounded canvas.** The canvas has no edges. The user moves around it by dragging, not by scrolling.
- **R11. Multi-select.** The user can select several items with Shift+click, Ctrl+click or by dragging a box over them, and can drag the selected boxes together.

## Tables

- **R12. One table per entity type.** Controller, Control Algorithm, Process Model, Controlled Process, Control Action and Feedback each have a table with a column for the entity's unique ID, its name, and columns for the entities linked to it (for a Controller: its Control Algorithm, Process Model, outgoing control actions and incoming feedback).
- **R13. Tables panel.** The tables open in a panel at the bottom of the screen that can be minimised, while the diagram stays visible and usable.
- **R14. Linking diagram and tables.** Selecting an element on the diagram takes the user to the right table and highlights the element's row. Clicking an ID in a table takes the user to that element on the diagram.
- **R15. Fields shown on the diagram.** For each entity and each property (each cell of its table) the user can tick whether that property is shown on the diagram. By default the ID and name are shown.

## Files

- **R16. Saving.** The diagram saves automatically to a file. Files from earlier versions open and are upgraded.
- **R17. Local only.** The app runs on the user's own machine and is not reachable from other machines.
