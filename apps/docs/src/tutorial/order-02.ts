import { Actor, state } from "@mantaq/core";

/** The visitor is filling the cart. */
const cart = state("cart")();
/** The visitor enters their card details. */
const payment = state("payment")();

export function createOrder2() {
  return Actor({
    inputs: [],
    states: [cart, payment],
    initial: cart,
    setup: () => {},
  });
}
