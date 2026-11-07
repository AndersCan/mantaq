/**
 * A small checkout with three planted bugs, for the Design gate page.
 * The design gate finds all three; the diagram marks them with "!".
 */
import type { Expectations } from "@mantaq/inspect";
import { Actor, VirtualClock, event, state } from "@mantaq/core";

/** The visitor enters their name and email. */
const basicInfo = state("basicInfo")();
/** The visitor enters where to ship the order. */
const shippingAddress = state("shippingAddress")();
/** The visitor enters their card details. */
const payment = state("payment")();
/** An old order the visitor can no longer reach. */
const archived = state("archived")();

/** The visitor sent their name and email. */
const submitBasicInfo = event("submitBasicInfo")<{ email: string }>();
/** The visitor sent their shipping address. */
const submitShipping = event("submitShipping")<{ address: string }>();
/** The visitor went back a step. */
const back = event("back")();

const initialContext: { email: string; address: string } = { email: "", address: "" };

export function createCheckoutWithBugsActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
    inputs: [submitBasicInfo, submitShipping, back],
    internal: [],
    // Planted bug 1: `archived` is declared and no handler leads to it.
    states: [basicInfo, shippingAddress, payment, archived],
    initial: basicInfo,
    clock,
    context: initialContext,
    setup: (m) => {
      m.on(basicInfo, {
        event: submitBasicInfo,
        to: [shippingAddress],
        handler: (received, { context }) => {
          context.set({ ...context.get(), email: received.payload.email });
          return { state: shippingAddress };
        },
      });
      m.on(shippingAddress, {
        event: submitShipping,
        to: [payment],
        // Planted bug 3: the shipping step accepts an empty address.
        handler: (received, { context }) => {
          context.set({ ...context.get(), address: received.payload.address });
          return { state: payment };
        },
      });
      m.on(payment, {
        event: back,
        to: [shippingAddress],
        // Planted bug 2: going back from payment throws.
        handler: () => {
          throw new Error("the shipping address was lost");
        },
      });
    },
  });
}

/** What the fuzzer must never see. Delete the line to see the bug go unreported. */
export const checkoutWithBugsExpectations: Expectations<typeof createCheckoutWithBugsActor> = {
  payment: { neverSee: [{ address: "" }] },
};
