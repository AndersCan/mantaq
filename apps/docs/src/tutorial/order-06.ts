import { Actor, event, state } from "@mantaq/core";
import type { Clock } from "@mantaq/core";

type OrderContext = { items: number };

/** The visitor is filling the cart. */
const cart = state("cart")();
/** The visitor enters their card details. */
const payment = state("payment")();
/** The order went through. */
const paid = state("paid")().final();

/** The visitor put one more item in the cart. */
const addItem = event("addItem")();
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

export function createOrder6(clock: Clock) {
  const initialContext: OrderContext = { items: 0 };
  return Actor({
    inputs: [addItem, pay, confirm],
    states: [cart, payment, paid],
    initial: cart,
    clock,
    context: initialContext,
    setup: (m) => {
      /** One more item is counted, and the cart stays open. */
      m.on(cart, {
        event: addItem,
        to: [],
        handler: (_event, { context }) => {
          context.set({ items: context.get().items + 1 });
          return {};
        },
      });
      /** The card form opens once the visitor gave an email and the cart has items. */
      m.on(cart, {
        event: pay,
        to: [payment],
        handler: (event, { context }) => {
          if (event.payload.email === "") return {};
          if (context.get().items === 0) return {};
          return { state: payment };
        },
      });
      /** The card details are in, so the order is done. */
      m.on(payment, { event: confirm, to: [paid], handler: () => ({ state: paid }) });
    },
  });
}
