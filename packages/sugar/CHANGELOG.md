# Changelog

## 0.1.0

<sub>2026-08-12</sub>

- _(minor)_
  Breaking: events are now envelopes { type, payload } instead of flat { id, ...payload }. EventRef.id renamed to .type. Payload id can no longer be clobbered by the event type. All payload reads move to event.payload.*
- _(patch)_ sync dependents to core 0.0.3
- _(patch)_ Fixed exports in committed package.json pointing at missing dist; vp pack rewrites them at publish time
- _(patch)_
  Added universal terminal error state for contained user errors; send() no longer throws and errors surface via snapshot().error.

## 0.0.2

<sub>2026-08-09</sub>

- _(patch)_ Fixed flaky, slow stryker mutation runs (related-file collection + shared cache).

## 0.0.1

<sub>2026-08-09</sub>

- _(patch)_
  First 0.0.1 release: actor-model state machine runtime (hierarchical states, events, effects, virtual clock) with sugar helpers, graph traversal/coverage, test harness, seeded property-based testing, and the shared Either utility — all north-star quality gates enforced.

## 0.1.0

<sub>2026-06-05</sub>

- _(minor)_ Initial release of sugar package with matches, effects, broadcast, and tags
