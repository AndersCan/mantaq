import { Actor, state } from "@mantaq/core";

/** The visitor is filling the cart. */
const cart = state("cart")();

export function createOrder1() {
  return Actor({
    inputs: [],
    states: [cart],
    initial: cart,
    setup: () => {},
  });
}
