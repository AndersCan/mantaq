import { Actor, event, state } from "@mantaq/core";
import type { Clock } from "@mantaq/core";

type OrderContext = { items: number };

/** The visitor is filling the cart. */
const cart = state("cart")();
/** The visitor enters their card details. */
const payment = state("payment")();
/** The card is being charged; the visitor waits. */
const paying = state("paying")();
/** The order went through. */
const paid = state("paid")().final();
/** The payment did not go through. */
const failed = state("failed")();

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
/** The visitor tries the payment again. */
const retry = event("retry")();
/** The card was charged. */
const paymentOk = event("paymentOk")();
/** The card was declined. */
const paymentFail = event("paymentFail")();
/** The charge took too long. */
const paymentTimeout = event("paymentTimeout")();

/** No promo code is applied yet. */
const noPromo = state("noPromo")();
/** A promo code is applied. */
const promoApplied = state("promoApplied")().final();

/** The visitor entered a promo code. */
const applyPromo = event("applyPromo")();

/** Stands in for your payment provider. It declines 100 items or more. */
async function chargeCard(items: number): Promise<boolean> {
  return items > 0 && items < 100;
}

export function createOrder9(clock: Clock) {
  /** Tracks the promo code on its own, beside the order. */
  const promo = Actor({
    inputs: [applyPromo],
    states: [noPromo, promoApplied],
    initial: noPromo,
    clock,
    setup: (m) => {
      /** The code is accepted. */
      m.on(noPromo, {
        event: applyPromo,
        to: [promoApplied],
        handler: () => ({ state: promoApplied }),
      });
    },
  });
  const initialContext: OrderContext = { items: 0 };
  return Actor({
    inputs: [addItem, pay, confirm, retry],
    internal: [paymentOk, paymentFail, paymentTimeout],
    states: [cart, payment, paying, paid, failed],
    initial: cart,
    clock,
    regions: { promo },
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
      /** The card details are in, so the charge starts. */
      m.on(payment, { event: confirm, to: [paying], handler: () => ({ state: paying }) });
      /** Charges the card while the visitor waits, and reports the result. */
      m.effect(paying, {
        name: "chargeCard",
        sends: [paymentOk, paymentFail],
        fn: ({ context, signal, emit }) => {
          chargeCard(context.get().items)
            .catch(() => false)
            .then((ok) => {
              if (signal.aborted) return;
              emit(ok ? paymentOk.create() : paymentFail.create());
            });
        },
      });
      /** Gives the charge 10 seconds. */
      m.effect(paying, {
        name: "chargeTimer",
        sends: [paymentTimeout],
        fn: ({ clock, signal, emit }) => {
          clock.setTimeout(10_000, { signal, cb: () => emit(paymentTimeout.create()) });
        },
      });
      /** The charge worked, so the order is done. */
      m.on(paying, { event: paymentOk, to: [paid], handler: () => ({ state: paid }) });
      /** The charge failed, so the visitor sees why. */
      m.on(paying, { event: paymentFail, to: [failed], handler: () => ({ state: failed }) });
      /** Too slow counts as a failed payment. */
      m.on(paying, { event: paymentTimeout, to: [failed], handler: () => ({ state: failed }) });
      /** The visitor goes back to the card form. */
      m.on(failed, { event: retry, to: [payment], handler: () => ({ state: payment }) });
    },
  });
}
