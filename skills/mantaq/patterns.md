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

## Big Machine → Parent That Embeds Smaller Machines

Split a machine when it has more than about 12 states, when the same handler is registered in a loop over many states, or when a group of states has one way in, a few ways out and no other arrows to the rest. Do not add more states to it. Move each group into its own machine with final states for its ends. In the parent, replace the group with one state that runs the child with `embed` from `@mantaq/sugar`. The viz draws that state as one machine node with its arrows; the reader enters it to see the child.

```ts
import { Actor, event, machine, state } from "@mantaq/core";
import type { Snapshot } from "@mantaq/core";
import { embed, withPromise } from "@mantaq/sugar";

/** Asks the card provider to take the money. */
declare function chargeCard(): Promise<"accepted" | "declined">;

/** The card is being charged. */
const chargingCard = state("chargingCard")();
/** The card was declined; the screen shows a retry button. */
const couldNotChargeCard = state("couldNotChargeCard")();
/** The money is taken. */
const paymentTaken = state("paymentTaken")().final();
/** The provider took the money. */
const cardAccepted = event("cardAccepted")();
/** The provider declined the card. */
const cardDeclined = event("cardDeclined")();
/** The shopper asks to charge the card again. */
const retryPayment = event("retryPayment")();

export const payment = machine("payment", {
  create: () =>
    Actor({
      inputs: [retryPayment],
      internal: [cardAccepted, cardDeclined],
      states: [chargingCard, couldNotChargeCard, paymentTaken],
      initial: chargingCard,
      setup: (m) => {
        m.effect(chargingCard, {
          name: "chargeCard",
          sends: [cardAccepted, cardDeclined],
          fn: (input) =>
            withPromise({
              promise: chargeCard(),
              signal: input.signal,
              emit: input.emit,
              events: {
                success: (answer) =>
                  answer === "accepted" ? cardAccepted.create() : cardDeclined.create(),
                error: () => cardDeclined.create(),
              },
            }),
        });
        m.on(chargingCard, {
          event: cardAccepted,
          to: [paymentTaken],
          handler: () => ({ state: paymentTaken }),
        });
        m.on(chargingCard, {
          event: cardDeclined,
          to: [couldNotChargeCard],
          handler: () => ({ state: couldNotChargeCard }),
        });
        m.on(couldNotChargeCard, {
          event: retryPayment,
          to: [chargingCard],
          handler: () => ({ state: chargingCard }),
        });
      },
    }),
});

/** The payment machine runs. */
const payingForOrder = state("payingForOrder")();
/** The order is paid. */
const orderPaid = state("orderPaid")().final();
/** The payment machine broke; the shopper sees an apology. */
const couldNotPay = state("couldNotPay")().final();
/** The payment machine ended in `paymentTaken`. */
const paymentWentThrough = event("paymentWentThrough")();
/** The payment machine entered `__error`. */
const paymentBroke = event("paymentBroke")();
/** The payment machine changed; the payload is its snapshot. */
const paymentChanged = event("paymentChanged")<Snapshot>();

const noPaymentYet: { payment: Snapshot | undefined } = { payment: undefined };

export const order = machine("order", {
  create: ({ clock }) =>
    Actor({
      inputs: [retryPayment],
      internal: [paymentWentThrough, paymentBroke, paymentChanged],
      states: [payingForOrder, orderPaid, couldNotPay],
      initial: payingForOrder,
      context: noPaymentYet,
      clock,
      setup: (m) => {
        embed(m, {
          in: payingForOrder,
          machine: payment,
          done: { paymentTaken: paymentWentThrough },
          error: paymentBroke,
          forward: [retryPayment],
          snapshot: paymentChanged,
        });
        m.on(payingForOrder, {
          event: paymentChanged,
          handler: (changed, { context }) => context.set({ payment: changed.payload }),
        });
        m.on(payingForOrder, {
          event: paymentWentThrough,
          to: [orderPaid],
          handler: () => ({ state: orderPaid }),
        });
        m.on(payingForOrder, {
          event: paymentBroke,
          to: [couldNotPay],
          handler: () => ({ state: couldNotPay }),
        });
      },
    }),
});
```

- `done` maps each final state of the child to a parent internal event without a payload. `error` is the parent event for a child in `__error`. Handle them with plain `m.on` in the embedding state, so the diagram draws the arrows.
- The app sends only to the parent. `forward` lists the parent inputs that go on to the running child (a retry button). Never add a second handler for a forwarded event in that state: the last one replaces the other.
- `snapshot` names a parent internal event that carries the child snapshot on entry and after each change. Keep it in context so the screen can read the child state (`context.payment.path`). After the parent leaves, the field keeps the last snapshot: check the parent state too.
- The parent needs a clock, even when no child has a timer. Embed builds the child with the parent clock only. A child that needs a port: build its machine in the parent `create` with that port (`paymentMachine({ port })`).
- Test through the parent with a `VirtualClock` and fake ports, as the app uses it. `settled()` also waits for the child effects.
- Keep a group in the parent when its handlers read and write the parent context: the child cannot read it. Always-on parallel parts are `regions`; a run-time count of children is `createActorMap`.

Full example: [`packages/examples/order/`](https://github.com/AndersCan/mantaq/tree/main/packages/examples/order). Guide: [Split a big machine](https://anderscan.github.io/mantaq/guides/split-a-big-machine/).

## Other Recipes

Worked, tested examples in [`packages/examples/`](https://github.com/AndersCan/mantaq/tree/main/packages/examples). Read the one that matches:

- Event sourcing (context as log + fold): [`event-sourcing.test.ts`](https://github.com/AndersCan/mantaq/blob/main/packages/examples/event-sourcing.test.ts)
- Saga / orchestration (emit chains, compensation via `onAny`): [`saga-orchestrator.test.ts`](https://github.com/AndersCan/mantaq/blob/main/packages/examples/saga-orchestrator.test.ts)
- Undo/redo (context snapshots as history): [`undo-redo-editor.test.ts`](https://github.com/AndersCan/mantaq/blob/main/packages/examples/undo-redo-editor.test.ts)
- Request/response with timeout: [`request-response.test.ts`](https://github.com/AndersCan/mantaq/blob/main/packages/examples/request-response.test.ts)
- Dynamic children: [`actor-map.test.ts`](https://github.com/AndersCan/mantaq/blob/main/packages/examples/actor-map.test.ts)
- Retries and reconnects: [`network-connection-manager.test.ts`](https://github.com/AndersCan/mantaq/blob/main/packages/examples/network-connection-manager.test.ts), [`websocket-connection.test.ts`](https://github.com/AndersCan/mantaq/blob/main/packages/examples/websocket-connection.test.ts)
- Caches, auth, game state, animation: [`cache-with-ttl-and-lru.test.ts`](https://github.com/AndersCan/mantaq/blob/main/packages/examples/cache-with-ttl-and-lru.test.ts), [`authentication.test.ts`](https://github.com/AndersCan/mantaq/blob/main/packages/examples/authentication.test.ts), [`game-character.test.ts`](https://github.com/AndersCan/mantaq/blob/main/packages/examples/game-character.test.ts), [`animation-ui-state.test.ts`](https://github.com/AndersCan/mantaq/blob/main/packages/examples/animation-ui-state.test.ts)
