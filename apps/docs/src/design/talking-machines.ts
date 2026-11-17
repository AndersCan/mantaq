import { Actor, event, machine, state } from "@mantaq/core";
import { onOutput, withTimeout } from "@mantaq/sugar";

/** The person opens a checkout. */
const checkoutStarted = event("CHECKOUT_STARTED")();
/** Stock says the item is held for this checkout. */
const itemHeld = event("ITEM_HELD")();
/** The payment came in. */
const paymentReceived = event("PAYMENT_RECEIVED")();
/** The 30 seconds to pay ran out. */
const waitedTooLong = event("WAITED_TOO_LONG")();
/** Checkout asks stock to hold the item. */
const holdItem = event("HOLD_ITEM")();
/** Checkout tells stock the item is sold. */
const itemSold = event("ITEM_SOLD")();
/** Checkout tells stock to let the item go. */
const releaseItem = event("RELEASE_ITEM")();

/** Nothing started yet. */
const browsing = state("browsing")();
/** Asked stock to hold the item, waiting for the answer. */
const waitingForStock = state("waitingForStock")();
/** The item is held; 30 seconds to pay. */
const waitingForPayment = state("waitingForPayment")();
/** Paid. */
const paid = state("paid")().final();
/** The 30 seconds ran out. */
const expired = state("expired")().final();

/** The item is on the shelf. */
const free = state("free")();
/** The item is held for a checkout. */
const holding = state("holding")();
/** The item is sold. */
const sold = state("sold")().final();

/** A checkout that waits 30 seconds for payment, and a stock service that holds the item meanwhile. */
export const checkoutMachine = machine("checkout", {
  create: () => {
    const stock = Actor({
      inputs: [holdItem, releaseItem, itemSold],
      outputs: [itemHeld],
      states: [free, holding, sold],
      initial: free,
      setup: (m) => {
        /** Holds the item and says so. */
        m.on(free, {
          event: holdItem,
          to: [holding],
          handler: () => ({ state: holding, emit: [itemHeld.create()] }),
        });
        /** The checkout gave up: the item goes back on the shelf. */
        m.on(holding, { event: releaseItem, to: [free], handler: () => ({ state: free }) });
        /** The checkout was paid: the item is gone. */
        m.on(holding, { event: itemSold, to: [sold], handler: () => ({ state: sold }) });
      },
    });
    const checkout = Actor({
      inputs: [checkoutStarted, itemHeld, paymentReceived],
      internal: [waitedTooLong],
      outputs: [holdItem, itemSold, releaseItem],
      states: [browsing, waitingForStock, waitingForPayment, paid, expired],
      initial: browsing,
      setup: (m) => {
        /** The person starts: ask stock to hold the item. */
        m.on(browsing, {
          event: checkoutStarted,
          to: [waitingForStock],
          handler: () => ({ state: waitingForStock, emit: [holdItem.create()] }),
        });
        /** Stock holds the item: the 30 seconds begin. */
        m.on(waitingForStock, {
          event: itemHeld,
          to: [waitingForPayment],
          handler: () => ({ state: waitingForPayment }),
        });
        /** Paid in time: tell stock the item is sold. */
        m.on(waitingForPayment, {
          event: paymentReceived,
          to: [paid],
          handler: () => ({ state: paid, emit: [itemSold.create()] }),
        });
        /** Too slow: tell stock to let the item go. */
        m.on(waitingForPayment, {
          event: waitedTooLong,
          to: [expired],
          handler: () => ({ state: expired, emit: [releaseItem.create()] }),
        });
        /** Gives the person 30 seconds to pay. */
        m.effect(waitingForPayment, {
          name: "paymentDeadline",
          sends: [waitedTooLong],
          fn: (input) => withTimeout(30_000, { input, event: () => waitedTooLong.create() }),
        });
      },
    });
    onOutput(checkout, (out) => {
      if (holdItem.is(out)) stock.send(holdItem.create());
      if (itemSold.is(out)) stock.send(itemSold.create());
      if (releaseItem.is(out)) stock.send(releaseItem.create());
    });
    onOutput(stock, (out) => {
      if (itemHeld.is(out)) checkout.send(itemHeld.create());
    });
    return { actor: checkout, stock };
  },
});
