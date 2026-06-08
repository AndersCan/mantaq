# Actor Visualizer — Remaining Tasks

## Completed

- [x] Package scaffolding (package.json, tsconfig, vite.config)
- [x] Graph data model (`graph.ts`) — converts actor snapshots to graph nodes/edges
- [x] ELK.js layout engine (`layout.ts`) — computes hierarchical graph positions
- [x] Nanostores state management (`stores/graph-store.ts`)
- [x] LitElement components (`actor-graph.ts`, `state-node.ts`, `edge.ts`)
- [x] Default theme and styles (`styles.ts`)
- [x] Barrel export (`index.ts`)
- [x] Unit tests for graph module (8 tests passing)
- [x] Type checking and lint passing

## High Priority

- [ ] **Region wrapper nodes** — State-level regions render states directly under parent. Need wrapper nodes for region labels (e.g., "sub" region label above subA/subB)
- [ ] **Actor-level region rendering** — `buildChildGraphs` handles `actor.regions` but no visual distinction from state-level regions
- [ ] **Store reactivity wiring** — Components don't yet subscribe to nanostores via `useStore` directive. Need to connect `$layout`, `$selectedNodeId`, `$zoom`, `$pan` to `actor-graph` component
- [ ] **Real-time actor sync** — `startActorSync()` exists but not called automatically. Need lifecycle hook to auto-update graph when actor state changes
- [ ] **Edge labels for transitions** — Current edge labels show event IDs but not guard conditions or actions
- [ ] **Keyboard shortcuts documentation** — +/-/0/F shortcuts work but no tooltip or help overlay

## Medium Priority

- [ ] **Minimap** — Styles defined (`minimapStyles`) but component not implemented. Should show bird's-eye view of graph
- [ ] **Zoom indicator** — Styles defined (`zoomIndicatorStyles`) but not rendered. Show current zoom % in bottom center
- [ ] **Node tooltips** — Show state details on hover (payload type, effects, context)
- [ ] **Edge hover effects** — Highlight connected nodes when hovering an edge
- [ ] **Export to SVG/PNG** — Allow saving the visualization as an image
- [ ] **Animation** — Smooth transitions when state changes (animate active state highlight)
- [ ] **Dark mode** — Extend theme with dark variant, detect `prefers-color-scheme`

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
- [ ] **Test coverage** — Only `graph.ts` has tests. Need tests for `layout.ts`, `stores/graph-store.ts`, and component rendering
- [ ] **Integration tests** — Test full flow: actor → snapshot → graph → layout → render
- [ ] **Documentation** — README with usage examples, API docs for all exported types/functions
