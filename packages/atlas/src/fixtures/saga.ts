/**
 * Mirror of `packages/examples/saga-orchestrator.test.ts`. Handlers are copied
 * verbatim (payload reads, context writes, context-dependent routing); effects
 * are stubbed, so service responses arrive as injected internal events.
 */
import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { events, states } from "@mantaq/sugar";

interface OrderRequest {
  orderId: string;
  items: string[];
  amount: number;
}

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

const START = event("START")<{ order: OrderRequest }>();
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

type SagaContext = {
  order?: OrderRequest;
  reservationId?: string;
  transactionId?: string;
  trackingNumber?: string;
  error?: string;
  completedSteps: string[];
};

export function createSagaActor(clock: VirtualClock = VirtualClock()) {
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
    clock,
    context: initialContext,
    setup: (m) => {
      m.effect(sagaStates.reservingInventory, { name: "reserveInventory", fn: () => undefined });
      m.effect(sagaStates.processingPayment, { name: "processPayment", fn: () => undefined });
      m.effect(sagaStates.creatingShipment, { name: "createShipment", fn: () => undefined });
      m.effect(sagaStates.notifying, { name: "sendNotification", fn: () => undefined });
      m.effect(sagaStates.compensatingRefund, { name: "runRefund", fn: () => undefined });
      m.effect(sagaStates.compensatingRelease, { name: "releaseInventory", fn: () => undefined });
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
}
