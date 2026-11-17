/** A checkout that tells a payment machine when payment starts and when the wait ran out. */
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
/** Checkout tells payment to start charging. */
const paymentStarted = event("PAYMENT_STARTED")();
/** Checkout tells payment that it stopped waiting. */
const paymentTimedOut = event("PAYMENT_TIMED_OUT")();
/** Payment charged the card. */
const cardCharged = event("CARD_CHARGED")();

/** Payment is idle. */
const ready = state("ready")();
/** Payment is charging the card. */
const charging = state("charging")();

export function createCheckout({ clock = VirtualClock() }: { clock?: VirtualClock } = {}): {
  actor: AnyActor<unknown>;
  payment: AnyActor<unknown>;
} {
  const payment = Actor({
    inputs: [paymentStarted, cardCharged, paymentTimedOut],
    states: [ready, charging],
    initial: ready,
    clock,
    setup: (m) => {
      m.on(ready, { event: paymentStarted, to: [charging], handler: () => ({ state: charging }) });
      m.on(charging, { event: cardCharged, to: [ready], handler: () => ({ state: ready }) });
      m.on(charging, { event: paymentTimedOut, to: [ready], handler: () => ({ state: ready }) });
    },
  });
  const checkout = Actor({
    inputs: [payClicked, paymentConfirmed],
    internal: [waitedTooLong],
    outputs: [paymentStarted, paymentTimedOut],
    states: [browsing, waitingForPayment, paid, gaveUp],
    initial: browsing,
    clock,
    setup: (m) => {
      m.on(browsing, {
        event: payClicked,
        to: [waitingForPayment],
        handler: () => ({ state: waitingForPayment, emit: [paymentStarted.create()] }),
      });
      m.effect(waitingForPayment, {
        name: "paymentDeadline",
        sends: [waitedTooLong],
        fn: (input) => withTimeout(30_000, { input, event: () => waitedTooLong.create() }),
      });
      m.on(waitingForPayment, {
        event: paymentConfirmed,
        to: [paid],
        handler: () => ({ state: paid }),
      });
      m.on(waitingForPayment, {
        event: waitedTooLong,
        to: [gaveUp],
        handler: () => ({ state: gaveUp, emit: [paymentTimedOut.create()] }),
      });
    },
  });
  onOutput(checkout, (out) => {
    if (out.type === paymentStarted.type) payment.send(paymentStarted.create());
    if (out.type === paymentTimedOut.type) payment.send(paymentTimedOut.create());
  });
  return { actor: checkout, payment };
}
