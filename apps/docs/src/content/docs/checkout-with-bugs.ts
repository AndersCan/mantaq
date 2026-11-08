/**
 * A small checkout with six planted bugs, for the Design gate page.
 * The design gate finds all six; the diagram marks the ones on a state with "!":
 * 1. `back` in `payment` throws.
 * 2. `payment` is reached with an empty address (see the expectations block).
 * 3. `paymentDeclined` is a dead end.
 * 4. `refunding` can never be reached.
 * 5. `refunded` can never be reached, because only `refunding` leads into it.
 * 6. `cancelOrder` is declared and no state handles it.
 */
import type { Expectations } from "@mantaq/inspect";
import { Actor, VirtualClock, event, state } from "@mantaq/core";

/** The visitor enters their name and email. */
const basicInfo = state("basicInfo")();
/** The visitor enters where to ship the order. */
const shippingAddress = state("shippingAddress")();
/** The visitor enters their card details. */
const payment = state("payment")();
/** The order went through. */
const orderPlaced = state("orderPlaced")().final();
/** The card was declined and the visitor is stuck here. */
const paymentDeclined = state("paymentDeclined")();
/** The order is being refunded. */
const refunding = state("refunding")();
/** The money went back to the visitor. */
const refunded = state("refunded")().final();

/** The visitor sent their name and email. */
const submitBasicInfo = event("submitBasicInfo")<{ email: string }>();
/** The visitor sent their shipping address. */
const submitShipping = event("submitShipping")<{ address: string }>();
/** The visitor went back a step. */
const back = event("back")();
/** The visitor placed the order. */
const placeOrder = event("placeOrder")();
/** The card was declined. */
const cardDeclined = event("cardDeclined")();
/** The refund went through. */
const refundIssued = event("refundIssued")();
/** The visitor cancelled the order. */
const cancelOrder = event("cancelOrder")();

const initialContext: { email: string; address: string } = { email: "", address: "" };

export function createCheckoutWithBugsActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
    // Planted bug 6: `cancelOrder` is declared and no state handles it.
    inputs: [
      submitBasicInfo,
      submitShipping,
      back,
      placeOrder,
      cardDeclined,
      refundIssued,
      cancelOrder,
    ],
    internal: [],
    // Planted bugs 4 and 5: nothing leads into `refunding`, so `refunded` is unreachable too.
    states: [
      basicInfo,
      shippingAddress,
      payment,
      orderPlaced,
      paymentDeclined,
      refunding,
      refunded,
    ],
    initial: basicInfo,
    clock,
    context: initialContext,
    setup: (m) => {
      /** The email is saved, and the shipping form opens. */
      m.on(basicInfo, {
        event: submitBasicInfo,
        to: [shippingAddress],
        handler: (received, { context }) => {
          context.set({ ...context.get(), email: received.payload.email });
          return { state: shippingAddress };
        },
      });
      /** The address is saved, and the card form opens. */
      m.on(shippingAddress, {
        event: submitShipping,
        to: [payment],
        // Planted bug 2: the shipping step accepts an empty address.
        handler: (received, { context }) => {
          context.set({ ...context.get(), address: received.payload.address });
          return { state: payment };
        },
      });
      /** The visitor went back to shipping. */
      m.on(payment, {
        event: back,
        to: [shippingAddress],
        // Planted bug 1: going back from payment throws.
        handler: () => {
          throw new Error("the shipping address was lost");
        },
      });
      /** The order is placed. */
      m.on(payment, {
        event: placeOrder,
        to: [orderPlaced],
        handler: () => ({ state: orderPlaced }),
      });
      // Planted bug 3: `paymentDeclined` has no handler, so the visitor is stuck.
      /** The card was declined. */
      m.on(payment, {
        event: cardDeclined,
        to: [paymentDeclined],
        handler: () => ({ state: paymentDeclined }),
      });
      /** The refund went through. */
      m.on(refunding, {
        event: refundIssued,
        to: [refunded],
        handler: () => ({ state: refunded }),
      });
    },
  });
}

/** What the fuzzer must never see. Delete the line to see the bug go unreported. */
export const checkoutWithBugsExpectations: Expectations<typeof createCheckoutWithBugsActor> = {
  payment: { neverSee: [{ address: "" }] },
};
