# Edges

## What inside

- Make edge
- Connect to port vs node
- Arrowhead
- Label
- Router vs connector (confusing pair)
- Vertices
- Custom registered edge
- Edge tools (drag handles)

## Make edge

`source`/`target` take: Node instance, id string, `{ cell, port }`, or free `{ x, y }` point.

```ts
graph.addEdge({ source: nodeA, target: nodeB });
graph.addEdge({ source: "node-1", target: "node-2" });
graph.addEdge({
  source: { cell: "node-1", port: "out1" },
  target: { cell: "node-2", port: "in1" },
});
graph.addEdge({ source: nodeA, target: { x: 400, y: 200 } }); // dangling end
```

## Connect to port vs node

Node has port? Connect port to port. Use `{ cell, port }` (above). No port? Edge stick to node boundary (from anchor plus connectionPoint). Drag-to-connect plus validate = in `references/interaction.MD`. That where hard part live.

## Arrowhead

Edge path = `line` selector. Arrow go on `line/sourceMarker` and `line/targetMarker`.

```ts
graph.addEdge({
  source: a,
  target: b,
  attrs: {
    line: {
      stroke: "#A2B1C3",
      strokeWidth: 2,
      targetMarker: { name: "block", width: 12, height: 8 }, // arrow at target
      sourceMarker: null, // none at source
    },
  },
});
```

Built-in markers: `block`, `classic`, `diamond`, `cross`, `async`, `path` (custom `d`), `circle`, `ellipse`. Dashed: `strokeDasharray: 5`. Marching ants: `strokeDasharray: 5` plus CSS animation on `line/style/animation`.

## Label

Edge take many labels. Place along path (`0`–`1` fraction).

```ts
graph.addEdge({
  source: a,
  target: b,
  labels: [
    {
      position: 0.5,
      attrs: {
        label: { text: "yes", fill: "#333", fontSize: 12 },
        body: { fill: "#fff", stroke: "#ddd", rx: 4, ry: 4 }, // box behind text
      },
    },
  ],
});

edge.appendLabel({ position: 0.8, attrs: { label: { text: "late" } } });
edge.setLabels(["simple text"]); // shorthand
```

## Router vs connector (confusing pair)

Different jobs. People mix them up always.

- **Router** = pick the bend points (where line turn). Built-in: `normal` (straight), `orth` (right angle), `manhattan` (right angle, dodge nodes — best for flowchart), `metro` (subway look), `er`.
- **Connector** = draw path through those points (corner look). Built-in: `normal`, `rounded` (round corner), `smooth` (bezier), `jumpover` (little hop where edges cross).

```ts
graph.addEdge({
  source: a,
  target: b,
  router: { name: "manhattan", args: { padding: 10 } },
  connector: { name: "rounded", args: { radius: 8 } },
});
```

Set default for all drawn edges in Graph `connecting` config (interaction.MD). Memory trick: **router pick turns, connector draw corners.**

## Vertices

Hand-set waypoints. Router may add more on top.

```ts
graph.addEdge({
  source: a,
  target: b,
  vertices: [
    { x: 200, y: 80 },
    { x: 200, y: 200 },
  ],
});
edge.setVertices([{ x: 250, y: 120 }]);
edge.getVertices();
```

## Custom registered edge

Same as custom node. Register once. Reuse by name. Good for house edge style.

```ts
import { Graph } from "@antv/x6";

Graph.registerEdge(
  "flow-edge",
  {
    inherit: "edge",
    attrs: {
      line: { stroke: "#A2B1C3", strokeWidth: 2, targetMarker: { name: "block", size: 8 } },
    },
    router: { name: "manhattan" },
    connector: { name: "rounded" },
    zIndex: 0,
  },
  true,
);

graph.addEdge({ shape: "flow-edge", source: a, target: b });
```

Want drag-connect to make this edge? Return it from `connecting.createEdge` (interaction.MD).

## Edge tools (drag handles)

Add reshape handles plus delete button on hover:

```ts
graph.on("edge:mouseenter", ({ edge }) => {
  edge.addTools([
    "vertices", // drag waypoint dots
    "segments", // drag whole segment
    { name: "button-remove", args: { distance: -30 } },
  ]);
});
graph.on("edge:mouseleave", ({ edge }) => edge.removeTools());
```

Built-in edge tools: `vertices`, `segments`, `boundary`, `button-remove`, `source-arrowhead`, `target-arrowhead` (drag end to reconnect).
