/**
 * An order with twelve states: `@group payment` and `@group delivery` tag the
 * states of each step, so the viewer draws each step as one node to enter. The
 * card provider and the courier answer with input events, so the live page can
 * click every arrow.
 */
import { Actor, event, machine, state } from "@mantaq/core";

/** The shop checks the order before it takes payment. */
const reviewingOrder = state("reviewingOrder")();
/** The card provider charges the card. @group payment */
const chargingCard = state("chargingCard")();
/** The bank asks the buyer to confirm the payment. @group payment */
const confirmingWithBank = state("confirmingWithBank")();
/** The card provider declined the card. @group payment */
const cardDeclined = state("cardDeclined")();
/** The shop packs the parcel. @group delivery */
const packingParcel = state("packingParcel")();
/** The courier has the parcel. @group delivery */
const onTheWay = state("onTheWay")();
/** The courier rings the bell. @group delivery */
const atTheDoor = state("atTheDoor")();
/** Nobody opened the door. @group delivery */
const missedDelivery = state("missedDelivery")();
/** The buyer has the parcel. */
const delivered = state("delivered")().final();
/** The parcel is back at the shop. */
const returnedToShop = state("returnedToShop")();
/** The shop paid the money back. */
const refunded = state("refunded")().final();
/** The order stopped before the shop took any money. */
const cancelled = state("cancelled")().final();

/** The shop accepts the order. */
const placeOrder = event("placeOrder")();
/** The order stops. */
const cancelOrder = event("cancelOrder")();
/** The card provider took the money. */
const charged = event("charged")();
/** The bank wants the buyer to confirm. */
const bankAskedToConfirm = event("bankAskedToConfirm")();
/** The buyer confirmed the payment with the bank. */
const confirmed = event("confirmed")();
/** The card provider refused the card. */
const declined = event("declined")();
/** The buyer tries the card again. */
const retryCard = event("retryCard")();
/** The courier takes the parcel. */
const shipped = event("shipped")();
/** The courier is at the address. */
const arrived = event("arrived")();
/** The buyer takes the parcel. */
const handedOver = event("handedOver")();
/** Nobody comes to the door. */
const nobodyAnswered = event("nobodyAnswered")();
/** The courier takes the parcel out again. */
const rescheduled = event("rescheduled")();
/** The courier takes the parcel back to the shop. */
const sentBack = event("sentBack")();
/** The shop pays the money back. */
const refundBuyer = event("refundBuyer")();

/** What the shop, the card provider, the bank, the buyer and the courier send. */
const inputs = [
  placeOrder,
  cancelOrder,
  charged,
  bankAskedToConfirm,
  confirmed,
  declined,
  retryCard,
  shipped,
  arrived,
  handedOver,
  nobodyAnswered,
  rescheduled,
  sentBack,
  refundBuyer,
];

const states = [
  reviewingOrder,
  chargingCard,
  confirmingWithBank,
  cardDeclined,
  packingParcel,
  onTheWay,
  atTheDoor,
  missedDelivery,
  delivered,
  returnedToShop,
  refunded,
  cancelled,
];

export const orderMachine = machine("order", {
  create: () => {
    return Actor({
      inputs,
      states,
      initial: reviewingOrder,
      setup: (m) => {
        /** A placed order goes to payment. */
        m.on(reviewingOrder, {
          event: placeOrder,
          to: [chargingCard],
          handler: () => ({ state: chargingCard }),
        });
        /** The shop can stop the order before payment. */
        m.on(reviewingOrder, {
          event: cancelOrder,
          to: [cancelled],
          handler: () => ({ state: cancelled }),
        });
        /** A charged card starts the delivery. */
        m.on(chargingCard, {
          event: charged,
          to: [packingParcel],
          handler: () => ({ state: packingParcel }),
        });
        /** Some banks ask the buyer first. */
        m.on(chargingCard, {
          event: bankAskedToConfirm,
          to: [confirmingWithBank],
          handler: () => ({ state: confirmingWithBank }),
        });
        /** A refused card waits for the buyer. */
        m.on(chargingCard, {
          event: declined,
          to: [cardDeclined],
          handler: () => ({ state: cardDeclined }),
        });
        /** A confirmed payment starts the delivery. */
        m.on(confirmingWithBank, {
          event: confirmed,
          to: [packingParcel],
          handler: () => ({ state: packingParcel }),
        });
        /** The bank can still refuse. */
        m.on(confirmingWithBank, {
          event: declined,
          to: [cardDeclined],
          handler: () => ({ state: cardDeclined }),
        });
        /** The buyer tries the card again. */
        m.on(cardDeclined, {
          event: retryCard,
          to: [chargingCard],
          handler: () => ({ state: chargingCard }),
        });
        /** The buyer gives up. */
        m.on(cardDeclined, {
          event: cancelOrder,
          to: [cancelled],
          handler: () => ({ state: cancelled }),
        });
        /** The courier takes the packed parcel. */
        m.on(packingParcel, {
          event: shipped,
          to: [onTheWay],
          handler: () => ({ state: onTheWay }),
        });
        /** The courier reaches the address. */
        m.on(onTheWay, { event: arrived, to: [atTheDoor], handler: () => ({ state: atTheDoor }) });
        /** The buyer opens the door. */
        m.on(atTheDoor, {
          event: handedOver,
          to: [delivered],
          handler: () => ({ state: delivered }),
        });
        /** Nobody opens the door. */
        m.on(atTheDoor, {
          event: nobodyAnswered,
          to: [missedDelivery],
          handler: () => ({ state: missedDelivery }),
        });
        /** The courier tries again on another day. */
        m.on(missedDelivery, {
          event: rescheduled,
          to: [onTheWay],
          handler: () => ({ state: onTheWay }),
        });
        /** The courier gives up. */
        m.on(missedDelivery, {
          event: sentBack,
          to: [returnedToShop],
          handler: () => ({ state: returnedToShop }),
        });
        /** The shop pays back a parcel that came back. */
        m.on(returnedToShop, {
          event: refundBuyer,
          to: [refunded],
          handler: () => ({ state: refunded }),
        });
      },
    });
  },
});
