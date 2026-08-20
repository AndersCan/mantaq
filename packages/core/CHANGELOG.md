# Changelog

## 0.3.0

<sub>2026-08-20</sub>

- _(minor)_
  Added on("error", fn) subscriber hook so the __error death signal is observable, including construction-time deaths (seeded to late subscribers) and cleared by recover().
- _(minor)_
  Deleted the internal registry and its `@mantaq/core/internal` entry point. Output fan-out is now a public `on("output")` subscriber hook; actors gained public `inject(event)` and terminal `dispose()`.
- _(patch)_
  Reduced published bundle size of @mantaq/core by minifying dist output and marking packages side-effect-free for consumer tree-shaking.

## 0.2.0

<sub>2026-08-13</sub>

- _(minor)_
  Added actor recovery, transition observability, snapshot state payloads, and hardened clocks against invalid ms; fixed error-report accuracy and made the test harness context-generic. Banned console.* in library src — failures now throw (misconfiguration) or route to the error state (runtime), with platform-matching clock delay clamping.
- _(minor)_
  Effects run on every state entry — initial state at construction, terminal states included. __error is final and fires done.

## 0.1.0

<sub>2026-08-12</sub>

- _(minor)_
  Breaking: events are now envelopes { type, payload } instead of flat { id, ...payload }. EventRef.id renamed to .type. Payload id can no longer be clobbered by the event type. All payload reads move to event.payload.*
- _(minor)_
  Added universal terminal error state for contained user errors; send() no longer throws and errors surface via snapshot().error.
- _(patch)_ Fix README examples mutating context in place, defeating ref-equality change detection
- _(patch)_ Fixed exports in committed package.json pointing at missing dist; vp pack rewrites them at publish time

## 0.0.3

<sub>2026-08-09</sub>

- _(patch)_
  Context writes now emit change even when set() receives the same reference — in-place mutation of a class-instance context is detectable by writing through set(). Change detection stays reference-identity; deep comparison of arbitrary context values is not supported.

## 0.0.2

<sub>2026-08-09</sub>

- _(patch)_ Effects now receive the state's declared payload type (no cast needed in m.effect).
- _(patch)_ Fixed flaky, slow stryker mutation runs (related-file collection + shared cache).
- _(patch)_
  Context in handlers and effects is now a handle (`context.get()` / `context.set()`), and `set()` replaces the whole context — so context writes emit a `change` event even without a transition. Snapshots now carry `context`, and change handlers receive the previous snapshot (`(snapshot, prev)`) for identity comparison.

## 0.0.1

<sub>2026-08-09</sub>

- _(patch)_
  First 0.0.1 release: actor-model state machine runtime (hierarchical states, events, effects, virtual clock) with sugar helpers, graph traversal/coverage, test harness, seeded property-based testing, and the shared Either utility — all north-star quality gates enforced.
