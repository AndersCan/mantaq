# Changelog

## 0.4.0

<sub>2026-08-20</sub>

- _(minor)_
  Added actorSpec, definePart, use, and withParts so a long actor setup can be split across files, with actorSpec building the typed spec that anchors every part.
- _(patch)_
  Deleted the internal registry and its `@mantaq/core/internal` entry point. Output fan-out is now a public `on("output")` subscriber hook; actors gained public `inject(event)` and terminal `dispose()`.

## 0.3.0

<sub>2026-08-13</sub>

- _(minor)_
  Added onOutput(actor, handler) — public wrapper for the child-output wiring seam, replacing direct @mantaq/core/internal imports.
- _(patch)_
  Fixed ActorMap auto-reap leaking dead children: done-reaped actors kept their reaper entry alive, pinning the full child closure graph and growing unbounded per completed key.

## 0.2.0

<sub>2026-08-13</sub>

- _(minor)_
  ActorMap is a keyed registry of one actor type — constructor takes the factory, spawn takes the key. states() accepts { name, final: true } objects.
- _(patch)_
  Added actor recovery, transition observability, snapshot state payloads, and hardened clocks against invalid ms; fixed error-report accuracy and made the test harness context-generic. Banned console.* in library src — failures now throw (misconfiguration) or route to the error state (runtime), with platform-matching clock delay clamping.

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
