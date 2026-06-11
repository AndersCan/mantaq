# @mantaq/viz

Actor model state machine visualizer using React Flow.

## Installation

```bash
pnpm add @mantaq/viz
```

Requires React >= 18.

## Usage

```tsx
import { Actor, state, event } from "@mantaq/core";
import { ActorFlow, buildGraph } from "@mantaq/viz";
import type { ActorGraph } from "@mantaq/viz";
import { useState } from "react";

function MyFlow() {
  const [graph, setGraph] = useState<ActorGraph>(() => buildGraph(myActor));

  const sendEvent = (eventName) => {
    myActor.send(someEvent);
    setGraph(buildGraph(myActor));
  };

  return (
    <div style={{ height: 400 }}>
      <ActorFlow graph={graph} />
    </div>
  );
}
```

## API

### Functions

- `buildGraph(actor)` - Convert actor snapshot to graph nodes/edges
- `collectActiveStates(snapshot, prefix, activeSet)` - Collect active state IDs from snapshot
- `actorGraphToFlow(graph, opts?)` - Convert ActorGraph to React Flow nodes/edges
- `toReactFlowNodes(nodes, edges?, opts?)` - Convert graph nodes to React Flow nodes
- `toReactFlowEdges(edges)` - Convert graph edges to React Flow edges
- `computeNodePositions(nodes, edges, opts?)` - Topological sort layout

### Components

- `ActorFlow` - Main React Flow renderer with pan/zoom/minimap
- `nodeTypes` - `{ state: StateNodeComponent }`
- `edgeTypes` - `{ "state-edge": StateEdgeComponent }`

## Development

```bash
vp test
vp check
```
