---
name: mantaq
description: Create and use actor-model state machines with @mantaq/core in your own project. Philosophy, building blocks, transition rules. Read sibling files (sugar.md, patterns.md, testing.md, reviewing.md) when the task touches those areas.
allowed-tools: Read Grep Glob Edit Write Shell
---

# Mantaq Skill

Actor-model state machine library for TypeScript. `npm install @mantaq/core`. Minimal primitives: states + events, context, effects, regions, one injectable clock.

## Philosophy

Three machine checks:

- **If it typechecks, it runs correct.** Type = behavior.
- **If it runs, it runs deterministic.** Same inputs, same trace. One injectable clock.
- **If tests pass, behavior is proven.** Virtual clock, mutation-tested.

Errors flow as states and events — mantaq never throws. One way to do things; don't invent competing patterns.

## Building Blocks

All from `@mantaq/core`.

### State

```ts
const idle = state("idle")();
const done = state("done")().final(); // final — ignores events, signals completion
const loading = state("loading")<{ id: string }>();
```

- `StateRef.create(payload)` → `{ state, payload }` — transition target carrying payload.
- `StateRef.regions()` is inert today — nothing consumes it. Use the Actor `regions` option.

### Event

```ts
const start = event("START")();
const submit = event("SUBMIT")<{ email: string }>();
submit.create({ email: "a@b.com" }); // → { type: "SUBMIT", payload: { email } }
start.create(); // → { type: "START" }
submit.is(anything); // type guard
```

### Context

Mutable shared data. Not state tracking — that's what states are.

```ts
new Actor({ context: {} as Ctx, ... });
// in handlers:
opts.context.get();                          // read — live record
const cur = opts.context.get();
cur.x = 1;                                   // mutate — context is user land
opts.context.set(cur);                       // write signal — change event
// outside: actor.context
```

Context is user land — mutate it freely. `set()` is the write signal: any
`set()` fires a `change` event, even with the same reference. Mutate without
`set()` and subscribers stay silent.

### Effects

Side effects run on state entry via transition — async work, timers, I/O. Never on the initial state: the constructor runs no effects. Work that must run at boot starts in a state the first event transitions out of.

Aborted (AbortSignal) on state exit. Check `signal.aborted` before emitting.

```ts
m.effect(submittingState, (input) => {
  const { signal, clock, emit } = input;
  clock.setTimeout(800, () => {
    if (signal.aborted) return;
    emit({ type: "SUBMITTING_DONE" });
  });
});
```

`emit` accepts a created event or a raw `{ type }`. A type declared in `internal` (or `inputs`) dispatches back into the actor; anything else routes to the output handler (parent queue) or is dropped if no parent. Full routing in Transitions below.

### Clock

Injectable. Only source of time.

```ts
clock: new VirtualClock(),   // tests — advance(ms) jumps deterministically
clock: new RealClock(),      // production default
```

Use the injected clock for ALL timing — never real `setTimeout`/`Date.now` in effects. That's what makes actors deterministic.

### Regions / Composition

Child actors composed into parent.

```ts
new Actor({ regions: { movement: moveActor, combat: combatActor }, ... });
```

- Child output events route to parent's queue automatically.
- Forward events INTO a region manually: `actor.regions.movement.send(...)`. No declarative parent→child wiring.
- `snapshot().path` = `["stateName"]` — root state only. Child snapshots nest under `snapshot().regions[name]`. Dotted paths (`matches(actor, "drawer.open")`) come from sugar.

### Actor

```ts
new Actor({
  inputs: [submit, back],      // what send() accepts
  outputs: [],                  // events emitted outward (parent queue)
  internal: [submittingDone],   // events emitted back into self
  states: [idle, submitting, done],
  initial: idle,
  context: {} as Ctx,
  clock,
  setup: (m) => { ... },
});
```

- `send(event.create(...))` — input events only.
- `snapshot()` → `{ path, context, regions, done? }`.
- `on("change", fn)` / `on("done", fn)` / `on("error", fn)` → returns unsubscribe.
- `settled()` → resolves when queue drains. Pending timers are NOT queued events — advance the clock to wait for timer work.
- `context` — read current.
- In handlers, `actor.state` is the live StateRef; `.name` is its id. Timing caveat below.

## Transitions

```ts
m.on(stateRef, eventRef, (event, { context, actor }) => TransitionResult);
m.onAny(eventRef, (event, { context, actor }) => TransitionResult); // any non-final state
m.effect(stateRef, (input) => void);
```

Result — all optional:

```ts
{ state: doneState }                  // plain transition
{ state: loading.create({ id }) }     // transition + state payload (state payload, not event)
{ emit: [submittingDone.create()] }   // queue an event, same synchronous run
{ state: x, emit: [...] }             // both
{}                                    // no-op — cross-state handling in onAny
```

Semantics:

- **Sync pipeline, one call stack.** `send(e)` → handler → transition applies (previous effects aborted, new effects start) → emitted events queued and drained to exhaustion. `advance(ms)` fires due timers; each fire runs the same drain — still synchronous. No awaits with VirtualClock.
- `m.on` and `m.onAny` both run for the same event. `onAny`'s `state` is ignored if a state handler already transitioned; its `emit` still fires.
- `actor.state` inside a state handler is the PREVIOUS state; inside `onAny` it's already the new one (state step applies first). Prefer branching on event payload / context.
- Final states ignore all events — input and self-emitted. `snapshot().done` + `on("done")` signal completion.
- Emitted event routing is decided by declaration, not by the emit: id in `internal` → dispatch to self; id in `inputs` → dispatch to self; else → output handler (parent queue), or dropped if no parent.
- No handler for an event in the current state → `[Actor] no transition for event "X" in state "Y". Event dropped.` warning. That warning = wiring bug — anything you emit must have a handler in the state that receives it.
- `internalBudget` (default 10,000) guards emit loops. Exceeded → current drain aborted (effects aborted, queued events dropped), warning. Actor still processes future sends.

## Usage Rules

- All timing through the injected clock. No real timers, no `Date.now`, no randomness in effects — determinism is the point.
- Declare payload types at boundaries — `state("x")<T>()`, `event("x")<P>()`. Bare `state("x")()` has payload `unknown`.
- Model errors as states and events, not exceptions. Recoverable errors → non-final states with retry. Terminal failures → final states.
- Test with the VirtualClock and the `@mantaq/test` harness — see `testing.md`.

## Sugar — pointer

Helpers: `states()`, `events()`, `matches()`, `ActorMap`, `broadcast()`, `withTimeout()`, `withPromise()`, `tag()`, `isIn()`, `activeLeaves()`. Signatures in `sugar.md`.

## Sibling Files

- `sugar.md` — sugar helper reference
- `patterns.md` — recipes: async effects, retries, regions, event sourcing
- `testing.md` — virtual clock, @mantaq/test, traversal coverage
- `reviewing.md` — review your actor code against mantaq conventions
