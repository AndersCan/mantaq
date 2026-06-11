# @mantaq/viz

Actor model state machine visualizer using Lit and nanostores.

## Installation

```bash
pnpm add @mantaq/viz
```

## Usage

### Basic Usage

```ts
import { setActor } from "@mantaq/viz";

// Set the actor to visualize
setActor(myActor);
```

### HTML

```html
<actor-graph></actor-graph>
```

### Live Updates with `startActorSync`

```ts
import { startActorSync } from "@mantaq/viz";

// Auto-sync graph when actor state changes
startActorSync();
```

## API

### Functions

- `buildGraph(actor)` - Convert actor snapshot to graph nodes/edges
- `flattenNodes(graph)` - Flatten nested graph nodes
- `computeLayout(graph)` - Compute ELK.js layout
- `defaultPositions(nodes, dimensions)` - Compute default node positions
- `collectEdges(graph)` - Collect all edges from graph
- `getTransitionsForNode(graph, nodeId)` - Get transitions for a node
- `estimateNodeWidth(label, minWidth)` - Estimate node width from label
- `setActor(actor)` - Set actor in store and trigger layout
- `updateLayout(graph)` - Recompute layout
- `selectNode(nodeId)` - Select a node
- `setViewport(width, height)` - Set viewport dimensions
- `setZoom(value)` - Set zoom level
- `zoomIn()` / `zoomOut()` - Zoom controls
- `zoomToFit()` - Fit graph to viewport
- `resetView()` - Reset zoom and pan
- `startActorSync()` - Auto-sync graph when actor state changes
- `applyDarkTheme()` / `removeDarkTheme()` - Toggle dark mode

### Stores

- `$actor` - Current actor
- `$graph` - Computed graph
- `$layout` - Computed layout result
- `$layoutLoading` - Whether layout computation is in progress
- `$selectedNodeId` - Selected node ID
- `$selectedNode` - Selected node object
- `$flatNodes` - Flattened list of positioned nodes
- `$edges` - Positioned edges
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
