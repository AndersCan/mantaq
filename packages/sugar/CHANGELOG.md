# Changelog

## 2.3.0

<sub>2026-11-12</sub>

- _(minor)_
  The pool inbox has three named states, `allWorkersFree`, `workersBusy` and `workWaiting`, each handling only the events that can reach it. The `ITEMS_RETURNED` event, which a pool never sent, is gone.

  Breaking: the pool inbox's states are allWorkersFree, workersBusy and workWaiting (were empty and holding); PoolEvents has no ITEMS_RETURNED and a running worker no longer hands back an assignment — affects code that reads pool.actor.state.name, uses events.ITEMS_RETURNED, or sends ITEMS_FINISHED itself.

## 2.2.0

<sub>2026-11-11</sub>

- _(minor)_
  Add `createPool`: one inbox and n workers with typed events, pull-based, failed work goes back to the front. `onOutput` now accepts an actor whose context is an `interface`.

## 2.1.1

<sub>2026-11-08</sub>

- _(patch)_ Updated dependency `@mantaq/core` v0.7.1

## 2.1.0

<sub>2026-11-08</sub>

- _(minor)_
  Actor maps reach the inspector. `ActorMap.get(key)` returns the live child. Return the map next to the actor (`return { actor, photos }`) and the inspector draws one child's states as a compartment named after the map, the live driver lists the children (`VizLiveState.children`) and steps can go to one (`actor: { map, key }`, `photos[p1]>uploadConfirmed` in links).

  Breaking: document format v15 (`VizMachine.maps`) — affects anyone serving a prebuilt viz.json; rebuild it.

  Breaking: VizLiveState.children is required — affects custom VizDriver implementations.

## 2.0.7

<sub>2026-11-07</sub>

- _(patch)_ Updated dependency `@mantaq/core` v0.7.0

## 2.0.6

<sub>2026-11-07</sub>

- _(patch)_
  READMEs rewritten against the current API (`Actor({...})`, `m.on(state, { event, to, handler })`, `VirtualClock()`, `setTimeout(ms, { cb, signal })`, `on("change", { fn })`); every README `ts` snippet now typechecks in `docs:check`. Core README gains "See your machine" (`@mantaq/inspect` Vite plugin) and the agent-skill install line. Packages declare `homepage`, `repository`, `bugs` and `keywords`.

## 2.0.5

<sub>2026-11-06</sub>

- _(patch)_ Updated dependency `@mantaq/core` v0.6.0

## 2.0.4

<sub>2026-11-05</sub>

- _(patch)_ Updated dependency `@mantaq/core` v0.5.4

## 2.0.3

<sub>2026-11-03</sub>

- _(patch)_ Updated dependency `@mantaq/core` v0.5.3

## 2.0.2

<sub>2026-11-03</sub>

- _(patch)_ Updated dependency `@mantaq/core` v0.5.2

## 2.0.1

<sub>2026-11-02</sub>

- _(patch)_
  `withTimeout` now labels its timer with the emitted event's type, so `pendingTimers()` shows it. The `Emit` type parameter is now constrained to `InternalEvent`. The event factory is called once when the timer is scheduled (for the label) and again when it fires.

- _(patch)_
  Document how to bridge a port that returns `Promise<Either<E, T>>` through `withPromise` with `Either.match`, with a test that pins the typed payloads and the `sends` check.

## 2.0.0

<sub>2026-11-01</sub>

- _(major)_
  **Breaking.** Sugar wraps core's `ActorBuilder`, so its builder `on()` now takes
  `{ event, to }` instead of `eventRef` (from the core builder-targets change,
  #297). Migrate with `node packages/codemod/src/cli.ts <tsconfig.json>...`
  (`@mantaq/codemod`), then `vp check`.

## 1.0.0

<sub>2026-09-04</sub>

- _(major)_
  apply mechanical style rules across all packages

  `withPromise` now takes a single options object (`WithPromiseOptions`) instead
  of positional arguments; this is a breaking change to the public sugar API.

- _(patch)_
  Export INITIAL_NODE_ID from @mantaq/traversal; buildGraph returns empty graph instead of throwing; drop Date.now timestamps from history; remove dead assertReachedState/assertNeverReachedState aliases from @mantaq/test.
- _(patch)_ ActorMap.autoReap disposes completed children and unsubscribes its done observer (#204).
- _(patch)_ withPromise returns the promise so settled () awaits async effects (#202).
- _(patch)_
  ActorMap.autoReap disposes children already done at spawn (#231); withTimeout clears its timer on fire/transition/dispose (#242).
- _(patch)_ ActorMap.dispose tears down all child actors (#229).
- _(patch)_
  `withPromise` binds its error handler only to the original promise: the success
  and rejection handlers now use the two-argument `then`, so a throw in the
  success callback is no longer swallowed and mislabeled as a promise rejection
  (#268). A success-path failure now propagates uncaught as it should.

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
