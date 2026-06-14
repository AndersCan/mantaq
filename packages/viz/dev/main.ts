import { Actor, VirtualClock, state, event } from "@mantaq/core";
import "../src/index.ts";
import type { MantaqViz } from "../src/components/mantaq-viz.ts";

const idling = state("idling")();
const working = state("working")();
const reviewing = state("reviewing")();
const failed = state("failed")();
const completed = state("completed")().final();

const START = event("START")();
const FINISH = event("FINISH")();
const APPROVE = event("APPROVE")();
const REJECT = event("REJECT")();
const RETRY = event("RETRY")();
const RESET = event("RESET")();
const WORK_TIMEOUT = event("WORK_TIMEOUT")();

const clock = new VirtualClock();

function createWorkflowActor() {
  return new Actor({
    inputs: [START, FINISH, APPROVE, REJECT, RETRY, RESET],
    outputs: [],
    internal: [WORK_TIMEOUT],
    states: [idling, working, reviewing, failed, completed],
    initial: idling,
    context: { attempts: 0, reviewer: "alice" },
    clock,
    effects: {
      working: [
        ({ clock, signal, emit }) => {
          clock.setTimeout(
            4000,
            () => {
              emit(WORK_TIMEOUT.create(undefined));
            },
            { signal, eventName: "WORK_TIMEOUT" },
          );
        },
      ],
    },
    transitions: {
      idling: { START: () => ({ state: working }) },
      working: {
        FINISH: () => ({ state: reviewing }),
        WORK_TIMEOUT: () => ({ state: failed }),
      },
      reviewing: {
        APPROVE: () => ({ state: completed }),
        REJECT: () => ({ state: failed }),
      },
      failed: { RETRY: () => ({ state: working }), RESET: () => ({ state: idling }) },
    },
  });
}

// Order processing — main flow + two parallel regions
const SUBMIT_ORDER = event("SUBMIT_ORDER")();
const PAY = event("PAY")();
const REFUND = event("REFUND")();
const SHIP = event("SHIP")();
const DELIVER = event("DELIVER")();
const PAYMENT_DONE = event("PAYMENT_DONE")();
const SHIPPING_DONE = event("SHIPPING_DONE")();

const orderIdle = state("idle")();
const orderPlaced = state("placed")();
const orderFulfilled = state("fulfilled")().final();

const payIdle = state("idle")();
const payPending = state("pending")();
const payPaid = state("paid")().final();
const payRefunded = state("refunded")().final();

const shipIdle = state("idle")();
const shipPacking = state("packing")();
const shipShipped = state("shipped")();
const shipDelivered = state("delivered")().final();

const orderClock = new VirtualClock();

const paymentRegion = new Actor({
  inputs: [SUBMIT_ORDER],
  outputs: [PAYMENT_DONE],
  internal: [PAY, REFUND],
  states: [payIdle, payPending, payPaid, payRefunded],
  initial: payIdle,
  context: {} as {},
  clock: orderClock,
  effects: {
    pending: [
      ({ clock, signal, emit }) => {
        clock.setTimeout(
          3000,
          () => {
            emit(PAY.create(undefined));
          },
          { signal, eventName: "PAY" },
        );
      },
    ],
  },
  transitions: {
    idle: { SUBMIT_ORDER: () => ({ state: payPending }) },
    pending: {
      PAY: () => ({ state: payPaid, emit: [PAYMENT_DONE.create(undefined)] }),
      REFUND: () => ({ state: payRefunded }),
    },
  },
});

const shippingRegion = new Actor({
  inputs: [SUBMIT_ORDER],
  outputs: [SHIPPING_DONE],
  internal: [SHIP, DELIVER],
  states: [shipIdle, shipPacking, shipShipped, shipDelivered],
  initial: shipIdle,
  context: {} as {},
  clock: orderClock,
  effects: {
    packing: [
      ({ clock, signal, emit }) => {
        clock.setTimeout(
          2000,
          () => {
            emit(SHIP.create(undefined));
          },
          { signal, eventName: "SHIP" },
        );
      },
    ],
    shipped: [
      ({ clock, signal, emit }) => {
        clock.setTimeout(
          2000,
          () => {
            emit(DELIVER.create(undefined));
          },
          { signal, eventName: "DELIVER" },
        );
      },
    ],
  },
  transitions: {
    idle: { SUBMIT_ORDER: () => ({ state: shipPacking }) },
    packing: { SHIP: () => ({ state: shipShipped }) },
    shipped: { DELIVER: () => ({ state: shipDelivered, emit: [SHIPPING_DONE.create(undefined)] }) },
  },
});

const orderActor = new Actor({
  inputs: [SUBMIT_ORDER, REFUND, PAYMENT_DONE, SHIPPING_DONE],
  outputs: [],
  internal: [],
  states: [orderIdle, orderPlaced, orderFulfilled],
  initial: orderIdle,
  context: { orderId: "" },
  clock: orderClock,
  effects: {
    placed: [
      () => {
        paymentRegion.send(SUBMIT_ORDER);
        shippingRegion.send(SUBMIT_ORDER);
      },
    ],
  },
  regions: {
    payment: paymentRegion,
    shipping: shippingRegion,
  },
  transitions: {
    idle: {
      SUBMIT_ORDER: () => ({ state: orderPlaced }),
    },
    placed: {
      REFUND: () => ({ state: orderFulfilled }),
      PAYMENT_DONE: (_event, { actor }) => {
        if (actor.regions.payment.state.isFinal && actor.regions.shipping.state.isFinal) {
          return { state: orderFulfilled };
        }
        return {};
      },
      SHIPPING_DONE: (_event, { actor }) => {
        if (actor.regions.payment.state.isFinal && actor.regions.shipping.state.isFinal) {
          return { state: orderFulfilled };
        }
        return {};
      },
    },
  },
});

const workflowViz = document.querySelector<MantaqViz>("#workflow");
if (!workflowViz) throw new Error("workflow viz element not found");
workflowViz.name = "Workflow";
workflowViz.sampleContexts = {
  default: { attempts: 0, reviewer: "alice" },
  retry: { attempts: 3, reviewer: "bob" },
};
workflowViz.actor = createWorkflowActor();

const orderViz = document.querySelector<MantaqViz>("#orders");
if (!orderViz) throw new Error("orders viz element not found");
orderViz.name = "Order Processing";
orderViz.actor = orderActor;

Object.assign(globalThis, { orderActor, orderClock, paymentRegion, shippingRegion });
