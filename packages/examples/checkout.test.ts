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

import { Actor, VirtualClock, state, event } from "@mantaq/core";
import { matches, withTimeout, withPromise } from "@mantaq/sugar";
import { describe, it, expect } from "vite-plus/test";

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

describe("checkout actor", () => {
  it("updates state from basicInfo through payment to success", async () => {
    const { actor } = createCheckoutActor();

    expect({
      matches: matches(actor, "basicInfo"),
      done: actor.snapshot().done,
    }).toEqual({ matches: true, done: undefined });

    actor.send(submitBasicInfo.create({ email: "a@b.com", name: "A" }));
    expect(matches(actor, "shippingAddress")).toBe(true);

    actor.send(submitShipping.create({ street: "123", city: "C", zip: "12345" }));
    expect(matches(actor, "payment")).toBe(true);

    actor.send(submitPayment.create({ cardNumber: "1111222233334444" }));
    expect({
      matches: matches(actor, "submitting"),
      done: actor.snapshot().done,
    }).toEqual({ matches: true, done: undefined });

    await actor.settled();
    expect(matches(actor, "success")).toBe(true);
    expect({ done: actor.snapshot().done, orderId: actor.context.orderId }).toEqual({
      done: true,
      orderId: "ord_4444",
    });
  });

  it("keeps form data in context across steps", () => {
    const { actor } = createCheckoutActor();

    actor.send(submitBasicInfo.create({ email: "a@b.com", name: "A" }));
    expect({
      basicInfo: actor.context.basicInfo,
      shippingAddress: actor.context.shippingAddress,
    }).toEqual({ basicInfo: { email: "a@b.com", name: "A" }, shippingAddress: undefined });

    actor.send(submitShipping.create({ street: "123", city: "C", zip: "12345" }));
    expect({
      shippingAddress: actor.context.shippingAddress,
      paymentInfo: actor.context.paymentInfo,
    }).toEqual({
      shippingAddress: { street: "123", city: "C", zip: "12345" },
      paymentInfo: undefined,
    });

    actor.send(submitPayment.create({ cardNumber: "1111222233334444" }));
    expect(actor.context.paymentInfo).toEqual({ cardNumber: "1111222233334444" });
  });

  it("returns to basicInfo when back fires in shippingAddress", () => {
    const { actor } = createCheckoutActor();

    actor.send(submitBasicInfo.create({ email: "a@b.com", name: "A" }));
    expect(matches(actor, "shippingAddress")).toBe(true);

    actor.send(back.create());
    expect(matches(actor, "basicInfo")).toBe(true);
  });

  it("returns to shippingAddress when back fires in payment", () => {
    const { actor } = createCheckoutActor();

    actor.send(submitBasicInfo.create({ email: "a@b.com", name: "A" }));
    actor.send(submitShipping.create({ street: "123", city: "C", zip: "12345" }));
    expect(matches(actor, "payment")).toBe(true);

    actor.send(back.create());
    expect(matches(actor, "shippingAddress")).toBe(true);
  });

  it("resolves via submittingDone timeout when charge hangs", () => {
    const clock = VirtualClock();
    const { actor } = createCheckoutActor({ clock, chargeCard: () => new Promise(() => {}) });

    actor.send(submitBasicInfo.create({ email: "a@b.com", name: "A" }));
    actor.send(submitShipping.create({ street: "123", city: "C", zip: "12345" }));
    actor.send(submitPayment.create({ cardNumber: "1111222233334444" }));
    expect(matches(actor, "submitting")).toBe(true);

    clock.advance(800);
    expect(matches(actor, "success")).toBe(true);
    expect(actor.snapshot().done).toBe(true);
  });
});
