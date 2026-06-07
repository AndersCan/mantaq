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
import { Actor, VirtualClock, state, event } from "@mantaq/core";
import { matches, states, events, withTimeout } from "@mantaq/sugar";

// ── Types ────────────────────────────────────────────────────────────
interface OrderRequest {
  orderId: string;
  items: string[];
  amount: number;
}

// ── States ───────────────────────────────────────────────────────────
const s = states(
  "idle",
  "reservingInventory",
  "processingPayment",
  "creatingShipment",
  "notifying",
  "compensatingRefund",
  "compensatingRelease",
);
const completed = state("completed")().final();
const failed = state("failed")().final();

// ── External events ──────────────────────────────────────────────────
const START = event("START")<{ order: OrderRequest }>();
const { CANCEL } = events("CANCEL");

// ── Internal events (service responses) ──────────────────────────────
const INVENTORY_RESERVED = event("INVENTORY_RESERVED")<{ result: { reservationId: string } }>();
const INVENTORY_FAILED = event("INVENTORY_FAILED")<{ error: string }>();
const PAYMENT_PROCESSED = event("PAYMENT_PROCESSED")<{ result: { transactionId: string } }>();
const PAYMENT_FAILED = event("PAYMENT_FAILED")<{ error: string }>();
const SHIPMENT_CREATED = event("SHIPMENT_CREATED")<{ result: { trackingNumber: string } }>();
const SHIPMENT_FAILED = event("SHIPMENT_FAILED")<{ error: string }>();
const { NOTIFICATION_SENT, REFUND_DONE, RELEASE_DONE } = events(
  "NOTIFICATION_SENT",
  "REFUND_DONE",
  "RELEASE_DONE",
);
const NOTIFICATION_FAILED = event("NOTIFICATION_FAILED")<{ error: string }>();
const REFUND_FAILED = event("REFUND_FAILED")<{ error: string }>();
const RELEASE_FAILED = event("RELEASE_FAILED")<{ error: string }>();

// ── Context ──────────────────────────────────────────────────────────
type SagaContext = {
  order?: OrderRequest;
  reservationId?: string;
  transactionId?: string;
  trackingNumber?: string;
  error?: string;
  completedSteps: string[];
};

// ── Actor factory ────────────────────────────────────────────────────
function createSagaActor(clock?: VirtualClock) {
  const c = clock ?? new VirtualClock();

  const actor = new Actor({
    inputs: [START, CANCEL],
    outputs: [],
    internal: [
      INVENTORY_RESERVED,
      INVENTORY_FAILED,
      PAYMENT_PROCESSED,
      PAYMENT_FAILED,
      SHIPMENT_CREATED,
      SHIPMENT_FAILED,
      NOTIFICATION_SENT,
      NOTIFICATION_FAILED,
      REFUND_DONE,
      REFUND_FAILED,
      RELEASE_DONE,
      RELEASE_FAILED,
    ],
    states: [
      s.idle,
      s.reservingInventory,
      s.processingPayment,
      s.creatingShipment,
      s.notifying,
      completed,
      failed,
      s.compensatingRefund,
      s.compensatingRelease,
    ],
    initial: s.idle,
    clock: c,
    context: { completedSteps: [] } as SagaContext,
    effects: {
      reservingInventory: [
        (input) => {
          withTimeout(100, input, () =>
            INVENTORY_RESERVED.create({
              result: { reservationId: `RES-${input.context.order?.orderId ?? "unknown"}` },
            }),
          );
        },
      ],
      processingPayment: [
        (input) => {
          withTimeout(200, input, () =>
            PAYMENT_PROCESSED.create({
              result: { transactionId: `TXN-${input.context.order?.orderId ?? "unknown"}` },
            }),
          );
        },
      ],
      creatingShipment: [
        (input) => {
          withTimeout(150, input, () =>
            SHIPMENT_CREATED.create({
              result: { trackingNumber: `TRK-${input.context.order?.orderId ?? "unknown"}` },
            }),
          );
        },
      ],
      notifying: [
        (input) => {
          withTimeout(50, input, () => NOTIFICATION_SENT.create(undefined));
        },
      ],
      compensatingRefund: [
        (input) => {
          withTimeout(100, input, () => REFUND_DONE.create(undefined));
        },
      ],
      compensatingRelease: [
        (input) => {
          withTimeout(80, input, () => RELEASE_DONE.create(undefined));
        },
      ],
    },
    transitions: {
      Any: {
        CANCEL: (_event, { context }) => {
          if (context.completedSteps.includes("inventory")) {
            context.error = "Cancelled by user";
            return { state: s.compensatingRelease };
          }
          return { state: failed };
        },
      },
      idle: {
        START: (event, { context }) => {
          context.order = event.order;
          return { state: s.reservingInventory };
        },
      },
      reservingInventory: {
        INVENTORY_RESERVED: (event, { context }) => {
          context.reservationId = event.result.reservationId;
          context.completedSteps.push("inventory");
          return { state: s.processingPayment };
        },
        INVENTORY_FAILED: (event, { context }) => {
          context.error = event.error;
          return { state: failed };
        },
      },
      processingPayment: {
        PAYMENT_PROCESSED: (event, { context }) => {
          context.transactionId = event.result.transactionId;
          context.completedSteps.push("payment");
          return { state: s.creatingShipment };
        },
        PAYMENT_FAILED: (event, { context }) => {
          context.error = event.error;
          context.completedSteps.push("payment_failed");
          return { state: s.compensatingRefund };
        },
      },
      creatingShipment: {
        SHIPMENT_CREATED: (event, { context }) => {
          context.trackingNumber = event.result.trackingNumber;
          context.completedSteps.push("shipment");
          return { state: s.notifying };
        },
        SHIPMENT_FAILED: (event, { context }) => {
          context.error = event.error;
          return { state: s.compensatingRefund };
        },
      },
      notifying: {
        NOTIFICATION_SENT: () => ({ state: completed }),
        NOTIFICATION_FAILED: (_event, { context }) => {
          context.error = "Notification failed";
          return { state: completed };
        },
      },
      compensatingRefund: {
        REFUND_DONE: (_event, { context }) => {
          context.completedSteps.push("refunded");
          if (context.completedSteps.includes("inventory")) {
            return { state: s.compensatingRelease };
          }
          return { state: failed };
        },
        REFUND_FAILED: (event, { context }) => {
          context.error = `Refund failed: ${event.error}`;
          return { state: failed };
        },
      },
      compensatingRelease: {
        RELEASE_DONE: (_event, { context }) => {
          context.completedSteps.push("released");
          return { state: failed };
        },
        RELEASE_FAILED: (event, { context }) => {
          context.error = `Release failed: ${event.error}`;
          return { state: failed };
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
      START.create({
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
      START.create({
        order: { orderId: "ORD-2", items: ["gadget"], amount: 49.99 },
      }),
    );
    clock.advance(100);
    expect(matches(actor, "processingPayment")).toBe(true);

    actor.send(PAYMENT_FAILED.create({ error: "Card declined" }));
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
      START.create({
        order: { orderId: "ORD-3", items: ["thing"], amount: 29.99 },
      }),
    );
    clock.advance(100);
    clock.advance(200);
    expect(matches(actor, "creatingShipment")).toBe(true);

    actor.send(SHIPMENT_FAILED.create({ error: "Carrier unavailable" }));
    expect(matches(actor, "compensatingRefund")).toBe(true);

    clock.advance(100);
    expect(matches(actor, "compensatingRelease")).toBe(true);

    clock.advance(80);
    expect(matches(actor, "failed")).toBe(true);
  });

  it("inventory fails → no compensation needed → failed", () => {
    const { actor } = createSagaActor();

    actor.send(
      START.create({
        order: { orderId: "ORD-4", items: ["part"], amount: 19.99 },
      }),
    );
    expect(matches(actor, "reservingInventory")).toBe(true);

    actor.send(INVENTORY_FAILED.create({ error: "Out of stock" }));
    expect(matches(actor, "failed")).toBe(true);
    expect(actor.context.error).toBe("Out of stock");
    expect(actor.context.completedSteps).toEqual([]);
  });

  it("CANCEL from idle → failed (no compensation)", () => {
    const { actor } = createSagaActor();

    actor.send(CANCEL);
    expect(matches(actor, "failed")).toBe(true);
  });

  it("CANCEL during processingPayment → compensate release", () => {
    const { actor, clock } = createSagaActor();

    actor.send(
      START.create({
        order: { orderId: "ORD-5", items: ["doohickey"], amount: 59.99 },
      }),
    );
    clock.advance(100);
    expect(matches(actor, "processingPayment")).toBe(true);

    actor.send(CANCEL);
    expect(matches(actor, "compensatingRelease")).toBe(true);
    expect(actor.context.error).toBe("Cancelled by user");

    clock.advance(80);
    expect(matches(actor, "failed")).toBe(true);
  });

  it("CANCEL after inventory reserved but before payment → compensate release", () => {
    const { actor, clock } = createSagaActor();

    actor.send(
      START.create({
        order: { orderId: "ORD-6", items: ["gizmo"], amount: 39.99 },
      }),
    );
    clock.advance(100);
    expect(matches(actor, "processingPayment")).toBe(true);
    expect(actor.context.completedSteps).toContain("inventory");

    actor.send(CANCEL);
    expect(matches(actor, "compensatingRelease")).toBe(true);

    clock.advance(80);
    expect(matches(actor, "failed")).toBe(true);
  });

  it("effect aborts on state change before timeout", () => {
    const { actor, clock } = createSagaActor();

    actor.send(
      START.create({
        order: { orderId: "ORD-7", items: ["widget"], amount: 99.99 },
      }),
    );
    expect(matches(actor, "reservingInventory")).toBe(true);

    actor.send(INVENTORY_FAILED.create({ error: "Forced" }));
    expect(matches(actor, "failed")).toBe(true);

    clock.advance(100);
    expect(matches(actor, "failed")).toBe(true);
  });

  it("completedSteps tracks saga progress correctly", () => {
    const { actor, clock } = createSagaActor();

    expect(actor.context.completedSteps).toEqual([]);

    actor.send(
      START.create({
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
      START.create({
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
      START.create({
        order: { orderId: "ORD-10", items: ["z"], amount: 5 },
      }),
    );
    clock.advance(100);
    clock.advance(200);
    clock.advance(150);
    expect(matches(actor, "notifying")).toBe(true);

    actor.send(NOTIFICATION_FAILED.create({ error: "Email bounce" }));
    expect(matches(actor, "completed")).toBe(true);
    expect(actor.context.error).toBe("Notification failed");
    expect(actor.snapshot().done).toBe(true);
  });
});
