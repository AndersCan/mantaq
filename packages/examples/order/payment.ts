/**
 * Payment charges the card and lets the shopper try again after a decline. The parent `order` embeds it in `payingForOrder`, and builds it with its port because `embed` passes the child only the clock of the parent.
 */
import { Actor, event, machine, state } from "@mantaq/core";
import { Either } from "@mantaq/utils";
import { withPromise } from "@mantaq/sugar";

/** What the card provider answers. */
export interface PaymentPort {
  chargeCard(): Promise<Either<{ reason: string }, { receiptId: string }>>;
}

interface PaymentOptions {
  port: PaymentPort;
}

/** The card is being charged; the shopper waits. */
const chargingCard = state("chargingCard")();
/** The card was declined; the shopper sees a retry button. */
const couldNotChargeCard = state("couldNotChargeCard")();
/** The money is taken. */
const paymentTaken = state("paymentTaken")().final();

/** The provider took the money. */
const cardAccepted = event("cardAccepted")();
/** The provider declined the card, or could not be reached. */
const cardDeclined = event("cardDeclined")();
/** The shopper asks to charge the card again. */
export const retryPayment = event("retryPayment")();

type CardAnswer = ReturnType<typeof cardAccepted.create> | ReturnType<typeof cardDeclined.create>;

/** The payment machine, charging the card through `port`. */
export function paymentMachine(options: PaymentOptions) {
  const { port } = options;
  return machine("payment", {
    create: () =>
      Actor({
        inputs: [retryPayment],
        internal: [cardAccepted, cardDeclined],
        states: [chargingCard, couldNotChargeCard, paymentTaken],
        initial: chargingCard,
        setup: (builder) => {
          builder.effect(chargingCard, {
            name: "chargeCard",
            sends: [cardAccepted, cardDeclined],
            fn: (input) =>
              withPromise({
                promise: port.chargeCard(),
                signal: input.signal,
                emit: input.emit,
                events: {
                  success: (answer) =>
                    Either.match<typeof answer, CardAnswer>(answer, {
                      onLeft: () => cardDeclined.create(),
                      onRight: () => cardAccepted.create(),
                    }),
                  error: () => cardDeclined.create(),
                },
              }),
          });
          builder.on(chargingCard, {
            event: cardAccepted,
            to: [paymentTaken],
            handler: () => ({ state: paymentTaken }),
          });
          builder.on(chargingCard, {
            event: cardDeclined,
            to: [couldNotChargeCard],
            handler: () => ({ state: couldNotChargeCard }),
          });
          builder.on(couldNotChargeCard, {
            event: retryPayment,
            to: [chargingCard],
            handler: () => ({ state: chargingCard }),
          });
        },
      }),
  });
}
