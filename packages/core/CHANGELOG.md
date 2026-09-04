# Changelog

## 0.4.0

<sub>2026-09-04</sub>

- _(minor)_
  Named effects: `m.effect(stateRef, { name, fn })` — the name is required and identifies
  the effect in tests and history. Effects are now recorded when they actually run:
  `TransitionInfo` carries `effects: string[]`, and `@mantaq/traversal` history effect
  records are `{ stateName, effectName }` instead of being inferred from registration.
  Test harness assertions take both names: `assertEffectRan(stateName, effectName)`,
  `assertEffectNeverRan(stateName, effectName)`, `wasEffectRun(stateName, effectName)`.
  Breaking: all `m.effect(stateRef, fn)` call sites must pass `{ name, fn }`.
- _(patch)_
  Export INITIAL_NODE_ID from @mantaq/traversal; buildGraph returns empty graph instead of throwing; drop Date.now timestamps from history; remove dead assertReachedState/assertNeverReachedState aliases from @mantaq/test.
- _(patch)_ Actor.dispose cascades to region child actors (#207).
- _(patch)_ recover () aborts in-flight effect AbortController and resolves old queue settled () resolvers (#206 #203).
- _(patch)_ RealClock.setInterval honors already-aborted signal (#211).
- _(patch)_ Throw on duplicate on () /onAny () registration (#200).
- _(patch)_ VirtualClock.advance() terminates when a timer callback re-arms a same-deadline timer (#197).
- _(patch)_ Actor.#pendingEffects is pruned as async effects settle and cleared on dispose() (#198).
- _(patch)_
  Fix core clock and effect issues: RealClock.setInterval honors an already-aborted signal (#211); VirtualClock.setDrain supports multiple drains (#230); RealClock.clearTimeout/clearInterval detach their abort listener (#235); settled() awaits effects spawned by other effects (#237); VirtualClock.advance fires every distinct deadline (#238); non-native thenables are treated as async effects (#239).
- _(patch)_
  Snapshot hands subscribers a defensive copy of the actor context instead of the live reference (#226). `Snapshot.context` and `Snapshot.error.context` are deep-cloned; unchanged snapshots keep a stable context identity so `prev.context === snap.context` still signals "no context change".
- _(patch)_
  Revert #258: restore `EventRef.is()` to its pre-#258 contract that narrows to the
  full `CreatedOfEvent<T, Payload>` (payload stays in scope), instead of the
  type-tag-only guard. The tag-only guard over-promised soundness while breaking
  callers that read `e.payload` (red-CI-class friction across consumers). A sound
  symbol-brand replacement is tracked in #262.
- _(patch)_
  Make `EventRef.is()` a sound type guard via a per-type symbol brand (#262).
  `create()` stamps a non-enumerable brand onto the envelope; `is()` verifies it,
  so only `create()`-produced events satisfy the guard and payload narrowing is
  preserved without a runtime payload walk or `@ts-*` escapes.
- _(patch)_
  Mark `StateRef.regions()` as `@internal` and drop it from the public API docs
  (#241). It stores region config on `_regions` but the runtime never reads it, so
  calling it is a silent no-op; the method stays callable (non-breaking) but is no
  longer advertised as working in `API.md` or the `core.mdx` reference table.
- _(patch)_ Cleaned AI writing tells from docs and code comments; removed prose em dashes repo-wide.

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
