import { cancelOrder, order, placeOrder } from "./order.ts";
import { describe, expect, test } from "vite-plus/test";
import { Either } from "@mantaq/utils";
import type { PaymentPort } from "./payment.ts";
import { retryPayment } from "./payment.ts";
import { signForParcel } from "./delivery.ts";
import { VirtualClock } from "@mantaq/core";

type Answer = "accepted" | "declined" | "never";

/** A card provider that gives `answers` in turn, one per charge. */
function cardProvider(answers: ReadonlyArray<Answer>): PaymentPort {
  const queue = [...answers];
  return {
    chargeCard: () => {
      const answer = queue.shift() ?? "accepted";
      switch (answer) {
        case "accepted":
          return Promise.resolve(Either.right({ receiptId: "receipt-7" }));
        case "declined":
          return Promise.resolve(Either.left({ reason: "insufficient funds" }));
        case "never":
          return new Promise(() => undefined);
        default:
          return answer satisfies never;
      }
    },
  };
}

function startOrder(answers: ReadonlyArray<Answer>) {
  const clock = VirtualClock();
  const actor = order.create({ clock, port: cardProvider(answers) });
  return { actor, clock };
}

/** Where the parent is, and where the payment machine was when the parent last heard from it. */
function screen(actor: ReturnType<typeof startOrder>["actor"]) {
  const { path, context } = actor.snapshot();
  return { order: path, payment: context.payment?.path };
}

describe("an order split into payment and delivery", () => {
  test("an accepted card ships the order, and a signature at the door delivers it", async () => {
    const { actor, clock } = startOrder(["accepted"]);
    actor.send(placeOrder.create());
    await actor.settled();
    const paid = screen(actor);
    clock.advance(3000);
    actor.send(signForParcel.create());
    expect({ paid, end: screen(actor) }).toStrictEqual({
      paid: { order: ["shippingOrder"], payment: ["paymentTaken"] },
      end: { order: ["orderDelivered"], payment: ["paymentTaken"] },
    });
  });

  test("a declined card shows retry through the payment snapshot, and retry goes to the child", async () => {
    const { actor } = startOrder(["declined", "accepted"]);
    actor.send(placeOrder.create());
    await actor.settled();
    const declined = screen(actor);
    actor.send(retryPayment.create());
    await actor.settled();
    expect({ declined, retried: screen(actor) }).toStrictEqual({
      declined: { order: ["payingForOrder"], payment: ["couldNotChargeCard"] },
      retried: { order: ["shippingOrder"], payment: ["paymentTaken"] },
    });
  });

  test("nobody signs at the door, so the parcel goes back", async () => {
    const { actor, clock } = startOrder(["accepted"]);
    actor.send(placeOrder.create());
    await actor.settled();
    clock.advance(3600);
    expect(screen(actor)).toStrictEqual({ order: ["orderReturned"], payment: ["paymentTaken"] });
  });

  test("cancel while the card is charging ends the order, and the context keeps the last payment snapshot", () => {
    const { actor } = startOrder(["never"]);
    actor.send(placeOrder.create());
    const charging = screen(actor);
    actor.send(cancelOrder.create());
    expect({ charging, cancelled: screen(actor) }).toStrictEqual({
      charging: { order: ["payingForOrder"], payment: ["chargingCard"] },
      cancelled: { order: ["orderCancelled"], payment: ["chargingCard"] },
    });
  });
});
