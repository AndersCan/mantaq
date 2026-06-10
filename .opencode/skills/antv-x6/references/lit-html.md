# lit-html node content

X6 has no lit-html package. Not need one. X6 v3 ship built-in **`html` shape**. It take an `html` function that return a DOM element. lit-html `render(template, container)` write into any element. So: `html(node)` make a `<div>`, render lit template into it. Done. That the whole bridge.

## What inside

- Basic html node with lit-html
- Re-render when data change
- Button inside node
- Custom html shape with ports
- toJSON warning

## Basic html node with lit-html

```ts
import { Graph } from "@antv/x6";
import { html, render } from "lit-html";

const graph = new Graph({ container, autoResize: true });

graph.addNode({
  shape: "html",
  x: 80,
  y: 80,
  width: 160,
  height: 60,
  data: { label: "Step 1", status: "todo" },
  html(node) {
    const root = document.createElement("div");
    renderCard(root, node); // draw lit template into root
    return root; // X6 mount this element
  },
});

function renderCard(root: HTMLElement, node: any) {
  const { label, status } = node.getData() ?? {};
  render(
    html`
      <div
        style="
        width:100%;height:100%;box-sizing:border-box;
        display:flex;align-items:center;justify-content:center;
        border-radius:6px;background:#fff;
        border:2px solid ${status === "done" ? "#52c41a" : "#5F95FF"};
      "
      >
        ${label}
      </div>
    `,
    root,
  );
}
```

`node.getData()` = read business data. lit `render` cheap to call again — it diff, not rebuild. So re-render = just call `render` into same `root`.

## Re-render when data change

X6 not auto re-run your `html` function when data change. You wire it. Keep the `root` element, re-render on `node:change:data`.

Cleanest = stash root on the node, re-render on change:

```ts
function makeHtmlNode(graph: Graph, opts: { x: number; y: number; data: any }) {
  const node = graph.addNode({
    shape: "html",
    x: opts.x,
    y: opts.y,
    width: 160,
    height: 60,
    data: opts.data,
    html(node) {
      const root = document.createElement("div");
      (node as any).__root = root; // stash for later
      renderCard(root, node);
      return root;
    },
  });
  return node;
}

// one listener for all html nodes
graph.on("node:change:data", ({ node }) => {
  const root = (node as any).__root as HTMLElement | undefined;
  if (root) renderCard(root, node);
});

// now this update the view:
node.setData({ label: "Step 1", status: "done" }); // border turn green
```

Why this work: lit `render` into the same container diff old vs new template, patch only changed bits. So `setData` -> listener -> `render` = fast targeted update. No node rebuild.

## Button inside node

html node can hold real interactive HTML. lit-html `@click` bind handler. But X6 also pan/select on pointer — stop propagation so click not start a drag.

```ts
function renderCard(root: HTMLElement, node: any) {
  const { label, count = 0 } = node.getData() ?? {};
  render(
    html`
      <div
        style="width:100%;height:100%;display:flex;gap:8px;align-items:center;
                  justify-content:center;background:#fff;border:1px solid #ddd;border-radius:6px;"
      >
        <span>${label}: ${count}</span>
        <button
          @click=${(e: Event) => {
            e.stopPropagation(); // stop X6 eating the click
            node.setData({ ...node.getData(), count: count + 1 });
          }}
        >
          +1
        </button>
      </div>
    `,
    root,
  );
}
```

`setData` fire `node:change:data` -> listener re-render -> count update. Loop closed.

## Custom html shape with ports

Repeat html node a lot? Register custom shape. Bake in size, ports, the render. Then just `addNode({ shape: 'lit-card', data })`.

```ts
import { Graph } from "@antv/x6";
import { html, render } from "lit-html";

const PORTS = {
  groups: {
    in: {
      position: "top",
      attrs: { circle: { r: 5, magnet: true, stroke: "#5F95FF", fill: "#fff" } },
    },
    out: {
      position: "bottom",
      attrs: { circle: { r: 5, magnet: true, stroke: "#5F95FF", fill: "#fff" } },
    },
  },
  items: [
    { id: "in1", group: "in" },
    { id: "out1", group: "out" },
  ],
};

Graph.registerNode(
  "lit-card",
  {
    inherit: "html",
    width: 160,
    height: 60,
    ports: PORTS,
    html(node: any) {
      const root = document.createElement("div");
      node.__root = root;
      render(cardTemplate(node), root);
      return root;
    },
  },
  true,
);

function cardTemplate(node: any) {
  const { label, status } = node.getData() ?? {};
  return html` <div
    style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;
                background:#fff;border-radius:6px;border:2px solid ${status === "done"
      ? "#52c41a"
      : "#5F95FF"};"
  >
    ${label}
  </div>`;
}

// wire re-render once, globally
graph.on("node:change:data", ({ node }: any) => {
  if (node.__root) render(cardTemplate(node), node.__root);
});

graph.addNode({ shape: "lit-card", x: 80, y: 80, data: { label: "A", status: "todo" } });
```

Port magnet sit on node edge. Edge connect to them like any node. Connect rules = `references/interaction.MD`.

## toJSON warning

`html` function not serialize. `graph.toJSON()` save node `data`, `shape`, position — but not the function. Fine if you **register** the shape (function live in registry, not in JSON). So for save/load: always go through `Graph.registerNode('lit-card', { inherit: 'html', html(...) {...} })`, store only `shape: 'lit-card'` plus `data`. On load, register first, then `fromJSON`. Inline `html(node){...}` on a one-off `addNode` = lost on reload. Register = safe. See serialization-layout.MD.
