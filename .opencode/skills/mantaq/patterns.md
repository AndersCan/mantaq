# Patterns

Proven recipes. Each pattern is self-contained; full working versions live in the mantaq repo under `packages/examples/` (e.g. `checkout.actor.test.ts`) if you want to see them in context.

## Async Work → Effect + Internal Event

State enters "working", effect runs the async job, emits internal event, transition completes.

```ts
const submitting = state("submitting")();
const success = state("success")().final();
const submittingDone = event("SUBMITTING_DONE")();

new Actor({
  inputs: [submit],
  internal: [submittingDone],
  states: [idle, submitting, success],
  initial: idle,
  clock: new VirtualClock(),
  setup: (m) => {
    m.effect(submitting, (input) => withTimeout(800, input, () => submittingDone.create()));
    m.on(submitting, submittingDone, () => ({ state: success }));
  },
});
```

For real promises use `withPromise` (see `sugar.md`). Effects never run on the initial state — boot work starts in a boot state the first event transitions out of.

## Retry / Exponential Backoff

Retry count + backoff live in context. Effect schedules `clock.setTimeout(backoffMs * 2^retryCount)`. Failed attempt increments counter, re-emits the fail event or transitions to a retry state. Clear the timer on abort:

```ts
const id = clock.setTimeout(delay, () => emit(retryDone.create()));
signal.addEventListener("abort", () => clock.clearTimeout(id));
```

## Cross-State Handling → onAny

Events valid in every state (cancel, back, disconnect). One handler; return `{}` when irrelevant.

```ts
m.onAny(backEvent, (ev, { context, actor }) => {
  if (matches(actor, "payment")) {
    context.set({ ...context.get(), paymentInfo: undefined });
    return { state: shippingAddress };
  }
  if (matches(actor, "error")) return { state: payment };
  return {};
});
```

Inside `onAny`, `actor.state` is already the post-transition state (state handler applies first).

## Parallel Concerns → Regions

Independent sub-behaviors as child actors. Parent + children in one snapshot; `matches(actor, "parent.region.child")` checks the full path.

```ts
new Actor({ regions: { health: healthMonitor, movement: movementActor }, ... });
```

- Child output events route to parent's queue automatically. The parent must declare the child's output event in its `internal` (or `inputs`) to dispatch it — undeclared, it routes outward again or drops.
- Forward events INTO a region manually — there is no declarative parent→child wiring:

```ts
m.onAny(toggleEvent, ({ actor }) => {
  actor.regions.movement.send(jumpEvent.create());
  return {};
});
```

## Event Sourcing → Context as Log + Fold

Events append to a log in context. State derived by folding the log — not stored. Snapshot + rebuild for replay.

```ts
// concrete state ref — m.on takes a StateRef, not "any state"
m.on(activeState, domainEvent, (event, { context }) => {
  const s = context.get();
  context.set({ ...s, log: [...s.log, event] });
  return { emit: [eventStored.create({ event })] };
});
```

When only one non-final state receives the event, bind it there; otherwise repeat `m.on` per state or use `onAny`.

## Orchestration / Saga → Emit Chains

Sequential steps as states, each effect emits the next-step event. Compensating transitions on CANCEL via `onAny`.

## Error-State Design

Two patterns, choose per arc:

- **Recoverable error** → non-final error state + retry input event, error details in context.
- **Terminal error** → final `failed` state.

Decide per failure arc, not per actor. Never model errors as booleans in context.

## State Payload vs Context

- **State payload** — data tied to the moment of entry, via `StateRef.create(payload)`. Read in the effect via `input.state.payload`.
- **Context** — accumulated data across transitions, mutated in handlers.
- Rule: transient per-visit data → payload. Data persisting across steps → context.

## Undo/Redo → Snapshot + Restore

Full context snapshots as command history in context; UNDO/REDO via `onAny` pop/push and restore.

## Checklist for New Actors

- Async work goes in effects, not transition handlers.
- Timer/interval ids cleared on abort; check `signal.aborted` before emitting.
- Every emitted event declared (`internal`/`outputs`) and handled in the state that receives it.
