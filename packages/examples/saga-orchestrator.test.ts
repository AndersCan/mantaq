/**
 * Problem: Distributed transactions (saga pattern).
 *   Order → Reserve Inventory → Process Payment → Create Shipment → Notify.
 *   Each step may fail, and on failure compensating actions run in reverse order.
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

import { Actor, VirtualClock, state, event } from "@mantaq/core";
import type { AnyActor } from "@mantaq/core";
import { matches, states, events, withTimeout } from "@mantaq/sugar";
import { describe, it, expect } from "vite-plus/test";

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
const sagaStates = states(
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
  const c = clock ?? VirtualClock();

  const initialContext: SagaContext = { completedSteps: [] };

  const actor = Actor({
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
      sagaStates.idle,
      sagaStates.reservingInventory,
      sagaStates.processingPayment,
      sagaStates.creatingShipment,
      sagaStates.notifying,
      completed,
      failed,
      sagaStates.compensatingRefund,
      sagaStates.compensatingRelease,
    ],
    initial: sagaStates.idle,
    clock: c,
    context: initialContext,
    setup: (m) => {
      m.effect(sagaStates.reservingInventory, {
        name: "reserveInventory",
        fn: (input) => {
          withTimeout(100, {
            input: input,
            event: () =>
              INVENTORY_RESERVED.create({
                result: { reservationId: `RES-${input.context.get().order?.orderId ?? "unknown"}` },
              }),
          });
        },
      });
      m.effect(sagaStates.processingPayment, {
        name: "processPayment",
        fn: (input) => {
          withTimeout(200, {
            input: input,
            event: () =>
              PAYMENT_PROCESSED.create({
                result: { transactionId: `TXN-${input.context.get().order?.orderId ?? "unknown"}` },
              }),
          });
        },
      });
      m.effect(sagaStates.creatingShipment, {
        name: "createShipment",
        fn: (input) => {
          withTimeout(150, {
            input: input,
            event: () =>
              SHIPMENT_CREATED.create({
                result: {
                  trackingNumber: `TRK-${input.context.get().order?.orderId ?? "unknown"}`,
                },
              }),
          });
        },
      });
      m.effect(sagaStates.notifying, {
        name: "sendNotification",
        fn: (input) => {
          withTimeout(50, { input: input, event: () => NOTIFICATION_SENT.create(undefined) });
        },
      });
      m.effect(sagaStates.compensatingRefund, {
        name: "runRefund",
        fn: (input) => {
          withTimeout(100, { input: input, event: () => REFUND_DONE.create(undefined) });
        },
      });
      m.effect(sagaStates.compensatingRelease, {
        name: "releaseInventory",
        fn: (input) => {
          withTimeout(80, { input: input, event: () => RELEASE_DONE.create(undefined) });
        },
      });
      m.onAny({
        eventRef: CANCEL,
        handler: (_event, { context }) => {
          const current = context.get();
          if (current.completedSteps.includes("inventory")) {
            current.error = "Cancelled by user";
            context.set(current);
            return { state: sagaStates.compensatingRelease };
          }
          return { state: failed };
        },
      });
      m.on(sagaStates.idle, {
        eventRef: START,
        handler: (event, { context }) => {
          const current = context.get();
          current.order = event.payload.order;
          context.set(current);
          return { state: sagaStates.reservingInventory };
        },
      });
      m.on(sagaStates.reservingInventory, {
        eventRef: INVENTORY_RESERVED,
        handler: (event, { context }) => {
          const current = context.get();
          current.reservationId = event.payload.result.reservationId;
          current.completedSteps = [...current.completedSteps, "inventory"];
          context.set(current);
          return { state: sagaStates.processingPayment };
        },
      });
      m.on(sagaStates.reservingInventory, {
        eventRef: INVENTORY_FAILED,
        handler: (event, { context }) => {
          const current = context.get();
          current.error = event.payload.error;
          context.set(current);
          return { state: failed };
        },
      });
      m.on(sagaStates.processingPayment, {
        eventRef: PAYMENT_PROCESSED,
        handler: (event, { context }) => {
          const current = context.get();
          current.transactionId = event.payload.result.transactionId;
          current.completedSteps = [...current.completedSteps, "payment"];
          context.set(current);
          return { state: sagaStates.creatingShipment };
        },
      });
      m.on(sagaStates.processingPayment, {
        eventRef: PAYMENT_FAILED,
        handler: (event, { context }) => {
          const current = context.get();
          current.error = event.payload.error;
          current.completedSteps = [...current.completedSteps, "payment_failed"];
          context.set(current);
          return { state: sagaStates.compensatingRefund };
        },
      });
      m.on(sagaStates.creatingShipment, {
        eventRef: SHIPMENT_CREATED,
        handler: (event, { context }) => {
          const current = context.get();
          current.trackingNumber = event.payload.result.trackingNumber;
          current.completedSteps = [...current.completedSteps, "shipment"];
          context.set(current);
          return { state: sagaStates.notifying };
        },
      });
      m.on(sagaStates.creatingShipment, {
        eventRef: SHIPMENT_FAILED,
        handler: (event, { context }) => {
          const current = context.get();
          current.error = event.payload.error;
          context.set(current);
          return { state: sagaStates.compensatingRefund };
        },
      });
      m.on(sagaStates.notifying, {
        eventRef: NOTIFICATION_SENT,
        handler: () => ({ state: completed }),
      });
      m.on(sagaStates.notifying, {
        eventRef: NOTIFICATION_FAILED,
        handler: (_event, { context }) => {
          const current = context.get();
          current.error = "Notification failed";
          context.set(current);
          return { state: completed };
        },
      });
      m.on(sagaStates.compensatingRefund, {
        eventRef: REFUND_DONE,
        handler: (_event, { context }) => {
          const current = context.get();
          current.completedSteps = [...current.completedSteps, "refunded"];
          context.set(current);
          if (current.completedSteps.includes("inventory")) {
            return { state: sagaStates.compensatingRelease };
          }
          return { state: failed };
        },
      });
      m.on(sagaStates.compensatingRefund, {
        eventRef: REFUND_FAILED,
        handler: (event, { context }) => {
          const current = context.get();
          current.error = `Refund failed: ${event.payload.error}`;
          context.set(current);
          return { state: failed };
        },
      });
      m.on(sagaStates.compensatingRelease, {
        eventRef: RELEASE_DONE,
        handler: (_event, { context }) => {
          const current = context.get();
          current.completedSteps = [...current.completedSteps, "released"];
          context.set(current);
          return { state: failed };
        },
      });
      m.on(sagaStates.compensatingRelease, {
        eventRef: RELEASE_FAILED,
        handler: (event, { context }) => {
          const current = context.get();
          current.error = `Release failed: ${event.payload.error}`;
          context.set(current);
          return { state: failed };
        },
      });
    },
  });

  return { actor, clock: c };
}

// ── Tests ────────────────────────────────────────────────────────────
describe("saga orchestrator actor", () => {
  it("sets idle as the initial state", () => {
    const { actor } = createSagaActor();
    expect({
      matches: matches(actor, "idle"),
      done: actor.snapshot().done,
    }).toEqual({ matches: true, done: undefined });
  });

  it("handles the happy path from idle through every step to completed", () => {
    const { actor, clock } = createSagaActor();

    actor.send(
      START.create({
        order: { orderId: "ORD-1", items: ["widget"], amount: 99.99 },
      }),
    );
    expect({
      matches: matches(actor, "reservingInventory"),
      orderId: actor.context.order?.orderId,
    }).toEqual({ matches: true, orderId: "ORD-1" });

    clock.advance(100);
    expect({
      matches: matches(actor, "processingPayment"),
      reservationId: actor.context.reservationId,
    }).toEqual({ matches: true, reservationId: "RES-ORD-1" });

    clock.advance(200);
    expect({
      matches: matches(actor, "creatingShipment"),
      transactionId: actor.context.transactionId,
    }).toEqual({ matches: true, transactionId: "TXN-ORD-1" });

    clock.advance(150);
    expect({
      matches: matches(actor, "notifying"),
      trackingNumber: actor.context.trackingNumber,
    }).toEqual({ matches: true, trackingNumber: "TRK-ORD-1" });

    clock.advance(50);
    expect({
      matches: matches(actor, "completed"),
      done: actor.snapshot().done,
      completedSteps: actor.context.completedSteps,
    }).toEqual({ matches: true, done: true, completedSteps: ["inventory", "payment", "shipment"] });
  });

  it("compensates with refund then release when payment fails", () => {
    const { actor, clock } = createSagaActor();

    actor.send(
      START.create({
        order: { orderId: "ORD-2", items: ["gadget"], amount: 49.99 },
      }),
    );
    clock.advance(100);
    expect(matches(actor, "processingPayment")).toBe(true);
    inject(actor, PAYMENT_FAILED.create({ error: "Card declined" }));
    expect({
      matches: matches(actor, "compensatingRefund"),
      error: actor.context.error,
    }).toEqual({ matches: true, error: "Card declined" });

    clock.advance(100);
    expect({
      matches: matches(actor, "compensatingRelease"),
      refundedStep: actor.context.completedSteps.includes("refunded"),
    }).toEqual({ matches: true, refundedStep: true });

    clock.advance(80);
    expect({
      matches: matches(actor, "failed"),
      done: actor.snapshot().done,
      releasedStep: actor.context.completedSteps.includes("released"),
    }).toEqual({ matches: true, done: true, releasedStep: true });
  });

  it("compensates with refund then release when shipment fails", () => {
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

  it("fails without compensation when inventory fails", () => {
    const { actor } = createSagaActor();

    actor.send(
      START.create({
        order: { orderId: "ORD-4", items: ["part"], amount: 19.99 },
      }),
    );
    expect(matches(actor, "reservingInventory")).toBe(true);
    inject(actor, INVENTORY_FAILED.create({ error: "Out of stock" }));
    expect({
      matches: matches(actor, "failed"),
      error: actor.context.error,
      completedSteps: actor.context.completedSteps,
    }).toEqual({ matches: true, error: "Out of stock", completedSteps: [] });
  });

  it("returns failed without compensation when CANCEL fires from idle", () => {
    const { actor } = createSagaActor();

    actor.send(CANCEL.create());
    expect(matches(actor, "failed")).toBe(true);
  });

  it("sets compensatingRelease when CANCEL fires during processingPayment", () => {
    const { actor, clock } = createSagaActor();

    actor.send(
      START.create({
        order: { orderId: "ORD-5", items: ["doohickey"], amount: 59.99 },
      }),
    );
    clock.advance(100);
    expect(matches(actor, "processingPayment")).toBe(true);

    actor.send(CANCEL.create());
    expect({
      matches: matches(actor, "compensatingRelease"),
      error: actor.context.error,
    }).toEqual({ matches: true, error: "Cancelled by user" });

    clock.advance(80);
    expect(matches(actor, "failed")).toBe(true);
  });

  it("sets compensatingRelease when CANCEL fires after reservation but before payment", () => {
    const { actor, clock } = createSagaActor();

    actor.send(
      START.create({
        order: { orderId: "ORD-6", items: ["gizmo"], amount: 39.99 },
      }),
    );
    clock.advance(100);
    expect({
      matches: matches(actor, "processingPayment"),
      reservedStep: actor.context.completedSteps.includes("inventory"),
    }).toEqual({ matches: true, reservedStep: true });

    actor.send(CANCEL.create());
    expect(matches(actor, "compensatingRelease")).toBe(true);

    clock.advance(80);
    expect(matches(actor, "failed")).toBe(true);
  });

  it("keeps an aborted effect from firing after the state changes", () => {
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

  it("keeps completedSteps in sync with saga progress", () => {
    const { actor, clock } = createSagaActor();

    expect(actor.context.completedSteps).toEqual([]);

    actor.send(
      START.create({
        order: { orderId: "ORD-8", items: ["a", "b"], amount: 10.0 },
      }),
    );

    clock.advance(100);

    clock.advance(200);

    clock.advance(150);
    expect({ completedSteps: actor.context.completedSteps }).toEqual({
      completedSteps: ["inventory", "payment", "shipment"],
    });
  });

  it("keeps every service result in context across the full flow", () => {
    const { actor, clock } = createSagaActor();

    actor.send(
      START.create({
        order: { orderId: "ORD-9", items: ["x"], amount: 100 },
      }),
    );

    clock.advance(100);
    expect({
      reservationId: actor.context.reservationId,
      transactionId: actor.context.transactionId,
    }).toEqual({ reservationId: "RES-ORD-9", transactionId: undefined });

    clock.advance(200);
    expect({
      transactionId: actor.context.transactionId,
      trackingNumber: actor.context.trackingNumber,
    }).toEqual({ transactionId: "TXN-ORD-9", trackingNumber: undefined });

    clock.advance(150);
    expect({ trackingNumber: actor.context.trackingNumber }).toEqual({
      trackingNumber: "TRK-ORD-9",
    });

    clock.advance(50);
    expect({
      matches: matches(actor, "completed"),
      orderId: actor.context.order?.orderId,
      reservationId: actor.context.reservationId,
      transactionId: actor.context.transactionId,
      trackingNumber: actor.context.trackingNumber,
    }).toEqual({
      matches: true,
      orderId: "ORD-9",
      reservationId: "RES-ORD-9",
      transactionId: "TXN-ORD-9",
      trackingNumber: "TRK-ORD-9",
    });
  });

  it("treats notification failure as committed without compensation", () => {
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
    expect({
      matches: matches(actor, "completed"),
      error: actor.context.error,
      done: actor.snapshot().done,
    }).toEqual({ matches: true, error: "Notification failed", done: true });
  });
});
