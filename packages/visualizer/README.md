# @mantaq/visualizer

Actor model state machine visualizer using Lit and nanostores.

## Installation

```bash
npm install @mantaq/visualizer
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
- `computeLayout(graph)` - Compute ELK.js layout
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
- `$selectedNodeId` - Selected node
- `$zoom` / `$pan` - Viewport state
- `$layoutError` - Layout error message

### Components

- `<actor-graph>` - Main container with pan/zoom/keyboard
- `<state-node>` - Individual state node

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
