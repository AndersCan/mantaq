/** A checkout whose wires rename an event, end in an "any state" handler, and leave one same-named event unwired. */
import { Actor, VirtualClock, event, state } from "@mantaq/core";
import type { AnyActor } from "@mantaq/core";
import { onOutput, withTimeout } from "@mantaq/sugar";

/** The shopper is looking at the cart. */
const browsing = state("browsing")();
/** The shopper clicked pay and the payment is running. */
const waitingForPayment = state("waitingForPayment")();
/** The payment went through. */
const paid = state("paid")().final();
/** The payment took too long and the checkout stopped. */
const gaveUp = state("gaveUp")().final();

/** The shopper clicked the pay button. */
const payClicked = event("PAY_CLICKED")();
/** The payment machine confirmed the charge. */
const paymentConfirmed = event("PAYMENT_CONFIRMED")();
/** The payment deadline passed with no confirmation. */
const waitedTooLong = event("WAITED_TOO_LONG")();
/** Checkout announces that payment started. */
const paymentStarted = event("PAYMENT_STARTED")();
/** Checkout announces that it stopped waiting. Nothing sends it on to payment. */
const paymentTimedOut = event("PAYMENT_TIMED_OUT")();
/** Checkout announces that the order is closed. */
const orderClosed = event("ORDER_CLOSED")();

/** Payment is told to start charging. */
const start = event("START")();
/** Payment charged the card. */
const cardCharged = event("CARD_CHARGED")();

/** Payment is idle. */
const ready = state("ready")();
/** Payment is charging the card. */
const charging = state("charging")();

export function createRenamedCheckout({ clock = VirtualClock() }: { clock?: VirtualClock } = {}): {
  actor: AnyActor<unknown>;
  payment: AnyActor<unknown>;
} {
  const payment = Actor({
    inputs: [start, cardCharged, paymentTimedOut, orderClosed],
    outputs: [paymentConfirmed],
    states: [ready, charging],
    initial: ready,
    clock,
    setup: (m) => {
      /** Checkout asked for the charge, so payment starts charging the card. */
      m.on(ready, { event: start, to: [charging], handler: () => ({ state: charging }) });
      /** The card was charged, so payment confirms and is idle again. */
      m.on(charging, {
        event: cardCharged,
        to: [ready],
        handler: () => ({ state: ready, emit: [paymentConfirmed.create()] }),
      });
      /** Payment timed out, so it drops the charge. */
      m.on(charging, { event: paymentTimedOut, to: [ready], handler: () => ({ state: ready }) });
      /** The order closed, so payment stays where it is. */
      m.onAny({ event: orderClosed, handler: () => ({}) });
    },
  });
  const checkout = Actor({
    inputs: [payClicked, paymentConfirmed],
    internal: [waitedTooLong],
    outputs: [paymentStarted, paymentTimedOut, orderClosed],
    states: [browsing, waitingForPayment, paid, gaveUp],
    initial: browsing,
    clock,
    setup: (m) => {
      /** The shopper clicked pay, so checkout waits and announces the start. */
      m.on(browsing, {
        event: payClicked,
        to: [waitingForPayment],
        handler: () => ({ state: waitingForPayment, emit: [paymentStarted.create()] }),
      });
      /** Waiting for payment starts a 30 second deadline. */
      m.effect(waitingForPayment, {
        name: "paymentDeadline",
        sends: [waitedTooLong],
        fn: (input) => withTimeout(30_000, { input, event: () => waitedTooLong.create() }),
      });
      /** Payment confirmed the charge, so the order is paid and closed. */
      m.on(waitingForPayment, {
        event: paymentConfirmed,
        to: [paid],
        handler: () => ({ state: paid, emit: [orderClosed.create()] }),
      });
      /** The deadline passed, so checkout gives up and announces it. */
      m.on(waitingForPayment, {
        event: waitedTooLong,
        to: [gaveUp],
        handler: () => ({ state: gaveUp, emit: [paymentTimedOut.create()] }),
      });
    },
  });
  onOutput(checkout, (out) => {
    if (paymentStarted.is(out)) payment.send(start.create());
    if (orderClosed.is(out)) payment.send(orderClosed.create());
  });
  onOutput(payment, (out) => {
    if (paymentConfirmed.is(out)) checkout.send(paymentConfirmed.create());
  });
  return { actor: checkout, payment };
}
