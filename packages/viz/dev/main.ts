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
    setup: (m) => {
      m.on(idling, START, () => ({ state: working }));
      m.on(working, FINISH, () => ({ state: reviewing }));
      m.on(working, WORK_TIMEOUT, () => ({ state: failed }));
      m.on(reviewing, APPROVE, () => ({ state: completed }));
      m.on(reviewing, REJECT, () => ({ state: failed }));
      m.on(failed, RETRY, () => ({ state: working }));
      m.on(failed, RESET, () => ({ state: idling }));
      m.effect(working, ({ clock, signal, emit }) => {
        clock.setTimeout(
          4000,
          () => {
            emit(WORK_TIMEOUT.create(undefined));
          },
          { signal, eventName: "WORK_TIMEOUT" },
        );
      });
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
  setup: (m) => {
    m.on(payIdle, SUBMIT_ORDER, () => ({ state: payPending }));
    m.on(payPending, PAY, () => ({ state: payPaid, emit: [PAYMENT_DONE.create(undefined)] }));
    m.on(payPending, REFUND, () => ({ state: payRefunded }));
    m.effect(payPending, ({ clock, signal, emit }) => {
      clock.setTimeout(
        3000,
        () => {
          emit(PAY.create(undefined));
        },
        { signal, eventName: "PAY" },
      );
    });
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
  setup: (m) => {
    m.on(shipIdle, SUBMIT_ORDER, () => ({ state: shipPacking }));
    m.on(shipPacking, SHIP, () => ({ state: shipShipped }));
    m.on(shipShipped, DELIVER, () => ({
      state: shipDelivered,
      emit: [SHIPPING_DONE.create(undefined)],
    }));
    m.effect(shipPacking, ({ clock, signal, emit }) => {
      clock.setTimeout(
        2000,
        () => {
          emit(SHIP.create(undefined));
        },
        { signal, eventName: "SHIP" },
      );
    });
    m.effect(shipShipped, ({ clock, signal, emit }) => {
      clock.setTimeout(
        2000,
        () => {
          emit(DELIVER.create(undefined));
        },
        { signal, eventName: "DELIVER" },
      );
    });
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
  regions: {
    payment: paymentRegion,
    shipping: shippingRegion,
  },
  setup: (m) => {
    m.on(orderIdle, SUBMIT_ORDER, () => ({ state: orderPlaced }));
    m.on(orderPlaced, REFUND, () => ({ state: orderFulfilled }));
    m.on(orderPlaced, PAYMENT_DONE, (_event, { actor }) => {
      if (actor.regions.payment.state.isFinal && actor.regions.shipping.state.isFinal) {
        return { state: orderFulfilled };
      }
      return {};
    });
    m.on(orderPlaced, SHIPPING_DONE, (_event, { actor }) => {
      if (actor.regions.payment.state.isFinal && actor.regions.shipping.state.isFinal) {
        return { state: orderFulfilled };
      }
      return {};
    });
    m.effect(orderPlaced, () => {
      paymentRegion.send(SUBMIT_ORDER);
      shippingRegion.send(SUBMIT_ORDER);
    });
  },
});

const workflowViz = document.querySelector<MantaqViz>("#workflow");
if (!workflowViz) throw new Error("workflow viz element not found");
workflowViz.viewConfig = {
  name: "Workflow",
  sampleContexts: {
    default: { attempts: 0, reviewer: "alice" },
    retry: { attempts: 3, reviewer: "bob" },
  },
  activeContext: "default",
};
workflowViz.actor = createWorkflowActor();

const orderViz = document.querySelector<MantaqViz>("#orders");
if (!orderViz) throw new Error("orders viz element not found");
orderViz.viewConfig = { name: "Order Processing", sampleContexts: null, activeContext: null };
orderViz.actor = orderActor;

Object.assign(globalThis, { orderActor, orderClock, paymentRegion, shippingRegion });
