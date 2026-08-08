# @mantaq/viz (removed)

Actor model state machine visualizer. Source deleted — too buggy to keep. This README documents what was here.

## What it did

Rendered an actor's state machine as an interactive graph in the browser. Click edges to fire transitions, see active state highlighted, inspect actor context, play transition timeline. Also had a `<mantaq-viz>` web component with a toolbar, settings panel (layout direction, edge router, ranksep), and tooltips.

## Libraries used

- **@antv/x6** (v3) — graph canvas, SVG rendering, node/edge styling, routers, zoom/pan
- **@dagrejs/dagre** — layered graph layout (TB/LR, node/rank separation)
- **lit-html** (v3) — DOM rendering for toolbar, context viewer, timeline, settings panel
- **unocss** — styling (uno.config.ts)
- **@mantaq/core**, **@mantaq/traversal** — actor API and graph/path building (workspace deps)
- **vitest** + **@vitest/browser-playwright** — node + browser tests with screenshots
- **stryker** — mutation testing

## Structure

- `src/graph.ts` — actor snapshot → nodes/edges (`buildGraph`)
- `src/layout.ts` — dagre positions (`computeNodePositions`)
- `src/x6/` — X6 graph creation, sync, node/edge styles (`createGraph`, `syncGraph`)
- `src/components/` — `mantaq-viz`, `actor-flow`, `context-viewer`, `transition-timeline`, `editor-model`
- `src/controllers/graph-sync-controller.ts` — kept graph in sync with live actor
- `dev/` — playground page
- `tests/` — unit, integration, and browser tests

## API surface (gone)

`buildGraph`, `computeNodePositions`, `renderActorFlow`, `MantaqViz` custom element, `ActorGraph`/`GraphNode`/`GraphEdge`/`LayoutOptions` types.
