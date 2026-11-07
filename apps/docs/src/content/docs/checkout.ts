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

/** The visitor enters their name and email. */
export const basicInfo = state("basicInfo")();
/** The visitor enters where to ship the order. */
export const shippingAddress = state("shippingAddress")();
/** The visitor enters their card details. */
export const payment = state("payment")();
/** The card is being charged; the visitor waits. */
export const submitting = state("submitting")();
/** The order went through. */
export const success = state("success")().final();
/** The payment failed and the visitor sees why. */
export const error = state("error")();

/** The visitor sent their name and email. */
export const submitBasicInfo = event("submitBasicInfo")<BasicInfo>();
/** The visitor sent their shipping address. */
export const submitShipping = event("submitShipping")<ShippingAddress>();
/** The visitor sent their card details. */
export const submitPayment = event("submitPayment")<PaymentInfo>();
/** The visitor went back a step. */
export const back = event("back")();
/** The card was charged. */
export const paymentOk = event("paymentOk")<{ orderId: string }>();
/** The card was declined. */
export const paymentFail = event("paymentFail")<{ reason: string }>();
/** The card charge took too long. */
export const paymentTimeout = event("paymentTimeout")();

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
    internal: [paymentOk, paymentFail, paymentTimeout],
    states: [basicInfo, shippingAddress, payment, submitting, success, error],
    initial: basicInfo,
    clock: c,
    context: initialContext,
    setup: (m) => {
      m.effect(submitting, {
        name: "chargeCard",
        sends: [paymentOk, paymentFail, paymentTimeout],
        fn: (input) => {
          const snapshot = input.context.get();
          if (!snapshot.paymentInfo) {
            return;
          }
          withTimeout(800, { input: input, event: () => paymentTimeout.create() });
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
        event: paymentTimeout,
        to: [error],
        handler: () => ({ state: error }),
      });
    },
  });
  return { actor, clock: c };
}

export const checkout = createCheckoutActor().actor;
