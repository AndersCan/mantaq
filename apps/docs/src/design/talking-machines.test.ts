import { VirtualClock } from "@mantaq/core";
import { expectNoDesignErrors } from "@mantaq/inspect";
import { createDriver } from "@mantaq/inspect/drive";
import { expect, test } from "vite-plus/test";
import { checkoutMachine } from "./talking-machines.ts";

test("checkout and stock have no design errors", () => {
  expectNoDesignErrors({
    machine: checkoutMachine,
    payloads: {},
  });
});

test("one click on CHECKOUT_STARTED goes into stock and back", () => {
  const driver = createDriver({
    id: "checkout",
    create: () => {
      const clock = VirtualClock();
      const made = checkoutMachine.create();
      return { actor: made.actor, clock, made };
    },
  });
  const step = driver.step({ kind: "event", event: "CHECKOUT_STARTED", payload: {} });
  expect(step.last).toMatchObject({ from: "browsing", to: "waitingForStock" });
  expect(step.after).toMatchObject([
    {
      actor: { region: "stock" },
      event: "HOLD_ITEM",
      from: "stock.free",
      to: "stock.holding",
      message: { sender: "", dropped: null },
    },
    {
      event: "ITEM_HELD",
      from: "waitingForStock",
      to: "waitingForPayment",
      message: { sender: "stock", dropped: null },
    },
  ]);
  expect(step.state).toBe("waitingForPayment");
  expect(step.regions).toEqual({ stock: "stock.holding" });
});
