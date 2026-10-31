/**
 * Mirror of `packages/examples/checkout.test.ts`. The example's machine lives
 * inside a test file and cannot be imported without registering its tests, so
 * handlers are copied verbatim here; the `chargeCard` effect is stubbed, so
 * payment results arrive as injected internal events.
 */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

type BasicInfo = { email: string; name: string };
type ShippingAddress = { street: string; city: string; zip: string };
type PaymentInfo = { cardNumber: string };

type CheckoutContext = {
  basicInfo?: BasicInfo;
  shippingAddress?: ShippingAddress;
  paymentInfo?: PaymentInfo;
  orderId?: string;
};

const basicInfo = state("basicInfo")();
const shippingAddress = state("shippingAddress")();
const payment = state("payment")();
const submitting = state("submitting")();
const success = state("success")().final();
const error = state("error")();

export const submitBasicInfo = event("submitBasicInfo")<BasicInfo>();
const submitShipping = event("submitShipping")<ShippingAddress>();
const submitPayment = event("submitPayment")<PaymentInfo>();
const back = event("back")();
const paymentOk = event("paymentOk")<{ orderId: string }>();
const paymentFail = event("paymentFail")<{ reason: string }>();
const submittingDone = event("submittingDone")();

export function createCheckoutActor(clock: VirtualClock = VirtualClock()) {
  const initialContext: CheckoutContext = {};
  const actor = Actor({
    inputs: [submitBasicInfo, submitShipping, submitPayment, back],
    internal: [paymentOk, paymentFail, submittingDone],
    states: [basicInfo, shippingAddress, payment, submitting, success, error],
    initial: basicInfo,
    clock,
    context: initialContext,
    setup: (m) => {
      m.effect(submitting, { name: "chargeCard", fn: () => undefined });
      m.on(payment, {
        event: back,
        to: [shippingAddress],
        handler: (_event, { context }) => {
          const current = context.get();
          current.paymentInfo = undefined;
          context.set(current);
          return { state: shippingAddress };
        },
      });
      m.on(shippingAddress, {
        event: back,
        to: [basicInfo],
        handler: (_event, { context }) => {
          const current = context.get();
          current.shippingAddress = undefined;
          context.set(current);
          return { state: basicInfo };
        },
      });
      m.on(error, { event: back, to: [payment], handler: () => ({ state: payment }) });
      m.on(basicInfo, {
        event: submitBasicInfo,
        to: [shippingAddress],
        handler: (event, { context }) => {
          const current = context.get();
          current.basicInfo = event.payload;
          context.set(current);
          return { state: shippingAddress };
        },
      });
      m.on(shippingAddress, {
        event: submitShipping,
        to: [payment],
        handler: (event, { context }) => {
          const current = context.get();
          current.shippingAddress = event.payload;
          context.set(current);
          return { state: payment };
        },
      });
      m.on(payment, {
        event: submitPayment,
        to: [submitting],
        handler: (event, { context }) => {
          const current = context.get();
          current.paymentInfo = event.payload;
          context.set(current);
          return { state: submitting };
        },
      });
      m.on(submitting, {
        event: paymentOk,
        to: [success],
        handler: (event, { context }) => {
          const current = context.get();
          current.orderId = event.payload.orderId;
          context.set(current);
          return { state: success };
        },
      });
      m.on(submitting, { event: paymentFail, to: [error], handler: () => ({ state: error }) });
      m.on(submitting, {
        event: submittingDone,
        to: [success],
        handler: () => ({ state: success }),
      });
    },
  });
  return actor;
}
