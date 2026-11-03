# Changelog

## 0.3.3

<sub>2026-11-03</sub>

- _(patch)_ Updated dependency `@mantaq/core` v0.5.3

## 0.3.2

<sub>2026-11-03</sub>

- _(patch)_ Updated dependency `@mantaq/core` v0.5.2

## 0.3.1

<sub>2026-11-02</sub>

- _(patch)_ Updated dependency `@mantaq/core` v0.5.1

## 0.3.0

<sub>2026-11-01</sub>

- _(minor)_
  **Breaking.** Builder handlers take `event` instead of `eventRef`, and declare
  their targets in `to`:

  ```ts
  m.on(idle, { event: GO, to: [busy, done], handler: () => ({ state: busy }) });
  ```

  The handler's return type is narrowed to `to[number]`: returning an unlisted
  state fails to compile, and omitting `to` means the handler can only stay. The
  builder records `to` in `BuiltMaps.targets` (on `actor.options.targets`), so the
  full transition graph is static data. `buildGraph` now draws one edge per
  declared target and a `stay` edge for handlers without `to`. `onAny` edges
  leave a single `*` source (`ANY_NODE_NAME`, `isAnyNode`) instead of being
  copied onto every state. Probing only labels edges with contexts and emits.

  Migrate with `node packages/codemod/src/cli.ts <tsconfig.json>...`, then `vp check`.

## 0.2.0

<sub>2026-09-04</sub>

- _(minor)_
  Export INITIAL_NODE_ID from @mantaq/traversal; buildGraph returns empty graph instead of throwing; drop Date.now timestamps from history; remove dead assertReachedState/assertNeverReachedState aliases from @mantaq/test.
- _(minor)_
  Named effects: `m.effect(stateRef, { name, fn })` — the name is required and identifies
  the effect in tests and history. Effects are now recorded when they actually run:
  `TransitionInfo` carries `effects: string[]`, and `@mantaq/traversal` history effect
  records are `{ stateName, effectName }` instead of being inferred from registration.
  Test harness assertions take both names: `assertEffectRan(stateName, effectName)`,
  `assertEffectNeverRan(stateName, effectName)`, `wasEffectRun(stateName, effectName)`.
  Breaking: all `m.effect(stateRef, fn)` call sites must pass `{ name, fn }`.
- _(patch)_ Harness observes region child states and transitions (#199).
- _(patch)_ buildGraph keeps the initial-state edge for object-form initial (#201).
- _(patch)_ findCycles finds cycles reachable through already-visited nodes (#209).
- _(patch)_ findCycles reports each cycle once (#232).
- _(patch)_ Cleaned AI writing tells from docs and code comments; removed prose em dashes repo-wide.

## 0.1.2

<sub>2026-08-20</sub>

- _(patch)_
  InstrumentedActor mirrors the new on("error") overload on AnyActor so instrumented actors stay assignable to their originals.
- _(patch)_
  Deleted the internal registry and its `@mantaq/core/internal` entry point. Output fan-out is now a public `on("output")` subscriber hook; actors gained public `inject(event)` and terminal `dispose()`.

## 0.1.1

<sub>2026-08-13</sub>

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

- _(patch)_
  Context in handlers and effects is now a handle (`context.get()` / `context.set()`), and `set()` replaces the whole context — so context writes emit a `change` event even without a transition. Snapshots now carry `context`, and change handlers receive the previous snapshot (`(snapshot, prev)`) for identity comparison.

## 0.0.1

<sub>2026-08-09</sub>

- _(patch)_
  First 0.0.1 release: actor-model state machine runtime (hierarchical states, events, effects, virtual clock) with sugar helpers, graph traversal/coverage, test harness, seeded property-based testing, and the shared Either utility — all north-star quality gates enforced.
