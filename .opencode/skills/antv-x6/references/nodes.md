# Nodes

## What inside

- Make node
- `attrs` (style)
- Custom registered shape (the reuse way)
- Ports and groups
- Update node
- Node tools (delete button)

## Make node

Two ways. Prefer object. Object serialize, object idiomatic.

```ts
// Object way. Use this.
const rect = graph.addNode({
  shape: "rect", // default. can skip.
  x: 100,
  y: 100,
  width: 120,
  height: 48,
  label: "Hello",
  attrs: {
    body: { fill: "#EFF4FF", stroke: "#5F95FF", strokeWidth: 1, rx: 6, ry: 6 },
    label: { fill: "#262626", fontSize: 13 },
  },
});

// Constructor way. Use when need Node before add (like for Dnd).
import { Shape } from "@antv/x6";
const circle = new Shape.Circle({ x: 300, y: 100, width: 60, height: 60, label: "C" });
graph.addNode(circle);
```

Built-in shapes: `rect`, `circle`, `ellipse`, `polygon`, `polyline`, `path`, `image`, `text-block`, `html`. Give node real `id` with meaning (`addNode({ id: 'step-1' })`). Skip it = X6 make random UUID.

## `attrs` (style)

`attrs` = CSS for node SVG. Key = selector (named SVG part). Value = SVG attribute. Built-in `rect` has two parts: `body` (the `<rect>`), `label` (the `<text>`).

```ts
node.attr("body/fill", "#ff0000"); // path way
node.attr({ label: { text: "New", fill: "#fff" } }); // object way
const fill = node.attr("body/fill"); // read
```

Common SVG attrs: `fill`, `stroke`, `strokeWidth`, `strokeDasharray`, `rx`/`ry` (round corner), `opacity`, `fontSize`, `fontFamily`, `textAnchor`, `refWidth`/`refHeight` (size relative to node), `pointerEvents`.

## Custom registered shape (the reuse way)

Do NOT repeat `attrs` on every node. Big waste. Register shape once. Use by name. This the main node idiom.

```ts
import { Graph } from "@antv/x6";

Graph.registerNode(
  "process", // shape name
  {
    inherit: "rect", // base
    width: 140,
    height: 48,
    markup: [
      { tagName: "rect", selector: "body" },
      { tagName: "text", selector: "label" },
    ],
    attrs: {
      body: { rx: 6, ry: 6, fill: "#fff", stroke: "#5F95FF", strokeWidth: 1 },
      label: { fontSize: 13, fill: "#262626" },
    },
    ports: PORTS, // share one ports config. see below.
  },
  true, // overwrite if exist. good with hot reload.
);

graph.addNode({ shape: "process", x: 80, y: 80, label: "Validate" });
```

Custom `markup` make your own selectors. Node with header bar plus body:

```ts
markup: [
  { tagName: 'rect', selector: 'body' },
  { tagName: 'rect', selector: 'header' },
  { tagName: 'text', selector: 'title' },
],
attrs: {
  body:   { refWidth: '100%', refHeight: '100%', fill: '#fff', stroke: '#ddd' },
  header: { refWidth: '100%', height: 24, fill: '#5F95FF' },
  title:  { refX: 8, refY: 12, fontSize: 12, fill: '#fff', textAnchor: 'start', textVerticalAnchor: 'middle' },
},
```

`refWidth: '100%'` / `refHeight` = child fill node. `refX`/`refY` = position relative to node. This way you not hardcode pixels.

Node need real HTML (button, badge, form)? Stop fighting SVG markup. Use `html` shape with lit-html. See `references/lithtml.MD`.

## Ports and groups

Port = magnet. Edge connect here. Define **groups** (shared spot plus style). Define **items** (each port). Reuse one `PORTS` across shapes.

```ts
const PORTS = {
  groups: {
    in: {
      position: "top",
      attrs: { circle: { r: 5, magnet: true, stroke: "#5F95FF", strokeWidth: 1, fill: "#fff" } },
    },
    out: {
      position: "bottom",
      attrs: { circle: { r: 5, magnet: true, stroke: "#5F95FF", strokeWidth: 1, fill: "#fff" } },
    },
  },
  items: [
    { id: "in1", group: "in" },
    { id: "out1", group: "out" },
  ],
};
```

`magnet: true` = port can start/end edge. No magnet = no connect. `position`: `top`/`right`/`bottom`/`left`/`absolute`, or layout name (`line`, `ellipse`). Many ports in group spread auto.

Port API at runtime:

```ts
node.addPort({ group: "out", id: "out2" });
node.removePort("out2");
node.getPorts();
node.portProp("in1", "attrs/circle/fill", "#31d0c6"); // restyle one port
```

Common UX: hide port till hover. Toggle `circle/style/visibility` in `node:mouseenter` / `node:mouseleave` (see interaction.MD). Validate which port connect = in `references/interaction.MD`, `connecting`.

## Update node

Change model. Never touch SVG. Methods:

```ts
node.position(200, 120); // move absolute
node.translate(10, 0); // move relative
node.resize(160, 60);
node.setData({ status: "done" }); // your business data
node.getData();
node.attr("body/stroke", "#52c41a");
node.setProp("label", "New label");
graph.removeNode(node); // or node.remove()
```

Put business state in `setData`/`getData`. Then react to it. Drive `attr` from data in event handler. For html node, drive lit template from data (lithtml.MD).

## Node tools (delete button)

Tool = widget on cell view. Add delete button plus boundary on hover:

```ts
graph.on("node:mouseenter", ({ node }) => {
  node.addTools([
    {
      name: "boundary",
      args: { padding: 4, attrs: { stroke: "#5F95FF", strokeWidth: 1, fill: "none" } },
    },
    { name: "button-remove", args: { x: "100%", y: 0, offset: { x: -6, y: 6 } } },
  ]);
});
graph.on("node:mouseleave", ({ node }) => node.removeTools());
```

Built-in node tools: `button-remove`, `boundary`, `button`. Edge tools different — see edges.MD.
