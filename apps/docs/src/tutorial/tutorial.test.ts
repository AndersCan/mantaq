import { describe, expect, test } from "vite-plus/test";
import { event } from "@mantaq/core";
import { expectNoDesignErrors } from "@mantaq/inspect";
import { createOrder4 } from "./order-04.ts";
import { createOrder5 } from "./order-05.ts";

describe("tutorial machines", () => {
  test("step 4 has no design errors", () => {
    expectNoDesignErrors({ id: "order4", create: createOrder4 });
  });
  test("step 5 has no design errors", () => {
    expectNoDesignErrors({ id: "order5", create: createOrder5 });
  });
  test("step 5 counts items and stays in cart", () => {
    const actor = createOrder5();
    const addItem = event("addItem")();
    for (let n = 0; n < 3; n++) {
      actor.send(addItem.create());
    }
    expect(actor.context.items).toBe(3);
    expect(actor.state.name).toBe("cart");
  });
});
