/**
 * A small checkout with two planted bugs, for the Design gate page.
 * The design gate finds both; the diagram marks them with "!".
 */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

const basicInfo = state("basicInfo")();
const shippingAddress = state("shippingAddress")();
const payment = state("payment")();
const archived = state("archived")();

const submitBasicInfo = event("submitBasicInfo")();
const submitShipping = event("submitShipping")();
const back = event("back")();

export function createCheckoutWithBugsActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
    inputs: [submitBasicInfo, submitShipping, back],
    internal: [],
    // Planted bug 1: `archived` is declared and no handler leads to it.
    states: [basicInfo, shippingAddress, payment, archived],
    initial: basicInfo,
    clock,
    setup: (m) => {
      m.on(basicInfo, {
        event: submitBasicInfo,
        to: [shippingAddress],
        handler: () => ({ state: shippingAddress }),
      });
      m.on(shippingAddress, {
        event: submitShipping,
        to: [payment],
        handler: () => ({ state: payment }),
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
