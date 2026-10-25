/**
 * Structural mirror of `packages/examples/saga-orchestrator.test.ts`.
 * Effects are stubbed; handler control flow that matters to the graph
 * (payload reads, context-dependent routing) is kept.
 */
import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { events, states } from "@mantaq/sugar";

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

const START = event("START")<{ order: { orderId: string } }>();
const { CANCEL } = events("CANCEL");
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

type SagaContext = { reservationId?: string; error?: string; completedSteps: string[] };

export function createSagaActor() {
  const initialContext: SagaContext = { completedSteps: [] };
  return Actor({
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
    clock: VirtualClock(),
    context: initialContext,
    setup: (m) => {
      m.effect(s.reservingInventory, { name: "reserveInventory", fn: () => undefined });
      m.effect(s.processingPayment, { name: "processPayment", fn: () => undefined });
      m.effect(s.creatingShipment, { name: "createShipment", fn: () => undefined });
      m.effect(s.notifying, { name: "sendNotification", fn: () => undefined });
      m.effect(s.compensatingRefund, { name: "runRefund", fn: () => undefined });
      m.effect(s.compensatingRelease, { name: "releaseInventory", fn: () => undefined });
      m.onAny({
        eventRef: CANCEL,
        handler: (_event, { context }) =>
          context.get().completedSteps.includes("inventory")
            ? { state: s.compensatingRelease }
            : { state: failed },
      });
      m.on(s.idle, { eventRef: START, handler: () => ({ state: s.reservingInventory }) });
      m.on(s.reservingInventory, {
        eventRef: INVENTORY_RESERVED,
        handler: (event) => {
          const reservationId = event.payload.result.reservationId;
          return reservationId ? { state: s.processingPayment } : {};
        },
      });
      m.on(s.reservingInventory, {
        eventRef: INVENTORY_FAILED,
        handler: () => ({ state: failed }),
      });
      m.on(s.processingPayment, {
        eventRef: PAYMENT_PROCESSED,
        handler: (event) => {
          const transactionId = event.payload.result.transactionId;
          return transactionId ? { state: s.creatingShipment } : {};
        },
      });
      m.on(s.processingPayment, {
        eventRef: PAYMENT_FAILED,
        handler: () => ({ state: s.compensatingRefund }),
      });
      m.on(s.creatingShipment, {
        eventRef: SHIPMENT_CREATED,
        handler: (event) => {
          const trackingNumber = event.payload.result.trackingNumber;
          return trackingNumber ? { state: s.notifying } : {};
        },
      });
      m.on(s.creatingShipment, {
        eventRef: SHIPMENT_FAILED,
        handler: () => ({ state: s.compensatingRefund }),
      });
      m.on(s.notifying, { eventRef: NOTIFICATION_SENT, handler: () => ({ state: completed }) });
      m.on(s.notifying, { eventRef: NOTIFICATION_FAILED, handler: () => ({ state: completed }) });
      m.on(s.compensatingRefund, {
        eventRef: REFUND_DONE,
        handler: (_event, { context }) =>
          context.get().completedSteps.includes("inventory")
            ? { state: s.compensatingRelease }
            : { state: failed },
      });
      m.on(s.compensatingRefund, { eventRef: REFUND_FAILED, handler: () => ({ state: failed }) });
      m.on(s.compensatingRelease, { eventRef: RELEASE_DONE, handler: () => ({ state: failed }) });
      m.on(s.compensatingRelease, { eventRef: RELEASE_FAILED, handler: () => ({ state: failed }) });
    },
  });
}
