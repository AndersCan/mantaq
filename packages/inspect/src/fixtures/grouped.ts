/** Checkout whose states carry `@group` tags: two groups and an ungrouped state. */
import { Actor, event, machine, state } from "@mantaq/core";

/** The order waits in the cart. Mail help@group.example with questions. */
const inCart = state("inCart")();
/** The card is charged. @group payment */
const chargingCard = state("chargingCard")();
/**
 * The bank asks the buyer to confirm.
 * @group payment
 */
const confirming = state("confirming")();
/** The parcel is packed and sent. @group shipping. */
const packing = state("packing")(),
  sent = state("sent")().final();

/** The buyer checked out. */
const checkout = event("checkout")();
/** The card was charged. */
const charged = event("charged")();
/** The buyer confirmed the payment. */
const confirmed = event("confirmed")();
/** The parcel was packed. */
const packed = event("packed")();

export const grouped = machine("grouped", {
  create: ({ clock }) => {
    return Actor({
      inputs: [checkout, charged, confirmed, packed],
      states: [inCart, chargingCard, confirming, packing, sent],
      initial: inCart,
      clock,
      setup: (m) => {
        /** Checking out charges the card. */
        m.on(inCart, {
          event: checkout,
          to: [chargingCard],
          handler: () => ({ state: chargingCard }),
        });
        /** A charged card needs the buyer's confirmation. */
        m.on(chargingCard, {
          event: charged,
          to: [confirming],
          handler: () => ({ state: confirming }),
        });
        /** A confirmed payment starts packing. */
        m.on(confirming, { event: confirmed, to: [packing], handler: () => ({ state: packing }) });
        /** A packed parcel is sent. */
        m.on(packing, { event: packed, to: [sent], handler: () => ({ state: sent }) });
      },
    });
  },
});
