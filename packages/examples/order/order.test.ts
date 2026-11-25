import { describe, expect, it } from "vite-plus/test";
import { orderMachine } from "./order.ts";

type OrderEvent = Parameters<ReturnType<typeof orderMachine.create>["send"]>[0]["type"];

/** The state the order is in after each event, sent in turn to a fresh order. */
function statesAfter(events: ReadonlyArray<OrderEvent>): ReadonlyArray<string> {
  const actor = orderMachine.create({});
  const states: Array<string> = [actor.state.name];
  for (const type of events) {
    actor.send({ type });
    states.push(actor.state.name);
  }
  return states;
}

describe("order", () => {
  it("walks into payment, retries a declined card, confirms with the bank and is delivered after a missed delivery", () => {
    const events: Array<OrderEvent> = [
      "placeOrder",
      "declined",
      "retryCard",
      "bankAskedToConfirm",
      "confirmed",
      "shipped",
      "arrived",
      "nobodyAnswered",
      "rescheduled",
      "arrived",
      "handedOver",
    ];
    expect(statesAfter(events)).toStrictEqual([
      "reviewingOrder",
      "chargingCard",
      "cardDeclined",
      "chargingCard",
      "confirmingWithBank",
      "packingParcel",
      "onTheWay",
      "atTheDoor",
      "missedDelivery",
      "onTheWay",
      "atTheDoor",
      "delivered",
    ]);
  });

  it("is cancelled before payment, or after the buyer gives up on a card that the provider or the bank declined", () => {
    const walks = {
      beforePayment: statesAfter(["cancelOrder"]),
      afterDecline: statesAfter(["placeOrder", "declined", "cancelOrder"]),
      afterBankDecline: statesAfter([
        "placeOrder",
        "bankAskedToConfirm",
        "declined",
        "cancelOrder",
      ]),
    };
    expect(walks).toStrictEqual({
      beforePayment: ["reviewingOrder", "cancelled"],
      afterDecline: ["reviewingOrder", "chargingCard", "cardDeclined", "cancelled"],
      afterBankDecline: [
        "reviewingOrder",
        "chargingCard",
        "confirmingWithBank",
        "cardDeclined",
        "cancelled",
      ],
    });
  });

  it("is refunded when the courier sends the parcel back", () => {
    const events: Array<OrderEvent> = [
      "placeOrder",
      "charged",
      "shipped",
      "arrived",
      "nobodyAnswered",
      "sentBack",
      "refundBuyer",
    ];
    expect(statesAfter(events)).toStrictEqual([
      "reviewingOrder",
      "chargingCard",
      "packingParcel",
      "onTheWay",
      "atTheDoor",
      "missedDelivery",
      "returnedToShop",
      "refunded",
    ]);
  });
});
