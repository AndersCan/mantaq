# Changelog

## 0.0.3

<sub>2026-09-04</sub>

- _(patch)_
  Export INITIAL_NODE_ID from @mantaq/traversal; buildGraph returns empty graph instead of throwing; drop Date.now timestamps from history; remove dead assertReachedState/assertNeverReachedState aliases from @mantaq/test.
- _(patch)_ MANTAQ_SEED validated ; non-numeric rejected as Left instead of silent fallback (#205).

## 0.0.2

<sub>2026-08-09</sub>

- _(patch)_
  Context in handlers and effects is now a handle (`context.get()` / `context.set()`), and `set()` replaces the whole context — so context writes emit a `change` event even without a transition. Snapshots now carry `context`, and change handlers receive the previous snapshot (`(snapshot, prev)`) for identity comparison.

## 0.0.1

<sub>2026-08-09</sub>

- _(patch)_
  First 0.0.1 release: actor-model state machine runtime (hierarchical states, events, effects, virtual clock) with sugar helpers, graph traversal/coverage, test harness, seeded property-based testing, and the shared Either utility — all north-star quality gates enforced.
