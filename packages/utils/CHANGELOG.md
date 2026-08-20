# Changelog

## 0.0.3

<sub>2026-08-20</sub>

- _(patch)_
  Reduced published bundle size of @mantaq/core by minifying dist output and marking packages side-effect-free for consumer tree-shaking.

## 0.0.2

<sub>2026-08-12</sub>

- _(patch)_
  Added universal terminal error state for contained user errors; send() no longer throws and errors surface via snapshot().error.

## 0.0.1

<sub>2026-08-09</sub>

- _(patch)_
  First 0.0.1 release: actor-model state machine runtime (hierarchical states, events, effects, virtual clock) with sugar helpers, graph traversal/coverage, test harness, seeded property-based testing, and the shared Either utility — all north-star quality gates enforced.
