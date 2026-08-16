/**
 * PINNED FIXTURE — checkout.
 *
 * Source: packages/examples/checkout.actor.test.ts (`createCheckoutActor`)
 * FIXTURE_VERSION: 1
 *
 * Do not import from packages/examples: factories are module-private inside
 * .actor.test.ts with no exports map. This is a copy; the drift guard
 * (browser/fixtures/fingerprints.json + scripts) catches upstream refactors
 * that change the graph shape.
 *
 * Story: multi-step checkout form.
 *
 *   basicInfo → shippingAddress → payment → submitting → success (final)
 *                                     ↕ (back) ↕               ↕ (back)
 *                                                          error
 *
 * Effects on `submitting`: charge card via promise (paymentOk / paymentFail)
 * and an 800ms timeout fallback (submittingDone).
 */

import { Actor, VirtualClock, state, event } from "@mantaq/core";
import type { EffectInput, InternalEvent } from "@mantaq/core";

// Inlined copies of @mantaq/sugar helpers — pinned fixtures stay
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

function withPromise<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  emit: (event: { type: string; payload?: unknown }) => void,
  events: {
    success: (data: T) => { type: string; payload?: unknown };
    error: (err: unknown) => { type: string; payload?: unknown };
  },
): void {
  promise
    .then((data) => {
      if (!signal.aborted) emit(events.success(data));
    })
    .catch((err) => {
      if (!signal.aborted) emit(events.error(err));
    });
}

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

type CheckoutContext = {
  basicInfo?: BasicInfo;
  shippingAddress?: ShippingAddress;
  paymentInfo?: PaymentInfo;
  orderId?: string;
};

export const basicInfo = state("basicInfo")();
const shippingAddress = state("shippingAddress")();
const payment = state("payment")();
export const submitting = state("submitting")();
const success = state("success")().final();
const error = state("error")();

export const submitBasicInfo = event("submitBasicInfo")<BasicInfo>();
export const submitShipping = event("submitShipping")<ShippingAddress>();
export const submitPayment = event("submitPayment")<PaymentInfo>();
const back = event("back")();
const paymentOk = event("paymentOk")<{ orderId: string }>();
const paymentFail = event("paymentFail")<{ reason: string }>();
const submittingDone = event("submittingDone")();

function chargeCard(cardNumber: string): Promise<string> {
  // your payment provider. resolves with an order id.
  return Promise.resolve(`ord_${cardNumber.slice(-4)}`);
}

export function createCheckoutActor(
  clock?: VirtualClock,
  chargeCardImpl: (cardNumber: string) => Promise<string> = chargeCard,
) {
  const c = clock ?? new VirtualClock();
  const actor = new Actor({
    inputs: [submitBasicInfo, submitShipping, submitPayment, back],
    internal: [paymentOk, paymentFail, submittingDone],
    states: [basicInfo, shippingAddress, payment, submitting, success, error],
    initial: basicInfo,
    clock: c,
    context: {} as CheckoutContext,
    setup: (m) => {
      m.effect(submitting, (input) => {
        const s = input.context.get();
        withPromise(chargeCardImpl(s.paymentInfo!.cardNumber), input.signal, input.emit, {
          success: (orderId) => paymentOk.create({ orderId }),
          error: (reason) => paymentFail.create({ reason: String(reason) }),
        });
        withTimeout(800, input, () => submittingDone.create());
      });
      m.onAny(back, (_event, opts) => {
        const s = actor.state.name;
        if (s === "payment") {
          const cur = opts.context.get();
          cur.paymentInfo = undefined;
          opts.context.set(cur);
          return { state: shippingAddress };
        }
        if (s === "shippingAddress") {
          const cur = opts.context.get();
          cur.shippingAddress = undefined;
          opts.context.set(cur);
          return { state: basicInfo };
        }
        if (s === "error") {
          return { state: payment };
        }
        return {};
      });
      m.on(basicInfo, submitBasicInfo, (event, opts) => {
        const cur = opts.context.get();
        cur.basicInfo = event.payload;
        opts.context.set(cur);
        return { state: shippingAddress };
      });
      m.on(shippingAddress, submitShipping, (event, opts) => {
        const cur = opts.context.get();
        cur.shippingAddress = event.payload;
        opts.context.set(cur);
        return { state: payment };
      });
      m.on(payment, submitPayment, (event, opts) => {
        const cur = opts.context.get();
        cur.paymentInfo = event.payload;
        opts.context.set(cur);
        return { state: submitting };
      });
      m.on(submitting, paymentOk, (event, opts) => {
        const cur = opts.context.get();
        cur.orderId = event.payload.orderId;
        opts.context.set(cur);
        return { state: success };
      });
      m.on(submitting, paymentFail, () => ({ state: error }));
      m.on(submitting, submittingDone, () => ({ state: success }));
    },
  });
  return { actor, clock: c };
}
