import { Actor, event, state } from "@mantaq/core";

/** The visitor is filling the cart. */
const cart = state("cart")();
/** The visitor enters their card details. */
const payment = state("payment")();

/** The visitor is ready to pay, and gives an email for the receipt. */
const pay = event("pay")<{
  /**
   * Where the receipt goes.
   * @example ana@example.com
   */
  email: string;
}>();

export function createOrder3() {
  return Actor({
    inputs: [pay],
    states: [cart, payment],
    initial: cart,
    setup: (m) => {
      /** The card form opens once the visitor gave an email. */
      m.on(cart, {
        event: pay,
        to: [payment],
        handler: (event) => {
          if (event.payload.email === "") return {};
          return { state: payment };
        },
      });
    },
  });
}
