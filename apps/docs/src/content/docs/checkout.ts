/**
 * Shared checkout example for the Mantaq docs.
 *
 * This module is the single source of truth for the running checkout machine
 * used across the narrative docs (apps/docs). It mirrors the canonical example
 * in `packages/examples/checkout.test.ts` (which `scripts/docs-check.mjs` Gate C
 * typechecks and Gate A uses as the ID registry). Import the pieces you need
 * instead of re-declaring the machine inline, so the example stays in one place.
 *
 * Story: a multi-step checkout form.
 *
 *   basicInfo -> shippingAddress -> payment -> submitting -> success (final)
 *                                      ^ (back) v                  v (back)
 *                                                               error
 */
import { Actor, VirtualClock, state, event } from "@mantaq/core";
import { withTimeout, withPromise } from "@mantaq/sugar";

export type BasicInfo = {
  email: string;
  name: string;
};

export type ShippingAddress = {
  street: string;
  city: string;
  zip: string;
};

export type PaymentInfo = {
  cardNumber: string;
};

export type CheckoutContext = {
  basicInfo?: BasicInfo;
  shippingAddress?: ShippingAddress;
  paymentInfo?: PaymentInfo;
  orderId?: string;
};

export const basicInfo = state("basicInfo")();
export const shippingAddress = state("shippingAddress")();
export const payment = state("payment")();
export const submitting = state("submitting")();
export const success = state("success")().final();
export const error = state("error")();

export const submitBasicInfo = event("submitBasicInfo")<BasicInfo>();
export const submitShipping = event("submitShipping")<ShippingAddress>();
export const submitPayment = event("submitPayment")<PaymentInfo>();
export const back = event("back")();
export const paymentOk = event("paymentOk")<{ orderId: string }>();
export const paymentFail = event("paymentFail")<{ reason: string }>();
export const submittingDone = event("submittingDone")();

export function chargeCard(cardNumber: string): Promise<string> {
  // your payment provider. resolves with an order id.
  return Promise.resolve(`ord_${cardNumber.slice(-4)}`);
}

export function createCheckoutActor(
  options: { clock?: VirtualClock; chargeCard?: typeof chargeCard } = {},
) {
  const chargeCardImpl = options.chargeCard ?? chargeCard;
  const c = options.clock ?? VirtualClock();
  const initialContext: CheckoutContext = {};
  const actor = Actor({
    inputs: [submitBasicInfo, submitShipping, submitPayment, back],
    internal: [paymentOk, paymentFail, submittingDone],
    states: [basicInfo, shippingAddress, payment, submitting, success, error],
    initial: basicInfo,
    clock: c,
    context: initialContext,
    setup: (m) => {
      m.effect(submitting, {
        name: "chargeCard",
        fn: (input) => {
          const snapshot = input.context.get();
          if (!snapshot.paymentInfo) {
            return;
          }
          withTimeout(800, { input: input, event: () => submittingDone.create() });
          return withPromise({
            promise: chargeCardImpl(snapshot.paymentInfo.cardNumber),
            signal: input.signal,
            emit: input.emit,
            events: {
              success: (orderId) => paymentOk.create({ orderId }),
              error: (reason) => paymentFail.create({ reason: String(reason) }),
            },
          });
        },
      });
      m.onAny({
        eventRef: back,
        handler: (_event, { context }) => {
          const currentState = actor.state.name;
          if (currentState === "payment") {
            const current = context.get();
            current.paymentInfo = undefined;
            context.set(current);
            return { state: shippingAddress };
          }
          if (currentState === "shippingAddress") {
            const current = context.get();
            current.shippingAddress = undefined;
            context.set(current);
            return { state: basicInfo };
          }
          if (currentState === "error") {
            return { state: payment };
          }
          return {};
        },
      });
      m.on(basicInfo, {
        eventRef: submitBasicInfo,
        handler: (event, { context }) => {
          const current = context.get();
          current.basicInfo = event.payload;
          context.set(current);
          return { state: shippingAddress };
        },
      });
      m.on(shippingAddress, {
        eventRef: submitShipping,
        handler: (event, { context }) => {
          const current = context.get();
          current.shippingAddress = event.payload;
          context.set(current);
          return { state: payment };
        },
      });
      m.on(payment, {
        eventRef: submitPayment,
        handler: (event, { context }) => {
          const current = context.get();
          current.paymentInfo = event.payload;
          context.set(current);
          return { state: submitting };
        },
      });
      m.on(submitting, {
        eventRef: paymentOk,
        handler: (event, { context }) => {
          const current = context.get();
          current.orderId = event.payload.orderId;
          context.set(current);
          return { state: success };
        },
      });
      m.on(submitting, { eventRef: paymentFail, handler: () => ({ state: error }) });
      m.on(submitting, { eventRef: submittingDone, handler: () => ({ state: success }) });
    },
  });
  return { actor, clock: c };
}

export const checkout = createCheckoutActor().actor;
