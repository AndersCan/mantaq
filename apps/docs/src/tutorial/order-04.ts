import { Actor, event, state } from "@mantaq/core";

/** The visitor is filling the cart. */
const cart = state("cart")();
/** The visitor enters their card details. */
const payment = state("payment")();
/** The order went through. */
const paid = state("paid")().final();

/** The visitor is ready to pay. */
const pay = event("pay")();
/** The visitor sent their card details. */
const confirm = event("confirm")();

export function createOrder4() {
  return Actor({
    inputs: [pay, confirm],
    states: [cart, payment, paid],
    initial: cart,
    setup: (m) => {
      /** The cart is done, so the card form opens. */
      m.on(cart, { event: pay, to: [payment], handler: () => ({ state: payment }) });
      /** The card details are in, so the order is done. */
      m.on(payment, { event: confirm, to: [paid], handler: () => ({ state: paid }) });
    },
  });
}
