# @mantaq/viz

Actor model state machine visualizer using X6 and Lit web components.

## Installation

```bash
pnpm add @mantaq/viz
```

## Usage

```html
<mantaq-viz id="viz"></mantaq-viz>
<script type="module">
  import "@mantaq/viz";
  const el = document.getElementById("viz");
  el.actor = myActor;
</script>
```

## API

### Exports

```ts
buildGraph(actor, internalIds?) → ActorGraph
```

Convert actor snapshot to graph nodes and edges. Optionally pass `internalIds` to mark internal transitions.

```ts
computeNodePositions(nodes, edges, options?) → Map<string, { x, y }>
```

Compute dagre layout positions for nodes/edges.

```ts
renderActorFlow(parent, options) → ActorFlowInstance
```

Render a full actor flow graph into a container element. Returns instance with `update(graph, layoutOptions?)` and `destroy()` methods.

```ts
MantaqViz; // custom element <mantaq-viz>
```

### Types

```ts
interface GraphNode {
  id: string;
  label: string;
  isActive: boolean;
  isFinal: boolean;
  isInitial?: boolean;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  isActive: boolean;
  isInternal?: boolean;
  isUndetermined?: boolean;
  effectLabel?: string;
  timerMs?: number;
}

interface ActorGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface LayoutOptions {
  direction?: "TB" | "LR";
  nodeWidth?: number;
  nodeHeight?: number;
  nodesep?: number;
  ranksep?: number;
  router?: "normal" | "orth" | "manhattan" | "metro" | "er";
}
```

## `<mantaq-viz>` Component

### Props

- `el.actor` — set the actor to visualize

### Features

- **Click edges** to trigger transitions (fires the event on the actor)
- **Effect edges** (amber dashed) — advance timer on click
- **Undetermined edges** (red dashed) — transitions where target couldn't be resolved
- **Transition animation** — green flash on the fired edge
- **Tooltips** on nodes and edges showing state/event details
- **Settings panel** — direction (LR/TB), router (normal/orth/manhattan/metro/er), edge length

### Keyboard Shortcuts

| Key       | Action          |
| --------- | --------------- |
| `+` / `=` | Zoom in         |
| `-`       | Zoom out        |
| `0`       | Reset view      |
| `F`       | Fit to viewport |

## Development

```bash
vp test
vp check
```
