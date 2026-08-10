---
name: antv-x6
description: Build graph and diagram editors with AntV X6 v3 (@antv/x6) — flowcharts, DAGs, ER diagrams, workflow canvases, node-link views, with lit-html for custom node content. Use this skill whenever the user mentions X6, @antv/x6, "graph editor", "flowchart library", "diagram canvas", "node and edge editor", or is building/debugging an X6 canvas. Especially use it when the canvas renders blank, nodes do not show, edges will not connect, ports/magnets fail, or lit-html node content does not update — X6 docs are thin and these are the traps this skill fixes.
metadata:
  internal: true
---

# AntV X6 (v3, lit-html)

X6 draw graph. Node and edge on canvas. SVG and HTML. This skill = v3 only. Node content = lit-html.

## Canvas blank? Look here first. Most "X6 broke" = one of these.

Check in order:

1. **Container no height.** X6 fill container. Bare `<div>` no CSS height = 0px tall = see nothing. Give height. `style="width:100%;height:600px"`. This cause most blank canvas.
2. **Container not in DOM yet.** Make Graph after element on page. Not before. Ref still null = dead graph.
3. **Node off-screen or no size.** Custom shape no width/height = invisible. Coords off viewport = invisible. Fix: call `graph.centerContent()` or `graph.zoomToFit({ padding: 20 })` after add cells.
4. **Container resize.** Container change size later (tabs, responsive)? Set `autoResize: true`. Else canvas keep old size.

No CSS import in v3. v3 put styles inside. Do NOT `import '@antv/x6/dist/index.css'` — that 404, that v2 thing.

Known-good baseline. Copy this. It work:

```ts
import { Graph } from "@antv/x6";

const graph = new Graph({
  container: document.getElementById("container")!, // must have height
  autoResize: true,
  background: { color: "#F2F7FA" },
  grid: true,
});

const a = graph.addNode({ x: 80, y: 80, width: 100, height: 40, label: "A" });
const b = graph.addNode({ x: 300, y: 200, width: 100, height: 40, label: "B" });
graph.addEdge({ source: a, target: b });
graph.centerContent();
```

## How X6 think (brain model)

- **Data drive view.** You change model (node, edge). X6 redraw SVG by itself, async. Do NOT poke DOM. Change model — `node.attr()`, `node.setData()`, `node.position()` — X6 redraw.
- **`attrs` = CSS for SVG.** Node has named parts (selectors): `body`, `label`. Edge has `line`. `attrs.body.fill` = fill the `<rect>`. `attrs.label.text` = the text.
- **Shape = name in registry.** Built-in: `rect`, `circle`, `ellipse`, `polygon`, `path`, `image`, `edge`, `html`. Custom shape: register once with `Graph.registerNode(name, config)`, then `addNode({ shape: name })`.
- **Port = connect point (magnet).** Edge stick to port, not whole node face. Port set per node. Style by group.
- **lit-html node = `html` shape.** Want real HTML in node (button, badge, form)? Use built-in `html` shape. Give it function that return element. Render lit template into that element. Detail in `references/lithtml.MD`.

## Pick reference. Read the one for the task. Do not guess.

Each file stand alone. Copy-paste examples inside.

- **`references/nodes.MD`** — make node, style with `attrs`, register custom shape, ports and groups, update node, node tools (delete button).
- **`references/edges.MD`** — make edge, arrowhead, label, router vs connector (the confusing two), vertices, edge tools (drag handles).
- **`references/interaction.MD`** — `connecting` config (hardest part): `validateMagnet`, `validateConnection`, `createEdge`, snap, highlight. Plus plugins (Selection, Keyboard, Clipboard, History, Snapline, Transform — all from `@antv/x6`). Plus events. Plus pan and zoom.
- **`references/lithtml.MD`** — custom node content with lit-html. Register `html` shape. Re-render on data change. Buttons inside node. Ports on html node.
- **`references/serialization-layout.MD`** — save/load (`toJSON`/`fromJSON`), fit view, Dagre auto-layout for DAG, export PNG/SVG, MiniMap, Dnd/Stencil drag-in palette.

Task spans many areas (like "lit-html flowchart editor with draggable ports and side palette")? Read many references. Always use the idiom shown there. Do not hand-roll.
