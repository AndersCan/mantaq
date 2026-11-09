import { describe, expect, test } from "vite-plus/test";
import { VirtualClock, event } from "@mantaq/core";
import { expectNoDesignErrors } from "@mantaq/inspect";
import { createOrder4 } from "./order-04.ts";
import { createOrder5 } from "./order-05.ts";
import { createOrder6 } from "./order-06.ts";
import { createOrder7 } from "./order-07.ts";
import { createOrder8 } from "./order-08.ts";
import { createOrder9 } from "./order-09.ts";

const addItem = event("addItem")();
const pay = event("pay")();
const confirm = event("confirm")();
const retry = event("retry")();

describe("tutorial machines", () => {
  test("step 4 has no design errors", () => {
    expectNoDesignErrors({ id: "order4", create: createOrder4 });
  });
  test("step 5 has no design errors", () => {
    expectNoDesignErrors({ id: "order5", create: createOrder5 });
  });
  test("step 5 counts items and stays in cart", () => {
    const actor = createOrder5();
    for (let n = 0; n < 3; n++) {
      actor.send(addItem.create());
    }
    expect(actor.context.items).toBe(3);
    expect(actor.state.name).toBe("cart");
  });
  test("step 6 has no design errors", () => {
    expectNoDesignErrors({ id: "order6", create: createOrder6 });
  });
  test("step 6 refuses pay with an empty cart, then accepts it with an item", () => {
    const actor = createOrder6();
    actor.send(pay.create());
    expect(actor.state.name).toBe("cart");
    actor.send(addItem.create());
    actor.send(pay.create());
    expect(actor.state.name).toBe("payment");
  });
  test("step 7 has no design errors", () => {
    expectNoDesignErrors({ id: "order7", create: createOrder7 });
  });
  test("step 7 reaches paid when the charge succeeds", async () => {
    const actor = createOrder7();
    actor.send(addItem.create());
    actor.send(pay.create());
    actor.send(confirm.create());
    expect(actor.state.name).toBe("paying");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(actor.state.name).toBe("paid");
  });
  test("step 8 has no design errors", () => {
    expectNoDesignErrors({ id: "order8", create: () => createOrder8(VirtualClock()) });
  });
  test("step 8 fails the payment after 10 seconds, and retry returns to payment", () => {
    const clock = VirtualClock();
    const actor = createOrder8(clock);
    actor.send(addItem.create());
    actor.send(pay.create());
    actor.send(confirm.create());
    expect(actor.state.name).toBe("paying");
    clock.advance(9_999);
    expect(actor.state.name).toBe("paying");
    clock.advance(1);
    expect(actor.state.name).toBe("failed");
    actor.send(retry.create());
    expect(actor.state.name).toBe("payment");
  });
  test("step 9 has no design errors", () => {
    expectNoDesignErrors({ id: "order9", create: () => createOrder9(VirtualClock()) });
  });
  test("step 9 promo region takes applyPromo whatever the order is doing", () => {
    const actor = createOrder9(VirtualClock());
    const applyPromo = event("applyPromo")();
    expect(actor.state.name).toBe("cart");
    actor.regions.promo.send(applyPromo.create());
    expect(actor.regions.promo.state.name).toBe("promoApplied");
    expect(actor.state.name).toBe("cart");
  });
});
