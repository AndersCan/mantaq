/**
 * CANONICAL DOCS EXAMPLE — multi-step checkout.
 *
 * This file is the single source of truth for the running example used
 * throughout the Mantaq docs (apps/docs). The docs must use ONLY the entity
 * IDs declared here. `scripts/docs-check.mjs` parses this file and verifies
 * every ID used in the narrative docs exists in this registry.
 *
 * Story: a multi-step checkout form.
 *
 *   basicInfo → shippingAddress → payment → submitting → success (final)
 *                                     ↕ (back) ↕               ↕ (back)
 *                                                          error
 *
 * Effects on `submitting`: charge card via promise (paymentOk / paymentFail)
 * and a 800ms timeout fallback (submittingDone).
 */

import { describe, it, expect } from "vite-plus/test";
import { Actor, VirtualClock, state, event } from "@mantaq/core";
import { matches, withTimeout, withPromise } from "@mantaq/sugar";

type BasicInfo = {
  email: string;
  name: string;
};

type ShippingAddress = {
  street: string;
  city: string;
  zip: string;
};

type PaymentInfo = {
  cardNumber: string;
};

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

const submitBasicInfo = event("submitBasicInfo")<BasicInfo>();
const submitShipping = event("submitShipping")<ShippingAddress>();
const submitPayment = event("submitPayment")<PaymentInfo>();
const back = event("back")();
const paymentOk = event("paymentOk")<{ orderId: string }>();
const paymentFail = event("paymentFail")<{ reason: string }>();
const submittingDone = event("submittingDone")();

function chargeCard(cardNumber: string): Promise<string> {
  // your payment provider. resolves with an order id.
  return Promise.resolve(`ord_${cardNumber.slice(-4)}`);
}

function createCheckoutActor(
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
        withTimeout(800, input, () => submittingDone.create());
        return withPromise(chargeCardImpl(s.paymentInfo!.cardNumber), input.signal, input.emit, {
          success: (orderId) => paymentOk.create({ orderId }),
          error: (reason) => paymentFail.create({ reason: String(reason) }),
        });
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

describe("checkout actor", () => {
  it("navigates basicInfo → shippingAddress → payment → submitting → success", async () => {
    const { actor } = createCheckoutActor();

    expect(matches(actor, "basicInfo")).toBe(true);
    expect(actor.snapshot().done).toBeFalsy();

    actor.send(submitBasicInfo.create({ email: "a@b.com", name: "A" }));
    expect(matches(actor, "shippingAddress")).toBe(true);

    actor.send(submitShipping.create({ street: "123", city: "C", zip: "12345" }));
    expect(matches(actor, "payment")).toBe(true);

    actor.send(submitPayment.create({ cardNumber: "1111222233334444" }));
    expect(matches(actor, "submitting")).toBe(true);
    expect(actor.snapshot().done).toBeFalsy();

    await actor.settled();
    expect(matches(actor, "success")).toBe(true);
    expect(actor.snapshot().done).toBe(true);
    expect(actor.context.orderId).toBe("ord_4444");
  });

  it("accumulates form data in context across steps", () => {
    const { actor } = createCheckoutActor();

    actor.send(submitBasicInfo.create({ email: "a@b.com", name: "A" }));
    expect(actor.context.basicInfo).toEqual({ email: "a@b.com", name: "A" });
    expect(actor.context.shippingAddress).toBeUndefined();

    actor.send(submitShipping.create({ street: "123", city: "C", zip: "12345" }));
    expect(actor.context.shippingAddress).toEqual({ street: "123", city: "C", zip: "12345" });
    expect(actor.context.paymentInfo).toBeUndefined();

    actor.send(submitPayment.create({ cardNumber: "1111222233334444" }));
    expect(actor.context.paymentInfo).toEqual({ cardNumber: "1111222233334444" });
  });

  it("backs up from shippingAddress to basicInfo", () => {
    const { actor } = createCheckoutActor();

    actor.send(submitBasicInfo.create({ email: "a@b.com", name: "A" }));
    expect(matches(actor, "shippingAddress")).toBe(true);

    actor.send(back.create());
    expect(matches(actor, "basicInfo")).toBe(true);
  });

  it("backs up from payment to shippingAddress", () => {
    const { actor } = createCheckoutActor();

    actor.send(submitBasicInfo.create({ email: "a@b.com", name: "A" }));
    actor.send(submitShipping.create({ street: "123", city: "C", zip: "12345" }));
    expect(matches(actor, "payment")).toBe(true);

    actor.send(back.create());
    expect(matches(actor, "shippingAddress")).toBe(true);
  });

  it("falls back to submittingDone timeout when charge hangs", () => {
    const clock = new VirtualClock();
    const { actor } = createCheckoutActor(clock, () => new Promise(() => {}));

    actor.send(submitBasicInfo.create({ email: "a@b.com", name: "A" }));
    actor.send(submitShipping.create({ street: "123", city: "C", zip: "12345" }));
    actor.send(submitPayment.create({ cardNumber: "1111222233334444" }));
    expect(matches(actor, "submitting")).toBe(true);

    clock.advance(800);
    expect(matches(actor, "success")).toBe(true);
    expect(actor.snapshot().done).toBe(true);
  });
});
