import { describe, expect, test } from "vite-plus/test";
import { VirtualClock, event } from "@mantaq/core";
import { expectNoDesignErrors } from "@mantaq/inspect";
import { createMeal } from "./meal.ts";
import { createOrder3 } from "./order-03.ts";
import { createOrder4 } from "./order-04.ts";
import { createOrder5 } from "./order-05.ts";
import { createOrder6 } from "./order-06.ts";
import { createOrder7 } from "./order-07.ts";
import { createOrder8 } from "./order-08.ts";
import { createOrder9 } from "./order-09.ts";

const eat = event("eat")();
const addItem = event("addItem")();
const pay = event("pay")<{ email: string }>();
const email = "ana@example.com";
const payloads = { pay: [{ email }, { email: "" }] };
const confirm = event("confirm")();
const retry = event("retry")();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("tutorial machines", () => {
  test("page one: eat moves the person from hungry to full", () => {
    const actor = createMeal();
    actor.send(eat.create());
    expect(actor.state.name).toBe("full");
  });
  test("step 3 opens the card form only with an email", () => {
    const actor = createOrder3();
    actor.send(pay.create({ email: "" }));
    expect(actor.state.name).toBe("cart");
    actor.send(pay.create({ email }));
    expect(actor.state.name).toBe("payment");
  });
  test("step 4 has no design errors", () => {
    expectNoDesignErrors({ id: "order4", create: createOrder4, payloads });
  });
  test("step 5 has no design errors", () => {
    expectNoDesignErrors({ id: "order5", create: createOrder5, payloads });
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
    expectNoDesignErrors({ id: "order6", create: () => createOrder6(VirtualClock()), payloads });
  });
  test("step 7 has no design errors", () => {
    expectNoDesignErrors({ id: "order7", create: () => createOrder7(VirtualClock()), payloads });
  });
  test("step 8 has no design errors", () => {
    expectNoDesignErrors({ id: "order8", create: () => createOrder8(VirtualClock()), payloads });
  });
  test("step 9 has no design errors", () => {
    expectNoDesignErrors({ id: "order9", create: () => createOrder9(VirtualClock()), payloads });
  });
  test("step 9 promo region takes applyPromo whatever the order is doing", () => {
    const actor = createOrder9(VirtualClock());
    const applyPromo = event("applyPromo")();
    expect(actor.state.name).toBe("cart");
    actor.regions.promo.send(applyPromo.create());
    expect(actor.regions.promo.state.name).toBe("promoApplied");
    expect(actor.state.name).toBe("cart");
  });

  type Order = { send(e: { type: string; payload?: unknown }): unknown; state: { name: string } };
  const toPaying = (create: (clock: VirtualClock) => Order, items = 1) => {
    const clock = VirtualClock();
    const actor = create(clock);
    for (let n = 0; n < items; n++) actor.send(addItem.create());
    actor.send(pay.create({ email }));
    actor.send(confirm.create());
    return { clock, actor };
  };

  for (const [step, create] of [
    ["6", createOrder6],
    ["7", createOrder7],
    ["8", createOrder8],
    ["9", createOrder9],
  ] as const) {
    test(`step ${step} refuses pay with an empty cart, then accepts it with an item`, () => {
      const actor = create(VirtualClock());
      actor.send(pay.create({ email }));
      expect(actor.state.name).toBe("cart");
      actor.send(addItem.create());
      actor.send(pay.create({ email }));
      expect(actor.state.name).toBe("payment");
    });
  }

  for (const [step, create] of [
    ["7", createOrder7],
    ["8", createOrder8],
    ["9", createOrder9],
  ] as const) {
    test(`step ${step} reaches paid when the charge succeeds`, async () => {
      const { actor } = toPaying(create);
      expect(actor.state.name).toBe("paying");
      await flush();
      expect(actor.state.name).toBe("paid");
    });
    test(`step ${step} reaches failed when the charge is declined, and retry returns to payment`, async () => {
      const { actor } = toPaying(create, 100);
      await flush();
      expect(actor.state.name).toBe("failed");
      actor.send(retry.create());
      expect(actor.state.name).toBe("payment");
    });
  }

  for (const [step, create] of [
    ["8", createOrder8],
    ["9", createOrder9],
  ] as const) {
    test(`step ${step} fails the payment at 10 seconds, and retry returns to payment`, () => {
      const { clock, actor } = toPaying(create);
      clock.advance(9_999);
      expect(actor.state.name).toBe("paying");
      clock.advance(1);
      expect(actor.state.name).toBe("failed");
      actor.send(retry.create());
      expect(actor.state.name).toBe("payment");
    });
    test(`step ${step} cancels the timer when paying is left`, async () => {
      const { clock, actor } = toPaying(create, 100);
      await flush();
      expect(actor.state.name).toBe("failed");
      actor.send(retry.create());
      clock.advance(5_000);
      actor.send(confirm.create());
      clock.advance(5_000);
      expect(actor.state.name).toBe("paying");
      clock.advance(5_000);
      expect(actor.state.name).toBe("failed");
    });
  }
});
