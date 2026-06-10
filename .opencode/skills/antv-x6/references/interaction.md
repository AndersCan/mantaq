# Interaction: connecting, plugins, events

## What inside

- `connecting` config (hardest part)
- validateMagnet vs validateConnection vs validateEdge
- createEdge (style the dragged edge)
- Highlight valid target
- Events you use
- Plugins (all from `@antv/x6`)
- Pan and zoom

## `connecting` config (hardest part)

Live in Graph constructor. Rule the whole drag-to-connect. X6 docs scatter this bad. Here full flowchart setup. Copy it:

```ts
const graph = new Graph({
  container,
  autoResize: true,
  grid: true,
  connecting: {
    router: { name: "manhattan" },
    connector: { name: "rounded", args: { radius: 8 } },
    anchor: "center",
    connectionPoint: "anchor",
    allowBlank: false, // no drop edge on empty canvas
    allowLoop: false, // no self connect
    allowNode: false, // must hit port, not node body
    allowEdge: false, // no connect to edge
    allowMulti: false, // max one edge between same two ports
    snap: { radius: 20 }, // snap to port within 20px. big UX win.
    highlight: true, // light up valid magnet while drag
    createEdge() {
      // style every drawn edge
      return this.createEdge({
        shape: "flow-edge", // or inline attrs
        attrs: {
          line: { stroke: "#A2B1C3", strokeWidth: 2, targetMarker: { name: "block", size: 8 } },
        },
        zIndex: 0,
      });
    },
    validateMagnet({ magnet }) {
      // fire on mousedown on magnet. false = no start here.
      return magnet.getAttribute("port-group") !== "in"; // only start from 'out' port
    },
    validateConnection({ sourceMagnet, targetMagnet, sourceCell, targetCell }) {
      // fire over and over while drag. false = reject this target.
      if (!targetMagnet) return false;
      if (sourceCell === targetCell) return false; // no loop
      if (targetMagnet.getAttribute("port-group") !== "in") return false; // only into 'in' port
      return true;
    },
  },
  highlighting: {
    magnetAvailable: {
      // look of connectable port during drag
      name: "stroke",
      args: { padding: 4, attrs: { strokeWidth: 4, stroke: "#31d0c6" } },
    },
    magnetAdsorbed: {
      // look of port being snapped
      name: "stroke",
      args: { attrs: { strokeWidth: 4, stroke: "#5F95FF" } },
    },
  },
});
```

## validateMagnet vs validateConnection vs validateEdge

Three. Fire at different time. Wrong one = classic bug.

- **`validateMagnet({ magnet, view, cell })`** — fire once on **mousedown** on magnet. Decide can drag _start_ here (like only output port).
- **`validateConnection({ sourceMagnet, targetMagnet, sourceView, targetView, sourceCell, targetCell })`** — fire **many time while drag**, cursor move over target. Return `false` = no drop there, and (with `highlight`) no highlight. Most rules go here.
- **`validateEdge({ edge })`** — fire **once on mouseup**, edge object now exist. Last chance reject (return `false` = edge removed). Use for rule that need finished edge.

`port-group` / `port` attribute: port draw a `circle` with `magnet=true`. Group name on `port-group` attribute. Port id on `port`. Read with `magnet.getAttribute('port-group')`.

## createEdge (style the dragged edge)

No `createEdge` = drawn edge use X6 plain default. Look nothing like your registered edge. Always give `createEdge` for polish. Return registered shape (`shape: 'flow-edge'`) or inline `attrs`. Note `this` = graph. So `this.createEdge({...})` is the way.

## Highlight valid target

`highlighting` block (above) rule how port light up. `magnetAvailable` = all connectable port light the moment drag start. `magnetAdsorbed` = the one being snapped. This plus `snap: { radius }` make connect feel good. Without them user miss port all the time.

## Events you use

```ts
graph.on("node:click", ({ node, e }) => {});
graph.on("node:dblclick", ({ node }) => {});
graph.on("edge:connected", ({ edge, isNew }) => {
  if (isNew) {
    /* save it */
  }
});
graph.on("edge:removed", ({ edge }) => {});
graph.on("node:moved", ({ node }) => {});
graph.on("node:change:data", ({ node, current }) => {}); // react to setData
graph.on("blank:click", () => graph.cleanSelection?.());
graph.on("cell:contextmenu", ({ cell, e }) => {
  e.preventDefault();
});
graph.on("node:mouseenter", ({ node }) => {
  /* show port / tool */
});
graph.on("node:mouseleave", ({ node }) => {
  /* hide */
});
```

`edge:connected` with `isNew` = right place to commit new drawn edge to app state. Always `graph.off(...)` or `graph.dispose()` on teardown.

## Plugins (all from `@antv/x6`)

In v3 all plugin come from `@antv/x6`. Attach with `graph.use(new Plugin(...))`.

```ts
import { Graph, Selection, Snapline, Transform, History, Clipboard, Keyboard } from "@antv/x6";

graph.use(new Selection({ rubberband: true, showNodeSelectionBox: true }));
graph.use(new Snapline({ enabled: true, sharp: true }));
graph.use(new Transform({ resizing: true, rotating: true })); // resize/rotate handle
graph.use(new History({ enabled: true })); // undo/redo
graph.use(new Clipboard());
graph.use(new Keyboard({ enabled: true }));

// shortcuts (Keyboard plugin)
graph.bindKey(["meta+z", "ctrl+z"], () => {
  graph.canUndo() && graph.undo();
  return false;
});
graph.bindKey(["meta+shift+z", "ctrl+y"], () => {
  graph.canRedo() && graph.redo();
  return false;
});
graph.bindKey(["meta+c", "ctrl+c"], () => {
  const c = graph.getSelectedCells();
  c.length && graph.copy(c);
  return false;
});
graph.bindKey(["meta+v", "ctrl+v"], () => {
  !graph.isClipboardEmpty() && graph.paste({ offset: 32 });
  return false;
});
graph.bindKey(["backspace", "delete"], () => {
  graph.removeCells(graph.getSelectedCells());
  return false;
});
```

Selection API: `graph.getSelectedCells()`, `graph.select(cell)`, `graph.cleanSelection()`. History API: `graph.undo()/redo()/canUndo()/canRedo()`.

MiniMap, Export, Dnd, Stencil also come from `@antv/x6` — see `references/serialization-layout.MD`.

## Pan and zoom

**v3 turn panning ON by default** (drag blank canvas to pan). Want modifier or change?

```ts
const graph = new Graph({
  container,
  panning: { enabled: true, modifiers: "space" }, // hold space to pan
  mousewheel: { enabled: true, modifiers: ["ctrl", "meta"], zoomAtMousePosition: true },
});
graph.zoom(0.2); // relative
graph.zoomTo(1); // absolute
graph.zoomToFit({ padding: 20, maxScale: 1 });
graph.centerContent();
```

Add Scroller plugin = X6 turn off `panning` by itself to dodge conflict. Do not run both.
