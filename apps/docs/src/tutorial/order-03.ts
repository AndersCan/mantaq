import { Actor, event, state } from "@mantaq/core";

/** The visitor is filling the cart. */
const cart = state("cart")();
/** The visitor enters their card details. */
const payment = state("payment")();

/** The visitor is ready to pay. */
const pay = event("pay")();

export function createOrder3() {
  return Actor({
    inputs: [pay],
    states: [cart, payment],
    initial: cart,
    setup: (m) => {
      /** The cart is done, so the card form opens. */
      m.on(cart, { event: pay, to: [payment], handler: () => ({ state: payment }) });
    },
  });
}
