/**
 * Structural copy of `packages/examples/checkout.test.ts`. The example's
 * machine lives inside a test file and cannot be imported without registering
 * its tests, so the graph-relevant parts are mirrored here.
 */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

type CheckoutContext = { paymentInfo?: { cardNumber: string }; orderId?: string };

const basicInfo = state("basicInfo")();
const shippingAddress = state("shippingAddress")();
const payment = state("payment")();
const submitting = state("submitting")();
const success = state("success")().final();
const error = state("error")();

export const submitBasicInfo = event("submitBasicInfo")<{ email: string }>();
const submitShipping = event("submitShipping")<{ zip: string }>();
const submitPayment = event("submitPayment")<{ cardNumber: string }>();
const back = event("back")();
const paymentOk = event("paymentOk")<{ orderId: string }>();
const paymentFail = event("paymentFail")<{ reason: string }>();
const submittingDone = event("submittingDone")();

export function createCheckoutActor() {
  const initialContext: CheckoutContext = {};
  const actor = Actor({
    inputs: [submitBasicInfo, submitShipping, submitPayment, back],
    internal: [paymentOk, paymentFail, submittingDone],
    states: [basicInfo, shippingAddress, payment, submitting, success, error],
    initial: basicInfo,
    clock: VirtualClock(),
    context: initialContext,
    setup: (m) => {
      m.effect(submitting, { name: "chargeCard", fn: () => undefined });
      m.onAny({
        eventRef: back,
        handler: () => {
          const current = actor.state.name;
          if (current === "payment") return { state: shippingAddress };
          if (current === "shippingAddress") return { state: basicInfo };
          if (current === "error") return { state: payment };
          return {};
        },
      });
      m.on(basicInfo, { eventRef: submitBasicInfo, handler: () => ({ state: shippingAddress }) });
      m.on(shippingAddress, { eventRef: submitShipping, handler: () => ({ state: payment }) });
      m.on(payment, { eventRef: submitPayment, handler: () => ({ state: submitting }) });
      m.on(submitting, { eventRef: paymentOk, handler: () => ({ state: success }) });
      m.on(submitting, { eventRef: paymentFail, handler: () => ({ state: error }) });
      m.on(submitting, { eventRef: submittingDone, handler: () => ({ state: success }) });
    },
  });
  return actor;
}
