import { Actor, event, state } from "@mantaq/core";

/** The visitor is filling the cart. */
const cart = state("cart")();
/** The visitor enters their card details. */
const payment = state("payment")();
/** The order went through. */
const paid = state("paid")().final();

/** The visitor is ready to pay, and gives an email for the receipt. */
const pay = event("pay")<{
  /**
   * Where the receipt goes.
   * @example ana@example.com
   */
  email: string;
}>();
/** The visitor sent their card details. */
const confirm = event("confirm")();

export function createOrder4() {
  return Actor({
    inputs: [pay, confirm],
    states: [cart, payment, paid],
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
      /** The card details are in, so the order is done. */
      m.on(payment, { event: confirm, to: [paid], handler: () => ({ state: paid }) });
    },
  });
}
