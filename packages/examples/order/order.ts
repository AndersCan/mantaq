/** An order that was one big machine, split into a parent that embeds `payment` while it pays and `delivery` while it ships. */
import { Actor, event, machine, state } from "@mantaq/core";
import type { Clock, Snapshot } from "@mantaq/core";
import { delivery, signForParcel } from "./delivery.ts";
import { paymentMachine, retryPayment } from "./payment.ts";
import { Either } from "@mantaq/utils";
import { embed } from "@mantaq/sugar";
import type { PaymentPort } from "./payment.ts";

/** The shopper checks the basket before paying. */
const reviewingOrder = state("reviewingOrder")();
/** The payment machine runs. */
const payingForOrder = state("payingForOrder")();
/** The delivery machine runs. */
const shippingOrder = state("shippingOrder")();
/** The shopper has the parcel. */
const orderDelivered = state("orderDelivered")().final();
/** The parcel went back to the warehouse. */
const orderReturned = state("orderReturned")().final();
/** The shopper cancelled before the money was taken. */
const orderCancelled = state("orderCancelled")().final();
/** Payment or delivery broke; the shopper sees an apology and a support link. */
const couldNotCompleteOrder = state("couldNotCompleteOrder")().final();

/** The shopper places the order. */
export const placeOrder = event("placeOrder")();
/** The shopper cancels the order. */
export const cancelOrder = event("cancelOrder")();
/** The payment machine ended in `paymentTaken`. */
const paymentWentThrough = event("paymentWentThrough")();
/** The payment machine broke. */
const paymentBroke = event("paymentBroke")();
/** The payment machine changed; the payload is its snapshot. */
const paymentChanged = event("paymentChanged")<Snapshot>();
/** The delivery machine ended in `parcelHandedOver`. */
const parcelDelivered = event("parcelDelivered")();
/** The delivery machine ended in `parcelTakenBack`. */
const parcelReturned = event("parcelReturned")();
/** The delivery machine broke. */
const deliveryBroke = event("deliveryBroke")();

interface OrderContext {
  /** The last snapshot of the payment machine, so the screen knows when to show the retry button. */
  payment: Snapshot | undefined;
}

interface OrderOptions {
  clock: Clock;
  port?: PaymentPort;
}

const noPaymentYet: OrderContext = { payment: undefined };

const acceptEveryCard: PaymentPort = {
  chargeCard: () => Promise.resolve(Either.right({ receiptId: "receipt-1" })),
};

/** The order machine. `port` charges the card; it accepts every card unless a test gives another one. */
export const order = machine("order", {
  create: (options: OrderOptions) => {
    const { clock, port = acceptEveryCard } = options;
    return Actor({
      inputs: [placeOrder, cancelOrder, retryPayment, signForParcel],
      internal: [
        paymentWentThrough,
        paymentBroke,
        paymentChanged,
        parcelDelivered,
        parcelReturned,
        deliveryBroke,
      ],
      states: [
        reviewingOrder,
        payingForOrder,
        shippingOrder,
        orderDelivered,
        orderReturned,
        orderCancelled,
        couldNotCompleteOrder,
      ],
      initial: reviewingOrder,
      context: noPaymentYet,
      clock,
      setup: (builder) => {
        builder.on(reviewingOrder, {
          event: placeOrder,
          to: [payingForOrder],
          handler: () => ({ state: payingForOrder }),
        });
        embed(builder, {
          in: payingForOrder,
          machine: paymentMachine({ port }),
          done: { paymentTaken: paymentWentThrough },
          error: paymentBroke,
          forward: [retryPayment],
          snapshot: paymentChanged,
        });
        builder.on(payingForOrder, {
          event: paymentChanged,
          handler: (changed, { context }) => context.set({ payment: changed.payload }),
        });
        builder.on(payingForOrder, {
          event: paymentWentThrough,
          to: [shippingOrder],
          handler: () => ({ state: shippingOrder }),
        });
        builder.on(payingForOrder, {
          event: paymentBroke,
          to: [couldNotCompleteOrder],
          handler: () => ({ state: couldNotCompleteOrder }),
        });
        for (const cancellable of [reviewingOrder, payingForOrder]) {
          builder.on(cancellable, {
            event: cancelOrder,
            to: [orderCancelled],
            handler: () => ({ state: orderCancelled }),
          });
        }
        embed(builder, {
          in: shippingOrder,
          machine: delivery,
          done: { parcelHandedOver: parcelDelivered, parcelTakenBack: parcelReturned },
          error: deliveryBroke,
          forward: [signForParcel],
        });
        builder.on(shippingOrder, {
          event: parcelDelivered,
          to: [orderDelivered],
          handler: () => ({ state: orderDelivered }),
        });
        builder.on(shippingOrder, {
          event: parcelReturned,
          to: [orderReturned],
          handler: () => ({ state: orderReturned }),
        });
        builder.on(shippingOrder, {
          event: deliveryBroke,
          to: [couldNotCompleteOrder],
          handler: () => ({ state: couldNotCompleteOrder }),
        });
      },
    });
  },
});
