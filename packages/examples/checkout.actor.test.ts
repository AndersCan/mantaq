/**
 * Problem: Forms have many states (idle → submitting → success/error). Easy to mess up with booleans
 * (isLoading, isSubmitted, hasError scattered everywhere).
 *
 * Actor model approach:
 *   - Each state is a named node (basicInfo, shippingAddress, payment, submitting, success, error)
 *   - Context holds accumulated form data (not state tracking)
 *   - snapshot().path tells you current state (no "step" field needed)
 *   - snapshot().done tells you if terminal state reached
 *   - Effects + clock handle async work (simulated API calls)
 *
 * Structure:
 *   basicInfo → shippingAddress → payment → submitting → success
 *                                      ↕ (BACK) ↕
 *                                    error
 */

import { describe, it, expect } from "vite-plus/test";
import { Actor, VirtualClock, state, event } from "@mantaq/core";
import { matches, withTimeout } from "@mantaq/sugar";

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

const basicInfoState = state("basicInfo")();
const shippingAddressState = state("shippingAddress")();
const paymentState = state("payment")();
const submittingState = state("submitting")();
const successState = state("success")().final();
const errorState = state("error")();

const submitBasicInfo = event("SUBMIT_BASIC_INFO")<BasicInfo>();
const submitShipping = event("SUBMIT_SHIPPING")<ShippingAddress>();
const submitPayment = event("SUBMIT_PAYMENT")<PaymentInfo>();
const backEvent = event("BACK")();
const submittingDoneEvent = event("SUBMITTING_DONE")();

type CheckoutContext = {
  basicInfo?: BasicInfo;
  shippingAddress?: ShippingAddress;
  paymentInfo?: PaymentInfo;
};

function createCheckoutActor(clock?: VirtualClock) {
  const c = clock ?? new VirtualClock();
  const actor = new Actor({
    inputs: [submitBasicInfo, submitShipping, submitPayment, backEvent],
    outputs: [],
    internal: [submittingDoneEvent],
    states: [
      basicInfoState,
      shippingAddressState,
      paymentState,
      submittingState,
      successState,
      errorState,
    ],
    initial: basicInfoState,
    clock: c,
    context: {} as CheckoutContext,
    setup: (m) => {
      m.effect(submittingState, (input) =>
        withTimeout(800, input, () => ({ id: "SUBMITTING_DONE" })),
      );
      m.onAny(backEvent, (_event, opts) => {
        const s = actor.state.name;
        if (s === "payment") {
          const cur = opts!.context.get();
          opts!.context.set({ ...cur, paymentInfo: undefined });
          return { state: shippingAddressState };
        }
        if (s === "shippingAddress") {
          const cur = opts!.context.get();
          opts!.context.set({ ...cur, shippingAddress: undefined });
          return { state: basicInfoState };
        }
        if (s === "error") {
          return { state: paymentState };
        }
        return {};
      });
      m.on(basicInfoState, submitBasicInfo, (event, opts) => {
        const cur = opts!.context.get();
        opts!.context.set({ ...cur, basicInfo: { email: event.email, name: event.name } });
        return { state: shippingAddressState };
      });
      m.on(shippingAddressState, submitShipping, (event, opts) => {
        const cur = opts!.context.get();
        opts!.context.set({
          ...cur,
          shippingAddress: { street: event.street, city: event.city, zip: event.zip },
        });
        return { state: paymentState };
      });
      m.on(paymentState, submitPayment, (event, opts) => {
        const cur = opts!.context.get();
        opts!.context.set({ ...cur, paymentInfo: { cardNumber: event.cardNumber } });
        return { state: submittingState };
      });
      m.on(submittingState, submittingDoneEvent, () => ({ state: successState }));
    },
  });
  return { actor, clock: c };
}

describe("checkout actor", () => {
  it("should navigate basicInfo → shippingAddress → payment → submitting → success", () => {
    const clock = new VirtualClock();
    const { actor } = createCheckoutActor(clock);

    expect(matches(actor, "basicInfo")).toBe(true);
    expect(actor.snapshot().done).toBeFalsy();

    actor.send(submitBasicInfo.create({ email: "a@b.com", name: "A" }));
    expect(matches(actor, "shippingAddress")).toBe(true);

    actor.send(submitShipping.create({ street: "123", city: "C", zip: "12345" }));
    expect(matches(actor, "payment")).toBe(true);

    actor.send(submitPayment.create({ cardNumber: "1111222233334444" }));
    expect(matches(actor, "submitting")).toBe(true);
    expect(actor.snapshot().done).toBeFalsy();

    clock.advance(800);
    expect(matches(actor, "success")).toBe(true);
    expect(actor.snapshot().done).toBe(true);
  });

  it("should accumulate form data in context across steps", () => {
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

  it("should handle back navigation from shippingAddress to basicInfo", () => {
    const { actor } = createCheckoutActor();

    actor.send(submitBasicInfo.create({ email: "a@b.com", name: "A" }));
    expect(matches(actor, "shippingAddress")).toBe(true);

    actor.send(backEvent.create());
    expect(matches(actor, "basicInfo")).toBe(true);
  });

  it("should handle back navigation from payment to shippingAddress", () => {
    const { actor } = createCheckoutActor();

    actor.send(submitBasicInfo.create({ email: "a@b.com", name: "A" }));
    actor.send(submitShipping.create({ street: "123", city: "C", zip: "12345" }));
    expect(matches(actor, "payment")).toBe(true);

    actor.send(backEvent.create());
    expect(matches(actor, "shippingAddress")).toBe(true);
  });
});
