# Patterns

Proven recipes. Code is a sketch written against `@mantaq/core` 0.4 and `@mantaq/sugar` 1.0. Copy the shape, not the exact signatures: check them against the installed types. Full working versions live in the mantaq repo under `packages/examples/` (e.g. `checkout.test.ts`, `saga-orchestrator.test.ts`, `request-response.test.ts`).

## Async Work → Effect + Internal Event

State enters "working", effect runs the async job, emits internal event, transition completes.

```ts
const submitting = state("submitting")();
const success = state("success")().final();
const submittingDone = event("SUBMITTING_DONE")();

Actor({
  inputs: [submit],
  internal: [submittingDone],
  states: [idle, submitting, success],
  initial: idle,
  clock: VirtualClock(),
  setup: (m) => {
    m.effect(submitting, {
      name: "startSubmitTimeout",
      fn: (input) => withTimeout(800, { input, event: () => submittingDone.create() }),
    });
    m.on(submitting, { eventRef: submittingDone, handler: () => ({ state: success }) });
  },
});
```

For real promises use `withPromise` (see `sugar.md`) and return it from the
effect.

## Retry / Exponential Backoff

Retry count + backoff live in context. Effect schedules a delay of
`backoffMs * 2^retryCount` on the injected clock. Failed attempt increments
counter, re-emits the fail event or transitions to a retry state. Pass the
effect's abort signal to the timer so it is removed on exit:

```ts
clock.setTimeout(delay, { signal, cb: () => emit(retryDone.create()) });
```

## Cross-State Handling → onAny

Events valid in every state (cancel, back, disconnect). One handler; return `{}` when irrelevant.

```ts
m.onAny({
  eventRef: backEvent,
  handler: (ev, { context, actor }) => {
    if (matches(actor, "payment")) {
      const cur = context.get();
      cur.paymentInfo = undefined;
      context.set(cur);
      return { state: shippingAddress };
    }
    if (matches(actor, "error")) return { state: payment };
    return {};
  },
});
```

Branch on payload or context where you can. `actor.state` inside a handler is easy to misread (previous vs new state depending on handler kind).

## Parallel Concerns → Regions

Independent sub-behaviors as child actors. Parent + children in one snapshot; `matches(actor, "parent.region.child")` checks the full path.

```ts
Actor({ regions: { health: healthMonitor, movement: movementActor }, ... });
```

- Child output events reach the parent automatically. The parent must declare the event in its `internal` (or `inputs`) to handle it.
- For dynamic children (`createActorMap`), wire outputs with `onOutput`.
- Forward events INTO a region manually. No declarative parent→child wiring:

```ts
m.onAny({
  eventRef: toggleEvent,
  handler: (_ev, { actor }) => {
    actor.regions.movement.send(jumpEvent.create());
    return {};
  },
});
```

## Other Recipes

Worked, tested examples in `packages/examples/`. Read the one that matches:

- Event sourcing (context as log + fold): `event-sourcing.test.ts`
- Saga / orchestration (emit chains, compensation via `onAny`): `saga-orchestrator.test.ts`
- Undo/redo (context snapshots as history): `undo-redo-editor.test.ts`
- Request/response with timeout: `request-response.test.ts`
- Dynamic children: `actor-map.test.ts`
- Retries and reconnects: `network-connection-manager.test.ts`, `websocket-connection.test.ts`
- Caches, auth, game state, animation: `cache-with-ttl-and-lru.test.ts`, `authentication.test.ts`, `game-character.test.ts`, `animation-ui-state.test.ts`
