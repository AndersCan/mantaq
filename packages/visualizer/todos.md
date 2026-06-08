# Actor Visualizer — Remaining Tasks

## Completed

- [x] Package scaffolding (package.json, tsconfig, vite.config)
- [x] Graph data model (`graph.ts`) — converts actor snapshots to graph nodes/edges
- [x] ELK.js layout engine (`layout.ts`) — computes hierarchical graph positions
- [x] Nanostores state management (`stores/graph-store.ts`)
- [x] LitElement components (`actor-graph.ts`, `state-node.ts`, `edge.ts`)
- [x] Default theme and styles (`styles.ts`)
- [x] Barrel export (`index.ts`)
- [x] Unit tests for graph module (48 tests passing)
- [x] Type checking and lint passing
- [x] Fixed self-loop bug in edge building
- [x] Fixed active edge detection for hierarchical states
- [x] Fixed edge arrow colors for active edges
- [x] Unified zoom bounds between store and component
- [x] Fixed null edge path handling
- [x] Added layout.ts tests (10 tests)
- [x] Added graph-store.ts tests (16 tests)
- [x] Added edge case tests (6 tests)
- [x] Added integration tests (6 tests)
- [x] Removed dead code (unused exports, styles)
- [x] Consolidated duplicate CSS
- [x] Fixed layout naming and unused params
- [x] Added missing type annotations
- [x] Improved store type safety (zoom bounds, clamping)
- [x] Added error boundary UI
- [x] Improved edge label rendering with background
- [x] Added node tooltips
- [x] Added dark mode support
- [x] Added README documentation

## High Priority

- [x] **Region wrapper nodes** — State-level regions render states directly under parent. Need wrapper nodes for region labels (e.g., "sub" region label above subA/subB)
- [ ] **Actor-level region rendering** — `buildChildGraphs` handles `actor.regions` but no visual distinction from state-level regions
- [x] **Store reactivity wiring** — Components don't yet subscribe to nanostores via `useStore` directive. Need `@nanostores/lit` package
- [x] **Real-time actor sync** — `startActorSync()` exists but not called automatically. Need lifecycle hook to auto-update graph when actor state changes
- [ ] **Edge labels for transitions** — Current edge labels show event IDs but not guard conditions or actions
- [ ] **Keyboard shortcuts documentation** — +/-/0/F shortcuts work but no tooltip or help overlay

## Medium Priority

- [x] **Transition trigger buttons** — Buttons not implemented. Should show available transitions on active states

- [ ] **Minimap** — Component not implemented. Should show bird's-eye view of graph
- [ ] **Zoom indicator** — Not rendered. Show current zoom % in bottom center
- [ ] **Edge hover effects** — Highlight connected nodes when hovering an edge
- [ ] **Export to SVG/PNG** — Allow saving the visualization as an image
- [ ] **Animation** — Smooth transitions when state changes (animate active state highlight)

## Low Priority

- [ ] **Actor tree view** — Side panel showing actor hierarchy (parent → children → regions)
- [ ] **Event log** — Panel showing recent events sent/received with timestamps
- [ ] **Simulation controls** — Play/pause/step through actor transitions manually
- [ ] **Custom layout algorithms** — Support tree, radial, or force-directed layouts beyond ELK layered
- [ ] **Performance optimization** — Memoize graph building, batch layout updates for large actor trees
- [ ] **Accessibility** — ARIA labels for nodes/edges, keyboard navigation between states
- [ ] **Storybook/Playground** — Interactive demo page with example actors

## Technical Debt

- [ ] **ELK.js import** — Uses `dynamic import()` with `as unknown as new () => ELK` cast due to pnpm module resolution issues. Should resolve properly or use a different import strategy
- [ ] **CSSResultGroup type** — `applyDefaultStyles()` uses raw CSS strings instead of Lit's `css` template results. Consider using `adoptedStyleSheets` for better performance
