# Patterns

Proven recipes. Code is a sketch. Start from the shape, then check signatures against the installed types. Full working versions: [`packages/examples/`](https://github.com/AndersCan/mantaq/tree/main/packages/examples).

## Async Work → Effect + Internal Event

State enters "working", effect runs the async job, emits internal event, transition completes.

```ts
import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { withTimeout } from "@mantaq/sugar";

const submit = event("SUBMIT")();
const fillingForm = state("fillingForm")();
const submitting = state("submitting")();
const submitted = state("submitted")().final();
const submittingDone = event("SUBMITTING_DONE")();

Actor({
  inputs: [submit],
  internal: [submittingDone],
  states: [fillingForm, submitting, submitted],
  initial: fillingForm,
  clock: VirtualClock(),
  setup: (m) => {
    m.on(fillingForm, { event: submit, to: [submitting], handler: () => ({ state: submitting }) });
    m.effect(submitting, {
      name: "startSubmitTimeout",
      sends: [submittingDone],
      fn: (input) => withTimeout(800, { input, event: () => submittingDone.create() }),
    });
    m.on(submitting, {
      event: submittingDone,
      to: [submitted],
      handler: () => ({ state: submitted }),
    });
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

<!-- docs-check: skip -->

```ts
clock.setTimeout(delay, { signal, cb: () => emit(retryDone.create()) });
```

## Cross-State Handling → onAny

Events that do the same thing in every state (cancel, disconnect, purge). The target may depend on payload or context, never on the current state. Diagrams draw it once, from "any state".

<!-- docs-check: skip -->

```ts
m.onAny({ event: disconnect, to: [disconnected], handler: () => ({ state: disconnected }) });
```

Target depends on the current state (back, next)? One `m.on` per state, not `onAny` branching on the handler's `state`. Each registration then declares its exact target and the diagram shows exact source/target pairs (`@mantaq/inspect` warns otherwise).

<!-- docs-check: skip -->

```ts
m.on(payment, { event: back, to: [shippingAddress], handler: () => ({ state: shippingAddress }) });
m.on(error, { event: back, to: [payment], handler: () => ({ state: payment }) });
```

## Parallel Concerns → Regions

Independent sub-behaviors as child actors. Parent + children in one snapshot; `matches(actor, "parent.region.child")` checks the full path.

<!-- docs-check: skip -->

```ts
Actor({ regions: { health: healthMonitor, movement: movementActor }, ... });
```

- Child output events reach the parent automatically. The parent must declare the event in its `internal` (or `inputs`) to handle it.
- For dynamic children (`createActorMap`), wire outputs with `onOutput`.
- A region only gets events sent to it: `actor.regions.upload.send(…)`. In the viz, click an arrow inside the region.
- Forward events INTO a region manually. No declarative parent→child wiring:

<!-- docs-check: skip -->

```ts
m.onAny({
  event: toggleEvent,
  handler: (_ev, { actor }) => {
    actor.regions.movement.send(jumpEvent.create());
    return {};
  },
});
```

## Big Machine → Group States

If a machine has more than about 12 states, and some of them are one step of the journey (one way in, few ways out), tag each state of that step with `@group <name>` in its JSDoc (`@mantaq/inspect` 0.49 and `@mantaq/viz` 0.42 or later). The viewer draws the group as one node. The reader clicks `enter` on it to see its states, and `?focus=@payment` links there. Only the drawing changes: one actor, one context, one walk, and every arrow from the current state still sends.

```ts
import { Actor, event, state } from "@mantaq/core";

const reviewingOrder = state("reviewingOrder")();
/** The card provider charges the card. @group payment */
const chargingCard = state("chargingCard")();
/** The card provider declined the card. @group payment */
const cardDeclined = state("cardDeclined")();
const packingParcel = state("packingParcel")();

const placeOrder = event("placeOrder")();
const declined = event("declined")();
const retryCard = event("retryCard")();
const charged = event("charged")();

Actor({
  inputs: [placeOrder, declined, retryCard, charged],
  states: [reviewingOrder, chargingCard, cardDeclined, packingParcel],
  initial: reviewingOrder,
  setup: (m) => {
    m.on(reviewingOrder, {
      event: placeOrder,
      to: [chargingCard],
      handler: () => ({ state: chargingCard }),
    });
    m.on(chargingCard, {
      event: declined,
      to: [cardDeclined],
      handler: () => ({ state: cardDeclined }),
    });
    m.on(cardDeclined, {
      event: retryCard,
      to: [chargingCard],
      handler: () => ({ state: chargingCard }),
    });
    m.on(chargingCard, {
      event: charged,
      to: [packingParcel],
      handler: () => ({ state: packingParcel }),
    });
  },
});
```

- If the states share the data of the machine and only this machine sends to them, group them.
- If the part runs at the same time as the rest, other code sends to it directly, or several machines use it, split it into another machine. Use a region, or `return { actor, other }` (designing.md section 11). Each machine gets its own walk.
- Limits: one group per state, no `.` in the name, all states of a group in one region, none in an actor map.
- Full example: [`order/order.ts`](https://github.com/AndersCan/mantaq/blob/main/packages/examples/order/order.ts); guide: https://anderscan.github.io/mantaq/guides/group-states/

## Other Recipes

Worked, tested examples in [`packages/examples/`](https://github.com/AndersCan/mantaq/tree/main/packages/examples). Read the one that matches:

- Event sourcing (context as log + fold): [`event-sourcing.test.ts`](https://github.com/AndersCan/mantaq/blob/main/packages/examples/event-sourcing.test.ts)
- Saga / orchestration (emit chains, compensation via `onAny`): [`saga-orchestrator.test.ts`](https://github.com/AndersCan/mantaq/blob/main/packages/examples/saga-orchestrator.test.ts)
- Undo/redo (context snapshots as history): [`undo-redo-editor.test.ts`](https://github.com/AndersCan/mantaq/blob/main/packages/examples/undo-redo-editor.test.ts)
- Request/response with timeout: [`request-response.test.ts`](https://github.com/AndersCan/mantaq/blob/main/packages/examples/request-response.test.ts)
- Dynamic children: [`actor-map.test.ts`](https://github.com/AndersCan/mantaq/blob/main/packages/examples/actor-map.test.ts)
- Retries and reconnects: [`network-connection-manager.test.ts`](https://github.com/AndersCan/mantaq/blob/main/packages/examples/network-connection-manager.test.ts), [`websocket-connection.test.ts`](https://github.com/AndersCan/mantaq/blob/main/packages/examples/websocket-connection.test.ts)
- Caches, auth, game state, animation: [`cache-with-ttl-and-lru.test.ts`](https://github.com/AndersCan/mantaq/blob/main/packages/examples/cache-with-ttl-and-lru.test.ts), [`authentication.test.ts`](https://github.com/AndersCan/mantaq/blob/main/packages/examples/authentication.test.ts), [`game-character.test.ts`](https://github.com/AndersCan/mantaq/blob/main/packages/examples/game-character.test.ts), [`animation-ui-state.test.ts`](https://github.com/AndersCan/mantaq/blob/main/packages/examples/animation-ui-state.test.ts)
