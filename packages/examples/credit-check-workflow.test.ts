/**
 * Actor reimplementation of xstate credit check workflow.
 *
 * Mapping from xstate v5 → actor system:
 *   - States → state() refs
 *   - Events → event() refs
 *   - Context → mutable actor context
 *   - `invoke: fromPromise` → effect that emits internal done/error events
 *   - `assign` actions → direct context mutation in transitions
 *   - Guards → condition checks in transition handlers
 *
 * Key difference: xstate's `invoke` spawns child actors, here effects handle
 * the same logic inline with clock.setTimeout simulating async operations.
 */

import { Actor, VirtualClock, state, event } from "@mantaq/core";
import type { AnyActor, EffectInput } from "@mantaq/core";
import { matches, withTimeout } from "@mantaq/sugar";
import { describe, it, expect } from "vite-plus/test";

function inject(actor: AnyActor, event: { type: string }): void {
  actor.inject(event);
}

// ── Types ────────────────────────────────────────────────────────────
interface OrderData {
  orderId: string;
  amount: number;
  customerId: string;
}

interface CreditCheckResult {
  approved: boolean;
  reason?: string;
}

// ── States ───────────────────────────────────────────────────────────
const idleState = state("idle")();
const checkingCreditState = state("checkingCredit")();
const processingPaymentState = state("processingPayment")();
const notifyingWarehouseState = state("notifyingWarehouse")();
const orderCompleteState = state("orderComplete")().final();
const creditCheckFailedState = state("creditCheckFailed")();
const creditDeniedState = state("creditDenied")().final();
const paymentFailedState = state("paymentFailed")();
const notificationFailedState = state("notificationFailed")();

// ── Input events (external) ──────────────────────────────────────────
const startOrderEvent = event("START_ORDER")<{ order: OrderData }>();
const retryEvent = event("RETRY")();
const cancelEvent = event("CANCEL")();

// ── Internal events (from effects) ───────────────────────────────────
const creditCheckDoneEvent = event("CREDIT_CHECK_DONE")<{ result: CreditCheckResult }>();
const creditCheckErrorEvent = event("CREDIT_CHECK_ERROR")<{ error: string }>();
const paymentDoneEvent = event("PAYMENT_DONE")<{ transactionId: string }>();
const paymentErrorEvent = event("PAYMENT_ERROR")<{ error: string }>();
const notificationDoneEvent = event("NOTIFICATION_DONE")<{ warehouseConfirmed: boolean }>();
const notificationErrorEvent = event("NOTIFICATION_ERROR")<{ error: string }>();

// ── Context ──────────────────────────────────────────────────────────
type CreditCheckContext = {
  order?: OrderData;
  creditCheckResult?: CreditCheckResult;
  error?: string;
  retryCount: number;
};

function constantRandom(value: number): () => number {
  return () => value;
}

// ── Actor factory ────────────────────────────────────────────────────
function createCreditCheckActor(options: { clock?: VirtualClock; random?: () => number } = {}) {
  const c = options.clock ?? VirtualClock();
  const randomSource = options.random ?? Math.random;

  // ── Effects ────────────────────────────────────────────────────────
  function checkCreditEffect(input: EffectInput<CreditCheckContext>) {
    return withTimeout(1000, {
      input: input,
      event: () => {
        const approved = randomSource() > 0.2;
        return creditCheckDoneEvent.create({
          result: {
            approved,
            reason: approved ? "Credit OK" : "Insufficient credit",
          },
        });
      },
    });
  }

  function processPaymentEffect(input: EffectInput<CreditCheckContext>) {
    return withTimeout(1500, {
      input: input,
      event: () => paymentDoneEvent.create({ transactionId: `TXN-${Date.now()}` }),
    });
  }

  function notifyWarehouseEffect(input: EffectInput<CreditCheckContext>) {
    return withTimeout(500, {
      input: input,
      event: () => notificationDoneEvent.create({ warehouseConfirmed: true }),
    });
  }

  const initialContext: CreditCheckContext = { retryCount: 0 };

  const actor = Actor({
    inputs: [startOrderEvent, retryEvent, cancelEvent],
    outputs: [],
    internal: [
      creditCheckDoneEvent,
      creditCheckErrorEvent,
      paymentDoneEvent,
      paymentErrorEvent,
      notificationDoneEvent,
      notificationErrorEvent,
    ],
    states: [
      idleState,
      checkingCreditState,
      processingPaymentState,
      notifyingWarehouseState,
      orderCompleteState,
      creditCheckFailedState,
      creditDeniedState,
      paymentFailedState,
      notificationFailedState,
    ],
    initial: idleState,
    clock: c,
    context: initialContext,
    setup: (m) => {
      m.effect(checkingCreditState, { name: "checkCredit", fn: checkCreditEffect });
      m.effect(processingPaymentState, { name: "processPayment", fn: processPaymentEffect });
      m.effect(notifyingWarehouseState, {
        name: "notifyWarehouse",
        fn: notifyWarehouseEffect,
      });
      m.onAny({ eventRef: cancelEvent, handler: () => ({ state: idleState }) });
      m.on(idleState, {
        eventRef: startOrderEvent,
        handler: (event, { context }) => {
          const current = context.get();
          current.order = event.payload.order;
          context.set(current);
          return { state: checkingCreditState };
        },
      });
      m.on(checkingCreditState, {
        eventRef: creditCheckDoneEvent,
        handler: (event, { context }) => {
          const current = context.get();
          current.creditCheckResult = event.payload.result;
          context.set(current);
          if (event.payload.result.approved) {
            return { state: processingPaymentState };
          }
          return { state: creditDeniedState };
        },
      });
      m.on(checkingCreditState, {
        eventRef: creditCheckErrorEvent,
        handler: () => {
          return { state: creditCheckFailedState };
        },
      });
      m.on(processingPaymentState, {
        eventRef: paymentDoneEvent,
        handler: () => {
          return { state: notifyingWarehouseState };
        },
      });
      m.on(processingPaymentState, {
        eventRef: paymentErrorEvent,
        handler: () => {
          return { state: paymentFailedState };
        },
      });
      m.on(notifyingWarehouseState, {
        eventRef: notificationDoneEvent,
        handler: () => {
          return { state: orderCompleteState };
        },
      });
      m.on(notifyingWarehouseState, {
        eventRef: notificationErrorEvent,
        handler: () => {
          return { state: notificationFailedState };
        },
      });
      m.on(creditCheckFailedState, {
        eventRef: retryEvent,
        handler: (_event, { context }) => {
          const current = context.get();
          current.retryCount += 1;
          context.set(current);
          return { state: checkingCreditState };
        },
      });
      m.on(paymentFailedState, {
        eventRef: retryEvent,
        handler: () => {
          return { state: processingPaymentState };
        },
      });
      m.on(notificationFailedState, {
        eventRef: retryEvent,
        handler: () => {
          return { state: notifyingWarehouseState };
        },
      });
    },
  });

  return { actor, clock: c };
}

// ── Tests ────────────────────────────────────────────────────────────
describe("credit check actor (reimplementation of xstate machine)", () => {
  it("sets idle as the initial state", () => {
    const { actor } = createCreditCheckActor();
    expect({
      matches: matches(actor, "idle"),
      done: actor.snapshot().done,
    }).toEqual({ matches: true, done: undefined });
  });

  it("handles the full order flow through credit, payment, and warehouse notification", () => {
    const { actor, clock } = createCreditCheckActor({ random: constantRandom(0.5) }); // approved

    actor.send(
      startOrderEvent.create({
        order: { orderId: "ORD123", amount: 100, customerId: "CUST456" },
      }),
    );
    expect({
      matches: matches(actor, "checkingCredit"),
      orderId: actor.context.order?.orderId,
    }).toEqual({ matches: true, orderId: "ORD123" });

    clock.advance(1000);
    expect({
      matches: matches(actor, "processingPayment"),
      approved: actor.context.creditCheckResult?.approved,
    }).toEqual({ matches: true, approved: true });

    clock.advance(1500);
    expect(matches(actor, "notifyingWarehouse")).toBe(true);

    clock.advance(500);
    expect({
      matches: matches(actor, "orderComplete"),
      done: actor.snapshot().done,
    }).toEqual({ matches: true, done: true });
  });

  it("sets creditDenied when the credit check denies the order", () => {
    const { actor, clock } = createCreditCheckActor({ random: constantRandom(0.1) }); // denied

    actor.send(
      startOrderEvent.create({
        order: { orderId: "ORD123", amount: 100, customerId: "CUST456" },
      }),
    );
    clock.advance(1000);
    expect({
      matches: matches(actor, "creditDenied"),
      approved: actor.context.creditCheckResult?.approved,
      reason: actor.context.creditCheckResult?.reason,
      done: actor.snapshot().done,
    }).toEqual({
      matches: true,
      approved: false,
      reason: "Insufficient credit",
      done: true,
    });
  });

  it("adds one retry and rechecks credit when RETRY fires after a credit check error", () => {
    const { actor, clock } = createCreditCheckActor({ random: constantRandom(0.5) });

    // Force credit check error by making setTimeout fire but with abort
    actor.send(
      startOrderEvent.create({
        order: { orderId: "ORD123", amount: 100, customerId: "CUST456" },
      }),
    );
    expect(matches(actor, "checkingCredit")).toBe(true);

    // Simulate error - we need to emit the error event directly
    inject(actor, creditCheckErrorEvent.create({ error: "Network failure" }));
    expect({
      matches: matches(actor, "creditCheckFailed"),
      storedError: actor.context.error,
    }).toEqual({ matches: true, storedError: undefined }); // error not stored in this impl

    actor.send(retryEvent.create());
    expect({
      matches: matches(actor, "checkingCredit"),
      retryCount: actor.context.retryCount,
    }).toEqual({ matches: true, retryCount: 1 });

    clock.advance(1000);
    expect(matches(actor, "processingPayment")).toBe(true);
  });

  it("returns to idle when CANCEL fires from creditCheckFailed", () => {
    const { actor } = createCreditCheckActor();

    actor.send(
      startOrderEvent.create({
        order: { orderId: "ORD123", amount: 100, customerId: "CUST456" },
      }),
    );
    inject(actor, creditCheckErrorEvent.create({ error: "Network failure" }));
    expect(matches(actor, "creditCheckFailed")).toBe(true);

    actor.send(cancelEvent.create());
    expect(matches(actor, "idle")).toBe(true);
  });

  it("returns to processingPayment when RETRY fires from paymentFailed", () => {
    const { actor, clock } = createCreditCheckActor({ random: constantRandom(0.5) });

    actor.send(
      startOrderEvent.create({
        order: { orderId: "ORD123", amount: 100, customerId: "CUST456" },
      }),
    );
    clock.advance(1000); // credit check done
    expect(matches(actor, "processingPayment")).toBe(true);
    inject(actor, paymentErrorEvent.create({ error: "Payment declined" }));
    expect(matches(actor, "paymentFailed")).toBe(true);

    actor.send(retryEvent.create());
    expect(matches(actor, "processingPayment")).toBe(true);

    clock.advance(1500);
    expect(matches(actor, "notifyingWarehouse")).toBe(true);
  });

  it("returns to idle when CANCEL fires from paymentFailed", () => {
    const { actor, clock } = createCreditCheckActor({ random: constantRandom(0.5) });

    actor.send(
      startOrderEvent.create({
        order: { orderId: "ORD123", amount: 100, customerId: "CUST456" },
      }),
    );
    clock.advance(1000);
    inject(actor, paymentErrorEvent.create({ error: "Payment declined" }));
    expect(matches(actor, "paymentFailed")).toBe(true);

    actor.send(cancelEvent.create());
    expect(matches(actor, "idle")).toBe(true);
  });

  it("returns to notifyingWarehouse when RETRY fires from notificationFailed", () => {
    const { actor, clock } = createCreditCheckActor({ random: constantRandom(0.5) });

    actor.send(
      startOrderEvent.create({
        order: { orderId: "ORD123", amount: 100, customerId: "CUST456" },
      }),
    );
    /** Advance past the credit-check timer, then the payment timer */
    clock.advance(1000);
    clock.advance(1500);
    expect(matches(actor, "notifyingWarehouse")).toBe(true);
    inject(actor, notificationErrorEvent.create({ error: "Warehouse unavailable" }));
    expect(matches(actor, "notificationFailed")).toBe(true);

    actor.send(retryEvent.create());
    expect(matches(actor, "notifyingWarehouse")).toBe(true);

    clock.advance(500);
    expect(matches(actor, "orderComplete")).toBe(true);
  });

  it("returns to idle when CANCEL fires from notificationFailed", () => {
    const { actor, clock } = createCreditCheckActor({ random: constantRandom(0.5) });

    actor.send(
      startOrderEvent.create({
        order: { orderId: "ORD123", amount: 100, customerId: "CUST456" },
      }),
    );
    clock.advance(1000);
    clock.advance(1500);
    inject(actor, notificationErrorEvent.create({ error: "Warehouse unavailable" }));
    expect(matches(actor, "notificationFailed")).toBe(true);

    actor.send(cancelEvent.create());
    expect(matches(actor, "idle")).toBe(true);
  });

  it("keeps order data consistent across the full flow", () => {
    const { actor, clock } = createCreditCheckActor({ random: constantRandom(0.5) });

    expect({
      order: actor.context.order,
      creditCheckResult: actor.context.creditCheckResult,
      retryCount: actor.context.retryCount,
    }).toEqual({ order: undefined, creditCheckResult: undefined, retryCount: 0 });

    actor.send(
      startOrderEvent.create({
        order: { orderId: "ORD123", amount: 100, customerId: "CUST456" },
      }),
    );
    expect({
      orderId: actor.context.order?.orderId,
      amount: actor.context.order?.amount,
    }).toEqual({ orderId: "ORD123", amount: 100 });

    clock.advance(1000);
    expect({ approved: actor.context.creditCheckResult?.approved }).toEqual({ approved: true });

    clock.advance(1500);
    clock.advance(500);
    expect({ done: actor.snapshot().done }).toEqual({ done: true });
  });

  it("keeps an aborted effect from firing after the state changes", () => {
    const { actor, clock } = createCreditCheckActor({ random: constantRandom(0.5) });

    actor.send(
      startOrderEvent.create({
        order: { orderId: "ORD123", amount: 100, customerId: "CUST456" },
      }),
    );
    expect(matches(actor, "checkingCredit")).toBe(true);

    // Abort by sending error event before timeout completes
    inject(actor, creditCheckErrorEvent.create({ error: "Forced error" }));
    expect(matches(actor, "creditCheckFailed")).toBe(true);

    // Advancing clock should not affect anything (effect aborted)
    clock.advance(1000);
    expect(matches(actor, "creditCheckFailed")).toBe(true);
  });

  it("adds one retry per RETRY after repeated errors", () => {
    const { actor, clock } = createCreditCheckActor({ random: constantRandom(0.5) });

    actor.send(
      startOrderEvent.create({
        order: { orderId: "ORD123", amount: 100, customerId: "CUST456" },
      }),
    );

    // First error + retry
    inject(actor, creditCheckErrorEvent.create({ error: "Error 1" }));
    actor.send(retryEvent.create());
    expect({ retryCount: actor.context.retryCount }).toEqual({ retryCount: 1 });

    // Second error + retry
    inject(actor, creditCheckErrorEvent.create({ error: "Error 2" }));
    actor.send(retryEvent.create());
    expect({ retryCount: actor.context.retryCount }).toEqual({ retryCount: 2 });

    // Third attempt succeeds
    clock.advance(1000);
    expect(matches(actor, "processingPayment")).toBe(true);
  });
});
