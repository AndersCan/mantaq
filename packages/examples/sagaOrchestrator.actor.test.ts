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
import type { AnyActor } from "@mantaq/core";
import { matches, states, events, withTimeout } from "@mantaq/sugar";

function inject(actor: AnyActor, event: { type: string }): void {
  actor.inject(event);
}

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
    setup: (m) => {
      m.effect(s.reservingInventory, {
        name: "reserveInventory",
        fn: (input) => {
          withTimeout(100, input, () =>
            INVENTORY_RESERVED.create({
              result: { reservationId: `RES-${input.context.get().order?.orderId ?? "unknown"}` },
            }),
          );
        },
      });
      m.effect(s.processingPayment, {
        name: "processPayment",
        fn: (input) => {
          withTimeout(200, input, () =>
            PAYMENT_PROCESSED.create({
              result: { transactionId: `TXN-${input.context.get().order?.orderId ?? "unknown"}` },
            }),
          );
        },
      });
      m.effect(s.creatingShipment, {
        name: "createShipment",
        fn: (input) => {
          withTimeout(150, input, () =>
            SHIPMENT_CREATED.create({
              result: { trackingNumber: `TRK-${input.context.get().order?.orderId ?? "unknown"}` },
            }),
          );
        },
      });
      m.effect(s.notifying, {
        name: "sendNotification",
        fn: (input) => {
          withTimeout(50, input, () => NOTIFICATION_SENT.create(undefined));
        },
      });
      m.effect(s.compensatingRefund, {
        name: "runRefund",
        fn: (input) => {
          withTimeout(100, input, () => REFUND_DONE.create(undefined));
        },
      });
      m.effect(s.compensatingRelease, {
        name: "releaseInventory",
        fn: (input) => {
          withTimeout(80, input, () => RELEASE_DONE.create(undefined));
        },
      });
      m.onAny(CANCEL, (_event, opts) => {
        const cur = opts!.context.get();
        if (cur.completedSteps.includes("inventory")) {
          cur.error = "Cancelled by user";
          opts!.context.set(cur);
          return { state: s.compensatingRelease };
        }
        return { state: failed };
      });
      m.on(s.idle, START, (event, opts) => {
        const cur = opts!.context.get();
        cur.order = event.payload.order;
        opts!.context.set(cur);
        return { state: s.reservingInventory };
      });
      m.on(s.reservingInventory, INVENTORY_RESERVED, (event, opts) => {
        const cur = opts!.context.get();
        cur.reservationId = event.payload.result.reservationId;
        cur.completedSteps = [...cur.completedSteps, "inventory"];
        opts!.context.set(cur);
        return { state: s.processingPayment };
      });
      m.on(s.reservingInventory, INVENTORY_FAILED, (event, opts) => {
        const cur = opts!.context.get();
        cur.error = event.payload.error;
        opts!.context.set(cur);
        return { state: failed };
      });
      m.on(s.processingPayment, PAYMENT_PROCESSED, (event, opts) => {
        const cur = opts!.context.get();
        cur.transactionId = event.payload.result.transactionId;
        cur.completedSteps = [...cur.completedSteps, "payment"];
        opts!.context.set(cur);
        return { state: s.creatingShipment };
      });
      m.on(s.processingPayment, PAYMENT_FAILED, (event, opts) => {
        const cur = opts!.context.get();
        cur.error = event.payload.error;
        cur.completedSteps = [...cur.completedSteps, "payment_failed"];
        opts!.context.set(cur);
        return { state: s.compensatingRefund };
      });
      m.on(s.creatingShipment, SHIPMENT_CREATED, (event, opts) => {
        const cur = opts!.context.get();
        cur.trackingNumber = event.payload.result.trackingNumber;
        cur.completedSteps = [...cur.completedSteps, "shipment"];
        opts!.context.set(cur);
        return { state: s.notifying };
      });
      m.on(s.creatingShipment, SHIPMENT_FAILED, (event, opts) => {
        const cur = opts!.context.get();
        cur.error = event.payload.error;
        opts!.context.set(cur);
        return { state: s.compensatingRefund };
      });
      m.on(s.notifying, NOTIFICATION_SENT, () => ({ state: completed }));
      m.on(s.notifying, NOTIFICATION_FAILED, (_event, opts) => {
        const cur = opts!.context.get();
        cur.error = "Notification failed";
        opts!.context.set(cur);
        return { state: completed };
      });
      m.on(s.compensatingRefund, REFUND_DONE, (_event, opts) => {
        const cur = opts!.context.get();
        cur.completedSteps = [...cur.completedSteps, "refunded"];
        opts!.context.set(cur);
        if (cur.completedSteps.includes("inventory")) {
          return { state: s.compensatingRelease };
        }
        return { state: failed };
      });
      m.on(s.compensatingRefund, REFUND_FAILED, (event, opts) => {
        const cur = opts!.context.get();
        cur.error = `Refund failed: ${event.payload.error}`;
        opts!.context.set(cur);
        return { state: failed };
      });
      m.on(s.compensatingRelease, RELEASE_DONE, (_event, opts) => {
        const cur = opts!.context.get();
        cur.completedSteps = [...cur.completedSteps, "released"];
        opts!.context.set(cur);
        return { state: failed };
      });
      m.on(s.compensatingRelease, RELEASE_FAILED, (event, opts) => {
        const cur = opts!.context.get();
        cur.error = `Release failed: ${event.payload.error}`;
        opts!.context.set(cur);
        return { state: failed };
      });
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
    inject(actor, PAYMENT_FAILED.create({ error: "Card declined" }));
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
    inject(actor, SHIPMENT_FAILED.create({ error: "Carrier unavailable" }));
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
    inject(actor, INVENTORY_FAILED.create({ error: "Out of stock" }));
    expect(matches(actor, "failed")).toBe(true);
    expect(actor.context.error).toBe("Out of stock");
    expect(actor.context.completedSteps).toEqual([]);
  });

  it("CANCEL from idle → failed (no compensation)", () => {
    const { actor } = createSagaActor();

    actor.send(CANCEL.create());
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

    actor.send(CANCEL.create());
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

    actor.send(CANCEL.create());
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
    inject(actor, INVENTORY_FAILED.create({ error: "Forced" }));
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
    inject(actor, NOTIFICATION_FAILED.create({ error: "Email bounce" }));
    expect(matches(actor, "completed")).toBe(true);
    expect(actor.context.error).toBe("Notification failed");
    expect(actor.snapshot().done).toBe(true);
  });
});
