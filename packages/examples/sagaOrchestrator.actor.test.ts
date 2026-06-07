/**
 * Problem: Distributed transactions (saga pattern).
 *   Order → Reserve Inventory → Process Payment → Create Shipment → Notify.
 *   Each step may fail; on failure, execute compensating actions in reverse order.
 *   Classic microservices pattern where no distributed locks exist.
 *
 * Actor model approach:
 *   - Orchestrator actor coordinates the saga via state transitions
 *   - Context tracks what succeeded (for compensation routing)
 *   - Effects simulate service calls, emit internal done/error events
 *   - `Any` handler for CANCEL simplifies cancel from any step
 *   - Compensating states handle rollback sequencing
 *
 * Structure:
 *   idle → reservingInventory → processingPayment → creatingShipment → notifying → completed
 *                                                ↘ (FAIL) ↘ (FAIL) ↘ (FAIL)
 *                                          compensatingRefund → compensatingRelease → failed
 *                                          compensatingRelease → failed
 *                                          (no-op) → failed
 */

import { describe, it, expect } from "vite-plus/test";
import { Actor, VirtualClock } from "@mantaq/core";
import { state } from "@mantaq/core";
import { event } from "@mantaq/core";
import { matches } from "@mantaq/sugar";

// ── Types ────────────────────────────────────────────────────────────
interface OrderRequest {
  orderId: string;
  items: string[];
  amount: number;
}

interface InventoryResult {
  reservationId: string;
}

interface PaymentResult {
  transactionId: string;
}

interface ShipmentResult {
  trackingNumber: string;
}

// ── States ───────────────────────────────────────────────────────────
const idleState = state("idle")();
const reservingInventoryState = state("reservingInventory")();
const processingPaymentState = state("processingPayment")();
const creatingShipmentState = state("creatingShipment")();
const notifyingState = state("notifying")();
const completedState = state("completed")().final();
const failedState = state("failed")().final();
const compensatingRefundState = state("compensatingRefund")();
const compensatingReleaseState = state("compensatingRelease")();

// ── External events ──────────────────────────────────────────────────
const startEvent = event("START")<{ order: OrderRequest }>();
const cancelEvent = event("CANCEL")();

// ── Internal events (service responses) ──────────────────────────────
const inventoryReservedEvent = event("INVENTORY_RESERVED")<{ result: InventoryResult }>();
const inventoryFailedEvent = event("INVENTORY_FAILED")<{ error: string }>();
const paymentProcessedEvent = event("PAYMENT_PROCESSED")<{ result: PaymentResult }>();
const paymentFailedEvent = event("PAYMENT_FAILED")<{ error: string }>();
const shipmentCreatedEvent = event("SHIPMENT_CREATED")<{ result: ShipmentResult }>();
const shipmentFailedEvent = event("SHIPMENT_FAILED")<{ error: string }>();
const notificationSentEvent = event("NOTIFICATION_SENT")();
const notificationFailedEvent = event("NOTIFICATION_FAILED")<{ error: string }>();
const refundDoneEvent = event("REFUND_DONE")();
const refundFailedEvent = event("REFUND_FAILED")<{ error: string }>();
const releaseDoneEvent = event("RELEASE_DONE")();
const releaseFailedEvent = event("RELEASE_FAILED")<{ error: string }>();

// ── Context ──────────────────────────────────────────────────────────
type SagaContext = {
  order?: OrderRequest;
  reservationId?: string;
  transactionId?: string;
  trackingNumber?: string;
  error?: string;
  completedSteps: string[];
};

// ── Effect type shorthand ────────────────────────────────────────────
type Effects = InstanceType<typeof Actor>["options"]["effects"];

// ── Actor factory ────────────────────────────────────────────────────
function createSagaActor(clock?: VirtualClock) {
  const c = clock ?? new VirtualClock();

  const effects: Effects = {
    reservingInventory: [
      (input) => {
        input.clock.setTimeout(100, () => {
          if (input.signal.aborted) return;
          const ctx = input.context as SagaContext;
          input.emit(
            inventoryReservedEvent.create({
              result: { reservationId: `RES-${ctx.order?.orderId ?? "unknown"}` },
            }),
          );
        });
      },
    ],
    processingPayment: [
      (input) => {
        input.clock.setTimeout(200, () => {
          if (input.signal.aborted) return;
          const ctx = input.context as SagaContext;
          input.emit(
            paymentProcessedEvent.create({
              result: { transactionId: `TXN-${ctx.order?.orderId ?? "unknown"}` },
            }),
          );
        });
      },
    ],
    creatingShipment: [
      (input) => {
        input.clock.setTimeout(150, () => {
          if (input.signal.aborted) return;
          const ctx = input.context as SagaContext;
          input.emit(
            shipmentCreatedEvent.create({
              result: { trackingNumber: `TRK-${ctx.order?.orderId ?? "unknown"}` },
            }),
          );
        });
      },
    ],
    notifying: [
      (input) => {
        input.clock.setTimeout(50, () => {
          if (input.signal.aborted) return;
          input.emit(notificationSentEvent.create(undefined));
        });
      },
    ],
    compensatingRefund: [
      (input) => {
        input.clock.setTimeout(100, () => {
          if (input.signal.aborted) return;
          input.emit(refundDoneEvent.create(undefined));
        });
      },
    ],
    compensatingRelease: [
      (input) => {
        input.clock.setTimeout(80, () => {
          if (input.signal.aborted) return;
          input.emit(releaseDoneEvent.create(undefined));
        });
      },
    ],
  };

  const actor = new Actor({
    inputs: [startEvent, cancelEvent],
    outputs: [],
    internal: [
      inventoryReservedEvent,
      inventoryFailedEvent,
      paymentProcessedEvent,
      paymentFailedEvent,
      shipmentCreatedEvent,
      shipmentFailedEvent,
      notificationSentEvent,
      notificationFailedEvent,
      refundDoneEvent,
      refundFailedEvent,
      releaseDoneEvent,
      releaseFailedEvent,
    ],
    states: [
      idleState,
      reservingInventoryState,
      processingPaymentState,
      creatingShipmentState,
      notifyingState,
      completedState,
      failedState,
      compensatingRefundState,
      compensatingReleaseState,
    ],
    initial: idleState,
    clock: c,
    context: { completedSteps: [] } as SagaContext,
    effects,
    transitions: {
      Any: {
        CANCEL: (_event, { context }) => {
          const ctx = context as SagaContext;
          if (ctx.completedSteps.includes("inventory")) {
            ctx.error = "Cancelled by user";
            return { state: compensatingReleaseState };
          }
          return { state: failedState };
        },
      },
      idle: {
        START: (event, { context }) => {
          const ctx = context as SagaContext;
          ctx.order = event.order;
          return { state: reservingInventoryState };
        },
      },
      reservingInventory: {
        INVENTORY_RESERVED: (event, { context }) => {
          const ctx = context as SagaContext;
          ctx.reservationId = event.result.reservationId;
          ctx.completedSteps.push("inventory");
          return { state: processingPaymentState };
        },
        INVENTORY_FAILED: (event, { context }) => {
          const ctx = context as SagaContext;
          ctx.error = event.error;
          return { state: failedState };
        },
      },
      processingPayment: {
        PAYMENT_PROCESSED: (event, { context }) => {
          const ctx = context as SagaContext;
          ctx.transactionId = event.result.transactionId;
          ctx.completedSteps.push("payment");
          return { state: creatingShipmentState };
        },
        PAYMENT_FAILED: (event, { context }) => {
          const ctx = context as SagaContext;
          ctx.error = event.error;
          ctx.completedSteps.push("payment_failed");
          return { state: compensatingRefundState };
        },
      },
      creatingShipment: {
        SHIPMENT_CREATED: (event, { context }) => {
          const ctx = context as SagaContext;
          ctx.trackingNumber = event.result.trackingNumber;
          ctx.completedSteps.push("shipment");
          return { state: notifyingState };
        },
        SHIPMENT_FAILED: (event, { context }) => {
          const ctx = context as SagaContext;
          ctx.error = event.error;
          return { state: compensatingRefundState };
        },
      },
      notifying: {
        NOTIFICATION_SENT: () => ({ state: completedState }),
        NOTIFICATION_FAILED: (_event, { context }) => {
          const ctx = context as SagaContext;
          ctx.error = "Notification failed";
          return { state: completedState };
        },
      },
      compensatingRefund: {
        REFUND_DONE: (_event, { context }) => {
          const ctx = context as SagaContext;
          ctx.completedSteps.push("refunded");
          if (ctx.completedSteps.includes("inventory")) {
            return { state: compensatingReleaseState };
          }
          return { state: failedState };
        },
        REFUND_FAILED: (event, { context }) => {
          const ctx = context as SagaContext;
          ctx.error = `Refund failed: ${event.error}`;
          return { state: failedState };
        },
      },
      compensatingRelease: {
        RELEASE_DONE: (_event, { context }) => {
          const ctx = context as SagaContext;
          ctx.completedSteps.push("released");
          return { state: failedState };
        },
        RELEASE_FAILED: (event, { context }) => {
          const ctx = context as SagaContext;
          ctx.error = `Release failed: ${event.error}`;
          return { state: failedState };
        },
      },
    },
  });

  return { actor, clock: c };
}

// ── Tests ────────────────────────────────────────────────────────────
describe("saga orchestrator actor", () => {
  it("starts in idle", () => {
    const { actor } = createSagaActor();
    expect(matches(actor, "idle")).toBe(true);
    expect(actor.snapshot().done).toBeFalsy();
  });

  it("happy path: idle → reserving → payment → shipment → notify → completed", () => {
    const { actor, clock } = createSagaActor();

    actor.send(
      startEvent.create({
        order: { orderId: "ORD-1", items: ["widget"], amount: 99.99 },
      }),
    );
    expect(matches(actor, "reservingInventory")).toBe(true);
    expect(actor.context.order?.orderId).toBe("ORD-1");

    clock.advance(100);
    expect(matches(actor, "processingPayment")).toBe(true);
    expect(actor.context.reservationId).toBe("RES-ORD-1");

    clock.advance(200);
    expect(matches(actor, "creatingShipment")).toBe(true);
    expect(actor.context.transactionId).toBe("TXN-ORD-1");

    clock.advance(150);
    expect(matches(actor, "notifying")).toBe(true);
    expect(actor.context.trackingNumber).toBe("TRK-ORD-1");

    clock.advance(50);
    expect(matches(actor, "completed")).toBe(true);
    expect(actor.snapshot().done).toBe(true);
    expect(actor.context.completedSteps).toEqual(["inventory", "payment", "shipment"]);
  });

  it("payment fails → compensate: refund → release inventory → failed", () => {
    const { actor, clock } = createSagaActor();

    actor.send(
      startEvent.create({
        order: { orderId: "ORD-2", items: ["gadget"], amount: 49.99 },
      }),
    );
    clock.advance(100);
    expect(matches(actor, "processingPayment")).toBe(true);

    actor.send(paymentFailedEvent.create({ error: "Card declined" }));
    expect(matches(actor, "compensatingRefund")).toBe(true);
    expect(actor.context.error).toBe("Card declined");

    clock.advance(100);
    expect(matches(actor, "compensatingRelease")).toBe(true);
    expect(actor.context.completedSteps).toContain("refunded");

    clock.advance(80);
    expect(matches(actor, "failed")).toBe(true);
    expect(actor.snapshot().done).toBe(true);
    expect(actor.context.completedSteps).toContain("released");
  });

  it("shipment fails → compensate: refund → release → failed", () => {
    const { actor, clock } = createSagaActor();

    actor.send(
      startEvent.create({
        order: { orderId: "ORD-3", items: ["thing"], amount: 29.99 },
      }),
    );
    clock.advance(100);
    clock.advance(200);
    expect(matches(actor, "creatingShipment")).toBe(true);

    actor.send(shipmentFailedEvent.create({ error: "Carrier unavailable" }));
    expect(matches(actor, "compensatingRefund")).toBe(true);

    clock.advance(100);
    expect(matches(actor, "compensatingRelease")).toBe(true);

    clock.advance(80);
    expect(matches(actor, "failed")).toBe(true);
  });

  it("inventory fails → no compensation needed → failed", () => {
    const { actor } = createSagaActor();

    actor.send(
      startEvent.create({
        order: { orderId: "ORD-4", items: ["part"], amount: 19.99 },
      }),
    );
    expect(matches(actor, "reservingInventory")).toBe(true);

    actor.send(inventoryFailedEvent.create({ error: "Out of stock" }));
    expect(matches(actor, "failed")).toBe(true);
    expect(actor.context.error).toBe("Out of stock");
    expect(actor.context.completedSteps).toEqual([]);
  });

  it("CANCEL from idle → failed (no compensation)", () => {
    const { actor } = createSagaActor();

    actor.send(cancelEvent);
    expect(matches(actor, "failed")).toBe(true);
  });

  it("CANCEL during processingPayment → compensate release", () => {
    const { actor, clock } = createSagaActor();

    actor.send(
      startEvent.create({
        order: { orderId: "ORD-5", items: ["doohickey"], amount: 59.99 },
      }),
    );
    clock.advance(100);
    expect(matches(actor, "processingPayment")).toBe(true);

    actor.send(cancelEvent);
    expect(matches(actor, "compensatingRelease")).toBe(true);
    expect(actor.context.error).toBe("Cancelled by user");

    clock.advance(80);
    expect(matches(actor, "failed")).toBe(true);
  });

  it("CANCEL after inventory reserved but before payment → compensate release", () => {
    const { actor, clock } = createSagaActor();

    actor.send(
      startEvent.create({
        order: { orderId: "ORD-6", items: ["gizmo"], amount: 39.99 },
      }),
    );
    clock.advance(100);
    expect(matches(actor, "processingPayment")).toBe(true);
    expect(actor.context.completedSteps).toContain("inventory");

    actor.send(cancelEvent);
    expect(matches(actor, "compensatingRelease")).toBe(true);

    clock.advance(80);
    expect(matches(actor, "failed")).toBe(true);
  });

  it("effect aborts on state change before timeout", () => {
    const { actor, clock } = createSagaActor();

    actor.send(
      startEvent.create({
        order: { orderId: "ORD-7", items: ["widget"], amount: 99.99 },
      }),
    );
    expect(matches(actor, "reservingInventory")).toBe(true);

    actor.send(inventoryFailedEvent.create({ error: "Forced" }));
    expect(matches(actor, "failed")).toBe(true);

    clock.advance(100);
    expect(matches(actor, "failed")).toBe(true);
  });

  it("completedSteps tracks saga progress correctly", () => {
    const { actor, clock } = createSagaActor();

    expect(actor.context.completedSteps).toEqual([]);

    actor.send(
      startEvent.create({
        order: { orderId: "ORD-8", items: ["a", "b"], amount: 10.0 },
      }),
    );
    expect(actor.context.completedSteps).toEqual([]);

    clock.advance(100);
    expect(actor.context.completedSteps).toEqual(["inventory"]);

    clock.advance(200);
    expect(actor.context.completedSteps).toEqual(["inventory", "payment"]);

    clock.advance(150);
    expect(actor.context.completedSteps).toEqual(["inventory", "payment", "shipment"]);
  });

  it("full flow: context accumulates all service results", () => {
    const { actor, clock } = createSagaActor();

    actor.send(
      startEvent.create({
        order: { orderId: "ORD-9", items: ["x"], amount: 100 },
      }),
    );

    clock.advance(100);
    expect(actor.context.reservationId).toBe("RES-ORD-9");
    expect(actor.context.transactionId).toBeUndefined();

    clock.advance(200);
    expect(actor.context.transactionId).toBe("TXN-ORD-9");
    expect(actor.context.trackingNumber).toBeUndefined();

    clock.advance(150);
    expect(actor.context.trackingNumber).toBe("TRK-ORD-9");

    clock.advance(50);
    expect(matches(actor, "completed")).toBe(true);
    expect(actor.context.order?.orderId).toBe("ORD-9");
    expect(actor.context.reservationId).toBe("RES-ORD-9");
    expect(actor.context.transactionId).toBe("TXN-ORD-9");
    expect(actor.context.trackingNumber).toBe("TRK-ORD-9");
  });

  it("notification failure does not trigger compensation (already committed)", () => {
    const { actor, clock } = createSagaActor();

    actor.send(
      startEvent.create({
        order: { orderId: "ORD-10", items: ["z"], amount: 5 },
      }),
    );
    clock.advance(100);
    clock.advance(200);
    clock.advance(150);
    expect(matches(actor, "notifying")).toBe(true);

    actor.send(notificationFailedEvent.create({ error: "Email bounce" }));
    expect(matches(actor, "completed")).toBe(true);
    expect(actor.context.error).toBe("Notification failed");
    expect(actor.snapshot().done).toBe(true);
  });
});
