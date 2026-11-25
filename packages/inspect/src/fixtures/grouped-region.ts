import { Actor, event, machine, state } from "@mantaq/core";

/** The checkout screen. */
const screen = state("screen")();
/** The order waits in the cart. */
const inCart = state("inCart")();
/** The card is charged. @group payment */
const chargingCard = state("chargingCard")();
/** The bank asks the buyer to confirm. @group payment */
const confirming = state("confirming")();
/** The order is paid. */
const paid = state("paid")();
/** The buyer checked out. */
const checkout = event("checkout")();
/** The card was charged. */
const charged = event("charged")();
/** The buyer confirmed the payment. */
const confirmed = event("confirmed")();

/** A checkout whose order region has a `payment` group. */
export const groupedRegion = machine("groupedRegion", {
  create: ({ clock }) => {
    const order = Actor({
      clock,
      inputs: [checkout, charged, confirmed],
      states: [inCart, chargingCard, confirming, paid],
      initial: inCart,
      setup: (m) => {
        m.on(inCart, {
          event: checkout,
          to: [chargingCard],
          handler: () => ({ state: chargingCard }),
        });
        m.on(chargingCard, {
          event: charged,
          to: [confirming],
          handler: () => ({ state: confirming }),
        });
        m.on(confirming, { event: confirmed, to: [paid], handler: () => ({ state: paid }) });
      },
    });
    return Actor({
      clock,
      inputs: [],
      states: [screen],
      initial: screen,
      regions: { order },
      setup: () => {},
    });
  },
});
