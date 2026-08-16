/**
 * PINNED FIXTURE — saga.
 *
 * Source: packages/examples/sagaOrchestrator.actor.test.ts (`createSagaActor`)
 * FIXTURE_VERSION: 1
 *
 * Do not import from packages/examples: factories are module-private inside
 * .actor.test.ts with no exports map. This is a copy; the drift guard
 * (browser/fixtures/fingerprints.json + tests/fingerprints.test.ts) catches
 * upstream refactors that change the graph shape.
 *
 * Story: distributed transaction (saga pattern). Orchestrator coordinates
 * reserve-inventory → process-payment → create-shipment → notify, with
 * compensating states (refund/release) on failure and an Any-handler for
 * CANCEL. Deterministic: service calls are VirtualClock timeouts with static
 * ids (no Math.random / Date.now).
 *
 *   idle → reservingInventory → processingPayment → creatingShipment → notifying → completed (final)
 *                ↘ (CANCEL)          ↘ (fail)           ↘ (fail)
 *                            compensatingRefund → compensatingRelease → failed (final)
 */

import { Actor, VirtualClock, state, event } from "@mantaq/core";
import type { EffectInput, InternalEvent } from "@mantaq/core";

// Inlined copy of @mantaq/sugar withTimeout — pinned fixtures stay
// self-contained (no drift via sugar refactors).
function withTimeout<ActorContext>(
  ms: number,
  input: EffectInput<ActorContext>,
  event: () => InternalEvent,
): void {
  input.clock.setTimeout(
    ms,
    () => {
      if (input.signal.aborted) return;
      input.emit(event());
    },
    { signal: input.signal },
  );
}

interface OrderRequest {
  orderId: string;
  items: string[];
  amount: number;
}

const s = {
  idle: state("idle")(),
  reservingInventory: state("reservingInventory")(),
  processingPayment: state("processingPayment")(),
  creatingShipment: state("creatingShipment")(),
  notifying: state("notifying")(),
  compensatingRefund: state("compensatingRefund")(),
  compensatingRelease: state("compensatingRelease")(),
};
const completed = state("completed")().final();
const failed = state("failed")().final();

export const startOrder = event("START")<{ order: OrderRequest }>();
export const cancelOrder = event("CANCEL")();

const inventoryReserved = event("INVENTORY_RESERVED")<{ result: { reservationId: string } }>();
const inventoryFailed = event("INVENTORY_FAILED")<{ error: string }>();
const paymentProcessed = event("PAYMENT_PROCESSED")<{ result: { transactionId: string } }>();
const paymentFailed = event("PAYMENT_FAILED")<{ error: string }>();
const shipmentCreated = event("SHIPMENT_CREATED")<{ result: { trackingNumber: string } }>();
const shipmentFailed = event("SHIPMENT_FAILED")<{ error: string }>();
const notificationSent = event("NOTIFICATION_SENT")();
const notificationFailed = event("NOTIFICATION_FAILED")<{ error: string }>();
const refundDone = event("REFUND_DONE")();
const refundFailed = event("REFUND_FAILED")<{ error: string }>();
const releaseDone = event("RELEASE_DONE")();
const releaseFailed = event("RELEASE_FAILED")<{ error: string }>();

type SagaContext = {
  order?: OrderRequest;
  reservationId?: string;
  transactionId?: string;
  trackingNumber?: string;
  error?: string;
  completedSteps: string[];
};

export function createSagaActor(clock?: VirtualClock) {
  const c = clock ?? new VirtualClock();

  const actor = new Actor({
    inputs: [startOrder, cancelOrder],
    outputs: [],
    internal: [
      inventoryReserved,
      inventoryFailed,
      paymentProcessed,
      paymentFailed,
      shipmentCreated,
      shipmentFailed,
      notificationSent,
      notificationFailed,
      refundDone,
      refundFailed,
      releaseDone,
      releaseFailed,
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
      m.effect(s.reservingInventory, (input) => {
        withTimeout(100, input, () =>
          inventoryReserved.create({
            result: { reservationId: `RES-${input.context.get().order?.orderId ?? "unknown"}` },
          }),
        );
      });
      m.effect(s.processingPayment, (input) => {
        withTimeout(200, input, () =>
          paymentProcessed.create({
            result: { transactionId: `TXN-${input.context.get().order?.orderId ?? "unknown"}` },
          }),
        );
      });
      m.effect(s.creatingShipment, (input) => {
        withTimeout(150, input, () =>
          shipmentCreated.create({
            result: { trackingNumber: `TRK-${input.context.get().order?.orderId ?? "unknown"}` },
          }),
        );
      });
      m.effect(s.notifying, (input) => {
        withTimeout(50, input, () => notificationSent.create());
      });
      m.effect(s.compensatingRefund, (input) => {
        withTimeout(100, input, () => refundDone.create());
      });
      m.effect(s.compensatingRelease, (input) => {
        withTimeout(80, input, () => releaseDone.create());
      });
      m.onAny(cancelOrder, (_event, opts) => {
        const cur = opts!.context.get();
        if (cur.completedSteps.includes("inventory")) {
          cur.error = "Cancelled by user";
          opts!.context.set(cur);
          return { state: s.compensatingRelease };
        }
        return { state: failed };
      });
      m.on(s.idle, startOrder, (event, opts) => {
        const cur = opts!.context.get();
        cur.order = event.payload.order;
        opts!.context.set(cur);
        return { state: s.reservingInventory };
      });
      m.on(s.reservingInventory, inventoryReserved, (event, opts) => {
        const cur = opts!.context.get();
        cur.reservationId = event.payload.result.reservationId;
        cur.completedSteps = [...cur.completedSteps, "inventory"];
        opts!.context.set(cur);
        return { state: s.processingPayment };
      });
      m.on(s.reservingInventory, inventoryFailed, (event, opts) => {
        const cur = opts!.context.get();
        cur.error = event.payload.error;
        opts!.context.set(cur);
        return { state: failed };
      });
      m.on(s.processingPayment, paymentProcessed, (event, opts) => {
        const cur = opts!.context.get();
        cur.transactionId = event.payload.result.transactionId;
        cur.completedSteps = [...cur.completedSteps, "payment"];
        opts!.context.set(cur);
        return { state: s.creatingShipment };
      });
      m.on(s.processingPayment, paymentFailed, (event, opts) => {
        const cur = opts!.context.get();
        cur.error = event.payload.error;
        cur.completedSteps = [...cur.completedSteps, "payment_failed"];
        opts!.context.set(cur);
        return { state: s.compensatingRefund };
      });
      m.on(s.creatingShipment, shipmentCreated, (event, opts) => {
        const cur = opts!.context.get();
        cur.trackingNumber = event.payload.result.trackingNumber;
        cur.completedSteps = [...cur.completedSteps, "shipment"];
        opts!.context.set(cur);
        return { state: s.notifying };
      });
      m.on(s.creatingShipment, shipmentFailed, (event, opts) => {
        const cur = opts!.context.get();
        cur.error = event.payload.error;
        opts!.context.set(cur);
        return { state: s.compensatingRefund };
      });
      m.on(s.notifying, notificationSent, () => ({ state: completed }));
      m.on(s.notifying, notificationFailed, (_event, opts) => {
        const cur = opts!.context.get();
        cur.error = "Notification failed";
        opts!.context.set(cur);
        return { state: completed };
      });
      m.on(s.compensatingRefund, refundDone, (_event, opts) => {
        const cur = opts!.context.get();
        cur.completedSteps = [...cur.completedSteps, "refunded"];
        opts!.context.set(cur);
        if (cur.completedSteps.includes("inventory")) {
          return { state: s.compensatingRelease };
        }
        return { state: failed };
      });
      m.on(s.compensatingRefund, refundFailed, (event, opts) => {
        const cur = opts!.context.get();
        cur.error = `Refund failed: ${event.payload.error}`;
        opts!.context.set(cur);
        return { state: failed };
      });
      m.on(s.compensatingRelease, releaseDone, (_event, opts) => {
        const cur = opts!.context.get();
        cur.completedSteps = [...cur.completedSteps, "released"];
        opts!.context.set(cur);
        return { state: failed };
      });
      m.on(s.compensatingRelease, releaseFailed, (event, opts) => {
        const cur = opts!.context.get();
        cur.error = `Release failed: ${event.payload.error}`;
        opts!.context.set(cur);
        return { state: failed };
      });
    },
  });

  return { actor, clock: c };
}
