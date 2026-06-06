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
 * Key difference: xstate's `invoke` spawns child actors; here effects handle
 * the same logic inline with clock.setTimeout simulating async operations.
 */

import { describe, it, expect, vi } from "vite-plus/test";
import { Actor, VirtualClock } from "@mantaq/core";
import { state } from "@mantaq/core";
import { event } from "@mantaq/core";
import { matches, withTimeout } from "@mantaq/sugar";

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

// ── Effects ──────────────────────────────────────────────────────────
const checkCreditEffect: InstanceType<typeof Actor>["options"]["effects"][string] = [
  (input) =>
    withTimeout(1000, input, () => {
      const approved = Math.random() > 0.2;
      return creditCheckDoneEvent.create({
        result: {
          approved,
          reason: approved ? "Credit OK" : "Insufficient credit",
        },
      });
    }),
];

const processPaymentEffect: InstanceType<typeof Actor>["options"]["effects"][string] = [
  (input) =>
    withTimeout(1500, input, () => paymentDoneEvent.create({ transactionId: `TXN-${Date.now()}` })),
];

const notifyWarehouseEffect: InstanceType<typeof Actor>["options"]["effects"][string] = [
  (input) =>
    withTimeout(500, input, () => notificationDoneEvent.create({ warehouseConfirmed: true })),
];

// ── Actor factory ────────────────────────────────────────────────────
function createCreditCheckActor(clock?: VirtualClock) {
  const c = clock ?? new VirtualClock();

  const actor = new Actor({
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
    context: { retryCount: 0 } as CreditCheckContext,
    effects: {
      checkingCredit: checkCreditEffect,
      processingPayment: processPaymentEffect,
      notifyingWarehouse: notifyWarehouseEffect,
    },
    transitions: {
      Any: {
        CANCEL: () => ({ state: idleState }),
      },
      idle: {
        START_ORDER: (event, { context }) => {
          context.order = event.order;
          return { state: checkingCreditState };
        },
      },
      checkingCredit: {
        CREDIT_CHECK_DONE: (event, { context }) => {
          context.creditCheckResult = event.result;
          if (event.result.approved) {
            return { state: processingPaymentState };
          }
          return { state: creditDeniedState };
        },
        CREDIT_CHECK_ERROR: (_event, _context) => {
          return { state: creditCheckFailedState };
        },
      },
      processingPayment: {
        PAYMENT_DONE: (_event, _context) => {
          return { state: notifyingWarehouseState };
        },
        PAYMENT_ERROR: (_event, _context) => {
          return { state: paymentFailedState };
        },
      },
      notifyingWarehouse: {
        NOTIFICATION_DONE: (_event, _context) => {
          return { state: orderCompleteState };
        },
        NOTIFICATION_ERROR: (_event, _context) => {
          return { state: notificationFailedState };
        },
      },
      creditCheckFailed: {
        RETRY: (_event, { context }) => {
          context.retryCount++;
          return { state: checkingCreditState };
        },
      },
      paymentFailed: {
        RETRY: (_event, _context) => {
          return { state: processingPaymentState };
        },
      },
      notificationFailed: {
        RETRY: (_event, _context) => {
          return { state: notifyingWarehouseState };
        },
      },
    },
  });

  return { actor, clock: c };
}

// ── Tests ────────────────────────────────────────────────────────────
describe("credit check actor (reimplementation of xstate machine)", () => {
  let mathRandomSpy: ReturnType<typeof vi.spyOn>;

  it("starts in idle state", () => {
    const { actor } = createCreditCheckActor();
    expect(matches(actor, "idle")).toBe(true);
    expect(actor.snapshot().done).toBeFalsy();
  });

  it("START_ORDER → checkingCredit → processingPayment → notifyingWarehouse → orderComplete (success path)", () => {
    mathRandomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5); // approved
    const { actor, clock } = createCreditCheckActor();

    actor.send(
      startOrderEvent.create({
        order: { orderId: "ORD123", amount: 100, customerId: "CUST456" },
      }),
    );
    expect(matches(actor, "checkingCredit")).toBe(true);
    expect(actor.context.order?.orderId).toBe("ORD123");

    clock.advance(1000);
    expect(matches(actor, "processingPayment")).toBe(true);
    expect(actor.context.creditCheckResult?.approved).toBe(true);

    clock.advance(1500);
    expect(matches(actor, "notifyingWarehouse")).toBe(true);

    clock.advance(500);
    expect(matches(actor, "orderComplete")).toBe(true);
    expect(actor.snapshot().done).toBe(true);
    mathRandomSpy.mockRestore();
  });

  it("START_ORDER → checkingCredit → creditDenied (denied path)", () => {
    mathRandomSpy = vi.spyOn(Math, "random").mockReturnValue(0.1); // denied
    const { actor, clock } = createCreditCheckActor();

    actor.send(
      startOrderEvent.create({
        order: { orderId: "ORD123", amount: 100, customerId: "CUST456" },
      }),
    );
    clock.advance(1000);
    expect(matches(actor, "creditDenied")).toBe(true);
    expect(actor.context.creditCheckResult?.approved).toBe(false);
    expect(actor.context.creditCheckResult?.reason).toBe("Insufficient credit");
    expect(actor.snapshot().done).toBe(true);
    mathRandomSpy.mockRestore();
  });

  it("RETRY from creditCheckFailed → checkingCredit increments retryCount", () => {
    mathRandomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { actor, clock } = createCreditCheckActor();

    // Force credit check error by making setTimeout fire but with abort
    actor.send(
      startOrderEvent.create({
        order: { orderId: "ORD123", amount: 100, customerId: "CUST456" },
      }),
    );
    expect(matches(actor, "checkingCredit")).toBe(true);

    // Simulate error - we need to emit the error event directly
    actor.send(creditCheckErrorEvent.create({ error: "Network failure" }));
    expect(matches(actor, "creditCheckFailed")).toBe(true);
    expect(actor.context.error).toBeUndefined(); // error not stored in this impl

    actor.send(retryEvent);
    expect(matches(actor, "checkingCredit")).toBe(true);
    expect(actor.context.retryCount).toBe(1);

    clock.advance(1000);
    expect(matches(actor, "processingPayment")).toBe(true);
    mathRandomSpy.mockRestore();
  });

  it("CANCEL from creditCheckFailed → idle", () => {
    const { actor } = createCreditCheckActor();

    actor.send(
      startOrderEvent.create({
        order: { orderId: "ORD123", amount: 100, customerId: "CUST456" },
      }),
    );
    actor.send(creditCheckErrorEvent.create({ error: "Network failure" }));
    expect(matches(actor, "creditCheckFailed")).toBe(true);

    actor.send(cancelEvent);
    expect(matches(actor, "idle")).toBe(true);
  });

  it("RETRY from paymentFailed → processingPayment", () => {
    mathRandomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { actor, clock } = createCreditCheckActor();

    actor.send(
      startOrderEvent.create({
        order: { orderId: "ORD123", amount: 100, customerId: "CUST456" },
      }),
    );
    clock.advance(1000); // credit check done
    expect(matches(actor, "processingPayment")).toBe(true);

    actor.send(paymentErrorEvent.create({ error: "Payment declined" }));
    expect(matches(actor, "paymentFailed")).toBe(true);

    actor.send(retryEvent);
    expect(matches(actor, "processingPayment")).toBe(true);

    clock.advance(1500);
    expect(matches(actor, "notifyingWarehouse")).toBe(true);
    mathRandomSpy.mockRestore();
  });

  it("CANCEL from paymentFailed → idle", () => {
    mathRandomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { actor, clock } = createCreditCheckActor();

    actor.send(
      startOrderEvent.create({
        order: { orderId: "ORD123", amount: 100, customerId: "CUST456" },
      }),
    );
    clock.advance(1000);
    actor.send(paymentErrorEvent.create({ error: "Payment declined" }));
    expect(matches(actor, "paymentFailed")).toBe(true);

    actor.send(cancelEvent);
    expect(matches(actor, "idle")).toBe(true);
    mathRandomSpy.mockRestore();
  });

  it("RETRY from notificationFailed → notifyingWarehouse", () => {
    mathRandomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { actor, clock } = createCreditCheckActor();

    actor.send(
      startOrderEvent.create({
        order: { orderId: "ORD123", amount: 100, customerId: "CUST456" },
      }),
    );
    clock.advance(1000); // credit check
    clock.advance(1500); // payment
    expect(matches(actor, "notifyingWarehouse")).toBe(true);

    actor.send(notificationErrorEvent.create({ error: "Warehouse unavailable" }));
    expect(matches(actor, "notificationFailed")).toBe(true);

    actor.send(retryEvent);
    expect(matches(actor, "notifyingWarehouse")).toBe(true);

    clock.advance(500);
    expect(matches(actor, "orderComplete")).toBe(true);
    mathRandomSpy.mockRestore();
  });

  it("CANCEL from notificationFailed → idle", () => {
    mathRandomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { actor, clock } = createCreditCheckActor();

    actor.send(
      startOrderEvent.create({
        order: { orderId: "ORD123", amount: 100, customerId: "CUST456" },
      }),
    );
    clock.advance(1000);
    clock.advance(1500);
    actor.send(notificationErrorEvent.create({ error: "Warehouse unavailable" }));
    expect(matches(actor, "notificationFailed")).toBe(true);

    actor.send(cancelEvent);
    expect(matches(actor, "idle")).toBe(true);
    mathRandomSpy.mockRestore();
  });

  it("context accumulates correctly across full flow", () => {
    mathRandomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { actor, clock } = createCreditCheckActor();

    expect(actor.context.order).toBeUndefined();
    expect(actor.context.creditCheckResult).toBeUndefined();
    expect(actor.context.retryCount).toBe(0);

    actor.send(
      startOrderEvent.create({
        order: { orderId: "ORD123", amount: 100, customerId: "CUST456" },
      }),
    );
    expect(actor.context.order?.orderId).toBe("ORD123");
    expect(actor.context.order?.amount).toBe(100);

    clock.advance(1000);
    expect(actor.context.creditCheckResult?.approved).toBe(true);

    clock.advance(1500);
    clock.advance(500);
    expect(actor.snapshot().done).toBe(true);
    mathRandomSpy.mockRestore();
  });

  it("effect aborts if state changes before timeout", () => {
    mathRandomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { actor, clock } = createCreditCheckActor();

    actor.send(
      startOrderEvent.create({
        order: { orderId: "ORD123", amount: 100, customerId: "CUST456" },
      }),
    );
    expect(matches(actor, "checkingCredit")).toBe(true);

    // Abort by sending error event before timeout completes
    actor.send(creditCheckErrorEvent.create({ error: "Forced error" }));
    expect(matches(actor, "creditCheckFailed")).toBe(true);

    // Advancing clock should not affect anything (effect aborted)
    clock.advance(1000);
    expect(matches(actor, "creditCheckFailed")).toBe(true);
    mathRandomSpy.mockRestore();
  });

  it("multiple retries increment retryCount correctly", () => {
    mathRandomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { actor, clock } = createCreditCheckActor();

    actor.send(
      startOrderEvent.create({
        order: { orderId: "ORD123", amount: 100, customerId: "CUST456" },
      }),
    );

    // First error + retry
    actor.send(creditCheckErrorEvent.create({ error: "Error 1" }));
    actor.send(retryEvent);
    expect(actor.context.retryCount).toBe(1);

    // Second error + retry
    actor.send(creditCheckErrorEvent.create({ error: "Error 2" }));
    actor.send(retryEvent);
    expect(actor.context.retryCount).toBe(2);

    // Third attempt succeeds
    clock.advance(1000);
    expect(matches(actor, "processingPayment")).toBe(true);
    mathRandomSpy.mockRestore();
  });
});
