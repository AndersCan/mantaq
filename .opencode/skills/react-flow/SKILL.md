---
name: react-flow
description: Build React Flow node-based diagrams. Custom nodes, edges, handles, layouts. Use when creating flow editors, node graphs, or visual node-based UIs.
argument-hint: "[description of diagram to build]"
allowed-tools: Read Grep Glob Bash Edit Write
---

# React Flow Diagram Builder

Build node-based UIs with `@xyflow/react`. Nodes, edges, handles — diagram stuff.

## Setup

Install package:

```bash
npm install @xyflow/react
```

Import CSS — mandatory, no work without it:

```tsx
import { ReactFlow, Background, Controls, MiniMap } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
```

Parent container need width+height. React Flow use dimensions.

## Core Anatomy

Three things: nodes, edges, viewport.

### Nodes

Nodes = array objects. Each need `id`, `position`, `data`.

```tsx
const nodes = [
  {
    id: "n1",
    type: "input", // built-in: 'input', 'output', 'default'
    position: { x: 0, y: 0 },
    data: { label: "Node 1" },
  },
  {
    id: "n2",
    position: { x: 200, y: 100 },
    data: { label: "Node 2" },
  },
];
```

### Edges

Edges = connect nodes. Need `id`, `source`, `target`.

```tsx
const edges = [
  {
    id: "e1",
    source: "n1", // node id where edge starts
    target: "n2", // node id where edge ends
    type: "step", // 'default', 'step', 'straight', 'smoothstep'
    label: "connects",
  },
];
```

### Render Flow

```tsx
export default function App() {
  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      <ReactFlow nodes={nodes} edges={edges} fitView>
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
```

## Custom Nodes

Create React component. React Flow wrap it — inject id, position, data, drag, select.

```tsx
import { Handle, Position } from "@xyflow/react";

export function TextUpdaterNode({ data }) {
  return (
    <div className="text-updater-node">
      <label htmlFor="text">Text:</label>
      <input id="text" name="text" className="nodrag" />
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

Define `nodeTypes` outside component — prevent re-renders:

```tsx
const nodeTypes = { textUpdater: TextUpdaterNode };

// Then pass to ReactFlow
<ReactFlow nodeTypes={nodeTypes} />;
```

Use custom node in node array:

```tsx
const nodes = [
  {
    id: "n1",
    type: "textUpdater", // matches key in nodeTypes
    position: { x: 0, y: 0 },
    data: { value: 42 },
  },
];
```

## Handles

Handles = connection points on nodes. Import `Handle` from `@xyflow/react`.

Props: `type` ("source" | "target"), `position` (Position.Top, Bottom, Left, Right), `id` (unique per node).

### Multiple handles

Multiple source/target handles need unique `id`:

```tsx
<Handle type="target" position={Position.Top} />
<Handle type="source" position={Position.Right} id="a" />
<Handle type="source" position={Position.Bottom} id="b" />
```

Connect to specific handle via edge:

```tsx
{ id: 'e1', source: 'n1', sourceHandle: 'a', target: 'n2' }
```

### Custom handles

Wrap custom component with Handle. Hide built-in style:

```tsx
<Handle
  type="source"
  position={Position.Right}
  style={{ background: "none", border: "none", width: "1em", height: "1em" }}
>
  <ArrowIcon style={{ pointerEvents: "none", position: "absolute" }} />
</Handle>
```

### Dynamic handles

Change handle count/position dynamically? Call `useUpdateNodeInternals` hook.

### Hide handle

Use `visibility: hidden` or `opacity: 0`. Never `display: none` — React Flow need dimensions.

## Custom Edges

Edge = React component. Render SVG path between nodes.

### Basic custom edge

```tsx
import { BaseEdge, getStraightPath } from "@xyflow/react";

export function CustomEdge({ id, sourceX, sourceY, targetX, targetY }) {
  const [edgePath] = getStraightPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });
  return <BaseEdge id={id} path={edgePath} />;
}
```

Define edgeTypes outside component:

```tsx
const edgeTypes = { "custom-edge": CustomEdge };

<ReactFlow edgeTypes={edgeTypes} />;
```

Use in edge array:

```tsx
{ id: 'e1', source: 'n1', target: 'n2', type: 'custom-edge' }
```

### Path utility functions

- `getBezierPath` — curved bezier
- `getSimpleBezierPath` — simple curve
- `getSmoothStepPath` — right-angle steps
- `getStraightPath` — straight line

All return `[path, labelX, labelY]`.

### Custom SVG paths

For exotic shapes, build SVG path string yourself. Commands:

- `M x y` — move to
- `L x y` — line to
- `Q cx cy x y` — quadratic bezier curve

Start at `sourceX, sourceY` from props. End at `targetX, targetY`.

## Interactivity

### Controlled flow (recommended)

Use state hooks for nodes/edges:

```tsx
const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
```

Pass handlers:

```tsx
<ReactFlow
  nodes={nodes}
  edges={edges}
  onNodesChange={onNodesChange}
  onEdgesChange={onEdgesChange}
  onConnect={onConnect}
/>
```

### Uncontrolled flow

Pass initial nodes/edges, no state. React Flow manage internally.

### onConnect callback

Fired when user connects two handles:

```tsx
const onConnect = useCallback((params) => {
  setEdges((eds) => addEdge(params, eds));
}, []);
```

## Layouting

Auto-layout with libraries:

- **dagre** — directed graph layout
- **elkjs** — complex layouts, multiple algorithms

Pattern: compute positions, then set nodes.

```tsx
import dagre from "dagre";

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));
dagreGraph.setGraph({ rankdir: "TB" });

// Add nodes/edges to graph, run layout, extract positions
dagre.layout(dagreGraph);

// Map positions back to nodes
```

## Utility Components

| Component         | Purpose                      |
| ----------------- | ---------------------------- |
| `<Background />`  | Grid/dot pattern behind flow |
| `<Controls />`    | Zoom/fit buttons             |
| `<MiniMap />`     | Overview minimap             |
| `<Panel />`       | Floating UI panels           |
| `<NodeToolbar />` | Toolbar attached to node     |

## Hooks

| Hook                       | Purpose                          |
| -------------------------- | -------------------------------- |
| `useReactFlow()`           | Instance methods (getNodes, etc) |
| `useNodes()`               | Current nodes                    |
| `useEdges()`               | Current edges                    |
| `useNodeId()`              | Current node's id (inside node)  |
| `useNodesData()`           | Read other nodes' data           |
| `useUpdateNodeInternals()` | Update handle positions          |
| `useKeyPress()`            | Keyboard input                   |
| `useViewport()`            | Current viewport state           |

## Common Patterns

### Save/restore flow

```tsx
const { getNodes, getEdges } = useReactFlow();

const save = () => {
  const flow = { nodes: getNodes(), edges: getEdges() };
  localStorage.setItem("flow", JSON.stringify(flow));
};
```

### Drag and drop

Use `onDragOver` (preventDefault) + `onDrop` (add node at drop position).

### Validation

Use `isValidConnection` prop on ReactFlow. Return boolean per connection attempt.

## TypeScript

Use generic types:

```tsx
import type { Node, Edge } from '@xyflow/react';

type MyNode = Node<{ label: string }, 'textUpdater'>;
type MyEdge = Edge;

const nodes: MyNode[] = [...];
```

## Gotchas

- CSS import mandatory — no style, no work
- Parent container need explicit width+height
- `nodeTypes`/`edgeTypes` define outside component
- Multiple handles need unique `id`
- Dynamic handles need `useUpdateNodeInternals`
- Hide handle with `visibility: hidden`, not `display: none`

## Docs

- Custom nodes: https://reactflow.dev/learn/customization/custom-nodes
- Handles: https://reactflow.dev/learn/customization/handles
- Custom edges: https://reactflow.dev/learn/customization/custom-edges
- Building flow: https://reactflow.dev/learn/concepts/building-a-flow
- API ref: https://reactflow.dev/api-reference
