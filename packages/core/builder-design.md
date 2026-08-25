# Builder Pattern, Not Static Structure

Why `setup(m) => m.on(stateRef, eventRef, fn)` builder. Not `transitions: { idle: { START: fn } }` static map.

> Historical design notes. Type shapes and plans predate the current API: events are
> now envelopes `{ type, payload }`, and errors land in the universal `__error` state
> (`snapshot().error`) instead of a reserved `@error` event. Read as history, not
> current contract.

## The Problem

Static map looks clean. Is a type trap.

```ts
// Static — looks nice, breaks types
new Actor({
  states: [idle, running],
  inputs: [start, stop],
  transitions: {
    idle: { START: (event, { context }) => ({ state: running }) },
  },
});
```

Handler `event` param type? Map key `"START"` is a string. TypeScript cannot look up which `EventRef<"START", Payload>` in `inputs` tuple has id `"START"` and pull its `Payload` into the handler. Result: `event: InternalEvent` = `{type: string; payload?: unknown}`. Payload fields are `unknown`.

User writes `event.phoneNumber` → tsc error → user casts `event as any`. Vision violated. We saw this: 9 casts in undoRedo, 3 in creditCheck, 1 in gameCharacter. Plus `context as CreditCheckContext` casts because context type loose too.

Mapped-type fix attempt: `HandlerEvent<Inputs, Internal, E>` lookup via `Extract<Refs[number], {id: Id}>`. Got 163→101 errors down. Remaining wall: `Actor<...>` not assignable to `AnyActor` because `options.initial: StateRef | {state, payload}` not assignable to `{name?: string}`. Each fix spawns new mismatch. Rabbit hole.

## Why Builder Wins

`m.on(stateRef, eventRef, fn)` passes refs as ARGS. TypeScript infers `fn`'s event param DIRECTLY from `eventRef`'s generic. No map lookup. No mapped types. No casts.

```ts
// Builder — types flow via args
new Actor({
  states: [idle, running],
  inputs: [start], // start = event("START")<{url: string}>()
  setup: (m) => {
    m.on(idle, start, (event, { context }) => {
      // event: {type: "START"; payload: {url: string}}  ← inferred from start
      const s = context.get();
      s.url = event.payload.url; // ✓ typed
      context.set(s);
      return { state: running };
    });
  },
});
```

Same mechanism Effect's `Match.when(pattern, fn)` and pipe APIs use. Pattern carries type via arg, not via map key. Builder = arg inference. Static map = key lookup. Lookup loses.

## What Builder Costs

- One extra closure (`setup: (m) => {...}`) per actor. Trivial.
- `m` is a builder object with `on`, `effect`, `onAny` methods. ~50 lines impl.
- Runtime builds `transitions`/`effects` maps internally from builder calls. Same runtime, different declaration.

## What Static Map Costs

- 101 tsc errors in current tree. Type-runtime mismatch. Vision violation.
- Casts in user code to recover payload types. Vision: "no casts to force the compiler quiet."
- `AnyActor` + `options.initial` + `context` inference all fight each other. No clean fix found.
- Effect handlers lose `state` payload type too. Same root cause.

## Anti-Pattern

`transitions: { [stateName]: { [eventId]: fn } }` static map in user code. Banned. Builder only.

Internal `TransitionMap` type can stay (runtime compiled form) but users never write it directly.

## Error Channel Fix (Same Pass)

Current `on("error", fn)` callback is separate error flow. Vision: "errors are events and states." Contradiction.

Fix: drop `on("error")`. Errors become reserved internal event `@error` with `{error: unknown}` payload. Transitions handle via `Any: { "@error": ... }`. Parent receives via output handler. Bubbles up. One pipe, one philosophy.

Keep `on("change")` + `on("done")`. Observation only, derived from state. Not control flow.

## Conversion Plan

Small steps, verify each.

### Step 1. Re-add builder to core

- New `packages/core/src/builder.ts`: `ActorBuilder` class with `on(s, e, fn)`, `onAny(e, fn)`, `effect(s, fn)` methods. Each call stores into internal `transitions`/`effects` maps.
- `Actor` constructor accepts `setup?: (m: ActorBuilder) => void` as alternative to `transitions`/`effects`. If `setup` provided, run it, collect maps.
- `setup` and `transitions` mutually exclusive. One or the other. Vision: "one way to do things". But builder is the one way for typed handlers; `transitions` map stays as internal/runtime form only, not user-facing.
- Keep `ActorBuilder` private to core. Export only `setup` callback shape.

### Step 2. Fix error channel

- Remove `on("error", fn)` overload + `Subscribers.emitError` + `#subs.emitError` calls.
- Add reserved `@error` internal event. `#runEffects` catch + budget-exceeded push `{id: "@error", error: err}` to queue instead of callback.
- Drain handles `@error` like any internal event → transitions → `Any: {"@error": fn}` or bubbles to parent via output handler.
- Update `AnyActor` interface: drop `on("error")`.

### Step 3. Migrate tests back to builder

- All 22 test files + 11 example files currently use direct `transitions: {}` map (from checkpoint commit). Revert to `setup: (m) => m.on(...)` form.
- Workers can do this mechanically: `transitions: {idle: {START: fn}}` → `setup: (m) => { m.on(idle, start, fn) }`. Same fn bodies.
- Remove every `event as any` / `context as X` cast. Builder infers types, casts unneeded.
- Verify: `vp check` clean (0 tsc errors), `vp test` 405/405.

### Step 4. Update sugar/traversal/viz

- `sugar/src/effects/timeout.ts`: revert `EffectInput<Ctx>` 1-generic → keep 1-generic (builder passes same `EffectInput` shape). No change likely.
- `traversal/src/graph.ts`: reads `actor.options.transitions`. Still works, builder produces same internal map. May need `actor.options` type widen.
- `viz`: reads `actor.options` for graph building. Same.

### Step 5. Drop static-map user API

- Remove `transitions` from `ActorOptions` public type. Keep internal.
- Remove `TransitionMap` export from `index.ts`. Internal only.
- Update `packages/core/tests/smoke.test.ts` + `typecheck.test.ts` to use `setup`.
- Vision: one way to declare actor = builder.

### Step 6. Verify vision

- `vp check`: 0 tsc errors, 0 lint errors.
- `vp test`: 405/405 (or new count).
- `rg "as any|as unknown as" packages/`: 0 in user-facing code (mutation-test fixtures excluded).
- `rg "on\(\"error\"" packages/`: 0.
- `rg "transitions:\s*\{" packages/`: 0 outside core/src internal.

## What We Keep From The Rewrite

- Module split: `queue.ts`, `subscribers.ts`, `dispatch.ts`, `effects.ts`, `snapshot.ts`, `clock.ts`, `real-clock.ts`, `virtual-clock.ts`, `abort-tracker.ts`, `actor-internal.ts`, `actor-types.ts`. Good split. Stays.
- `VirtualClock` deterministic test clock. Stays.
- `InternalQueue.processCancellable` budget guard. Stays.
- `EffectFn<Ctx>` 1-generic (not 3). Stays. Simpler.

## What We Revert

- Checkpoint commit `618981a` test migration (setup→direct). Revert the test-file changes only. Core module split stays.
- Decision `01KVYD07P7K29AHPX084CSCNHV` ("Deleted builder.ts, vision One-Way"). Reversed: builder IS the one way. Direct map was the competing API.
