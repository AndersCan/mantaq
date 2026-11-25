import { describe, expect, test } from "vite-plus/test";
import { order, placeOrder } from "./order.ts";
import type { PaymentPort } from "./payment.ts";
import { VirtualClock } from "@mantaq/core";

/** A card provider with a bug: it throws instead of answering. */
const brokenProvider: PaymentPort = {
  chargeCard: () => {
    throw new Error("card provider bug");
  },
};

describe("an order whose child machine breaks", () => {
  test("a payment machine that enters __error sends paymentBroke, so the order cannot complete", () => {
    const actor = order.create({ clock: VirtualClock(), port: brokenProvider });
    actor.send(placeOrder.create());
    const { path, context } = actor.snapshot();
    expect({ order: path, payment: context.payment?.path }).toStrictEqual({
      order: ["couldNotCompleteOrder"],
      payment: ["__error"],
    });
  });
});
