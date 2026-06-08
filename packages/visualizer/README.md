# @mantaq/visualizer

Actor model state machine visualizer using Lit and nanostores.

## Installation

```bash
pnpm add @mantaq/visualizer
```

## Usage

### Basic Usage

```ts
import { ActorGraphComponent, setActor } from "@mantaq/visualizer";

// Register the component
customElements.define("actor-graph", ActorGraphComponent);

// Set the actor to visualize
setActor(myActor);
```

### HTML

```html
<actor-graph></actor-graph>
```

## API

### Functions

- `buildGraph(actor)` - Convert actor snapshot to graph nodes/edges
- `flattenNodes(graph)` - Flatten nested graph nodes
- `computeLayout(graph)` - Compute ELK.js layout
- `defaultPositions(nodes, dimensions)` - Compute default node positions
- `collectEdges(graph)` - Collect all edges from graph
- `getTransitionsForNode(graph, nodeId)` - Get transitions for a node
- `setActor(actor)` - Set actor in store and trigger layout
- `selectNode(nodeId)` - Select a node
- `zoomIn()` / `zoomOut()` - Zoom controls
- `zoomToFit()` - Fit graph to viewport
- `resetView()` - Reset zoom and pan
- `applyDarkTheme()` / `removeDarkTheme()` - Toggle dark mode

### Stores

- `$actor` - Current actor
- `$graph` - Computed graph
- `$layout` - Computed layout result
- `$selectedNodeId` - Selected node ID
- `$selectedNode` - Selected node object
- `$zoom` / `$pan` - Viewport state
- `$viewport` - Viewport dimensions
- `$graphDimensions` - Graph dimensions
- `$layoutError` - Layout error message

### Components

- `<actor-graph>` - Main container with pan/zoom/keyboard
- `<state-node>` - Individual state node
- `renderEdge(edge)` - Edge rendering function

## Keyboard Shortcuts

- `+` / `=` - Zoom in
- `-` - Zoom out
- `0` - Reset view
- `F` - Zoom to fit

## Development

```bash
vp test
vp check
```
