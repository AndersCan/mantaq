# Visualizer Documentation Issues

## Critical: Code Examples Wrong

- [ ] **Basic Usage shows `customElements.define()`** — `ActorGraph` already has `@customElement("actor-graph")` decorator (`actor-graph.ts:22`). Double registration throws. Remove from example.
- [ ] **Basic Usage shows `applyDefaultStyles()`** — Extra boilerplate. Package should handle styles internally. Remove from example.
- [ ] **Full Example shows `customElements.define()`** — Same double-registration issue. Remove.
- [ ] **Full Example shows `applyDefaultStyles()`** — Same. Remove.
- [ ] **Full Example transition handlers wrong signature** — Shows `FETCH: () => ({ state: loading })` but actual API is `(event, { context, actor }) => ({ state: ... })`. Two params, not zero.
- [ ] **`flattenNodes` API mismatch** — Docs say `flattenNodes(graph)` but actual signature is `flattenNodes(node: GraphNode): GraphNode[]`. Takes a single node, not a graph.

## Critical: Outdated Known Issues

- [ ] **"No built-in transition buttons"** — FALSE. `state-node.ts` renders buttons, `actor-graph.ts:327-349` handles triggers. Remove from known issues.
- [ ] **"Store-component wiring missing"** — FALSE. `actor-graph.ts:178-190` uses `StoreController` from `@nanostores/lit`. Remove from known issues.
- [ ] **"Live actor sync not called automatically"** — Misleading. `startActorSync()` works, just not auto-called. Rephrase.

## High: Examples Mix Actor Logic with Rendering

- [ ] **Basic Usage shows HTML `<actor-graph>` tag** — Should only show actor setup. Rendering is package concern.
- [ ] **"Adding Transition Buttons" section is all DOM** — `document.getElementById`, `innerHTML`, `createElement`. Should show actor-level transition API only.
- [ ] **Interactive Demo is hand-coded SVG** — Not using the actual visualizer. Misleading.
- [ ] **Full Example calls `setActor(actor)` then `startActorSync()`** — Shows rendering setup. Should focus on actor creation and event sending.

## Medium: Missing Exports in Docs

- [ ] **Store table missing `$layoutLoading`** — Exported from `index.ts:34`, not listed in docs.
- [ ] **Store table missing `$flatNodes`** — Exported from `index.ts:40`, not listed in docs.
- [ ] **Store table missing `$edges`** — Exported from `index.ts:41`, not listed in docs.
- [ ] **Actions list missing `setViewport`** — Exported from `index.ts:54`.
- [ ] **Actions list missing `setZoom`** — Exported from `index.ts:49`.
- [ ] **Actions list missing `updateLayout`** — Exported from `index.ts:48`.
- [ ] **API Reference missing `estimateNodeWidth`** — Exported from `index.ts:7`.

## Medium: API Reference Incomplete

- [ ] **`computeLayout` missing options** — Docs omit `nodeSpacing`, `edgeSpacing`, `padding` params.
- [ ] **`startActorSync` description incomplete** — Should mention it subscribes to actor's `change` event, not just `$actor`.

## Low: README Issues

- [ ] **README Basic Usage missing `applyDefaultStyles`** — Inconsistent with mdx docs (though both should remove it).
- [ ] **README missing `startActorSync`** — Not documented.
- [ ] **README missing `$layoutLoading`, `$flatNodes`, `$edges`** — Not listed in stores.
- [ ] **README missing `setViewport`, `setZoom`, `updateLayout`** — Not listed in actions.
- [ ] **README missing `estimateNodeWidth`** — Not listed in functions.

## Low: Style Issues

- [ ] **Transition Buttons example hardcodes event map** — `const events = { FETCH: fetch, ... }` is fragile. Should use event refs directly.
- [ ] **Transition Buttons calls `setActor(a)` after send** — Redundant if `startActorSync()` is active.
- [ ] **Transition Buttons uses `a.options.transitions`** — Accesses private internals via `ActorWithOptions` cast. Not public API.
