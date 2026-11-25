/** A shop board: the till's two card payment states are a group, and the stock counts beside it. */
import { Actor, event, machine, state } from "@mantaq/core";

/** The shop is open. */
const trading = state("trading")();
/** The till waits for a buyer. */
const open = state("open")();
/** The card is charged. @group payment */
const chargingCard = state("chargingCard")();
/** The bank asks the buyer to confirm. @group payment */
const confirming = state("confirming")();
/** The order is paid. */
const paid = state("paid")();
/** The stock is counted. */
const counting = state("counting")();

/** The buyer pays. */
const pay = event("pay")();
/** The card was charged. */
const charged = event("charged")();
/** The buyer confirmed the payment. */
const confirmed = event("confirmed")();
/** One more item was counted. */
const counted = event("counted")();

export const groupedBoard = machine("groupedBoard", {
  create: ({ clock }) => {
    const till = Actor({
      clock,
      inputs: [pay, charged, confirmed],
      states: [open, chargingCard, confirming, paid],
      initial: open,
      setup: (m) => {
        m.on(open, { event: pay, to: [chargingCard], handler: () => ({ state: chargingCard }) });
        m.on(chargingCard, {
          event: charged,
          to: [confirming],
          handler: () => ({ state: confirming }),
        });
        m.on(confirming, { event: confirmed, to: [paid], handler: () => ({ state: paid }) });
      },
    });
    const stock = Actor({
      clock,
      inputs: [counted],
      states: [counting],
      initial: counting,
      setup: (m) => {
        m.on(counting, { event: counted, to: [counting], handler: () => ({ state: counting }) });
      },
    });
    const shop = Actor({ clock, inputs: [], states: [trading], initial: trading, setup: () => {} });
    return { actor: shop, till, stock };
  },
});
