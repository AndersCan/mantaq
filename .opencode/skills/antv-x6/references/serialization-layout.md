# Save, load, layout, export, palette

## What inside

- Save / load (toJSON / fromJSON)
- Fit and center view
- Auto-layout for DAG (Dagre)
- Export PNG / SVG / JPEG
- MiniMap
- Drag-in palette: Dnd and Stencil

## Save / load (toJSON / fromJSON)

Graph turn into plain object. Store it. Reload it.

```ts
const data = graph.toJSON(); // -> { cells: [...] }
localStorage.setItem("graph", JSON.stringify(data));

graph.fromJSON(JSON.parse(localStorage.getItem("graph")!));
graph.centerContent(); // fromJSON not auto-fit
```

`fromJSON` take `{ cells }` or friendlier `{ nodes: [...], edges: [...] }`. Custom shape (by `shape` name) MUST be **registered before** `fromJSON`. Else those cells render default or blank. Business data from `setData` round-trip inside each cell `data`. For lit-html node: register the `html` shape first (lithtml.MD, toJSON warning), then `fromJSON`.

## Fit and center view

After load or after auto-layout, content often off-screen. Look like broke. Not broke.

```ts
graph.centerContent();
graph.zoomToFit({ padding: 20, maxScale: 1 }); // fit all, do not zoom past 1x
```

## Auto-layout for DAG (Dagre)

X6 ship no layout algorithm (that G6 job). For flowchart / DAG use `dagre`. Compute, then write position back.

```ts
import dagre from "@dagrejs/dagre";

function layout(graph: Graph, dir: "TB" | "LR" = "TB") {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: dir, nodesep: 40, ranksep: 60 });
  g.setDefaultEdgeLabel(() => ({}));

  graph.getNodes().forEach((n) => {
    const { width, height } = n.size();
    g.setNode(n.id, { width, height });
  });
  graph.getEdges().forEach((e) => {
    g.setEdge(e.getSourceCellId()!, e.getTargetCellId()!);
  });

  dagre.layout(g);

  graph.batchUpdate(() => {
    // batch = one redraw, not many
    g.nodes().forEach((id) => {
      const node = graph.getCellById(id) as any;
      const { x, y } = g.node(id);
      node?.position(x - node.size().width / 2, y - node.size().height / 2);
    });
  });
  graph.centerContent();
}
```

Many cell change at once? Wrap in `graph.batchUpdate(() => { ... })`. X6 redraw once. History record one undo step.

## Export PNG / SVG / JPEG

`Export` plugin from `@antv/x6`.

```ts
import { Graph, Export } from "@antv/x6";
graph.use(new Export());

graph.exportPNG("diagram.png", { padding: 20, backgroundColor: "#fff" });
graph.exportSVG("diagram.svg");
graph.exportJPEG("diagram.jpeg", { quality: 0.9 });

// or get data, no download:
graph.toPNG(
  (dataUri) => {
    /* upload / preview */
  },
  { padding: 20 },
);
```

## MiniMap

Need own DOM container. Give it size.

```ts
import { Graph, MiniMap } from "@antv/x6";
graph.use(
  new MiniMap({
    container: document.getElementById("minimap")!,
    width: 200,
    height: 160,
    padding: 10,
  }),
);
```

## Drag-in palette: Dnd and Stencil

**Dnd** = drag a node prototype from anywhere onto canvas. **Stencil** = ready-made sidebar (group, search, collapse) built on Dnd. Want palette? Prefer Stencil.

```ts
import { Graph, Dnd } from "@antv/x6";

const dnd = new Dnd({ target: graph }); // target = the Graph
// on mousedown of palette item:
function startDrag(e: MouseEvent) {
  const node = graph.createNode({ shape: "process", label: "New" }); // create, not add
  dnd.start(node, e); // X6 add on drop
}
```

```ts
import { Graph, Stencil } from "@antv/x6";

const stencil = new Stencil({
  title: "Components",
  target: graph,
  stencilGraphWidth: 200,
  groups: [{ name: "basic", title: "Basic" }],
  layoutOptions: { columns: 2, columnWidth: 90, rowHeight: 55 },
});
document.getElementById("stencil")!.appendChild(stencil.container);
stencil.load(
  [
    graph.createNode({ shape: "process", label: "Process" }),
    graph.createNode({ shape: "rect", label: "Rect" }),
  ],
  "basic",
);
```

Note `graph.createNode(...)` = make detached Node (not on canvas). That what Dnd and Stencil eat. Real `addNode` happen on drop.
