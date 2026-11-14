import { VirtualClock } from "@mantaq/core";
import { expectNoDesignErrors, inspectModule } from "@mantaq/inspect";
import { createDriver } from "@mantaq/inspect/drive";
import { expect, test } from "vite-plus/test";
import { createKitchenAndWaiter } from "./dropped-message.ts";

const file = new URL("./dropped-message.ts", import.meta.url).pathname;

test("the kitchen and waiter board draws the waiter as a part", async () => {
  const result = await inspectModule(file, { load: (path) => import(path) });
  expect(result.machines[0]?.actors).toEqual(["waiter"]);
});

test("the kitchen and waiter fixture has no design errors", () => {
  expectNoDesignErrors({
    id: "kitchenAndWaiter",
    create: () => createKitchenAndWaiter({ clock: VirtualClock() }),
    payloads: {},
  });
});

test("cooking a dish while the waiter is on a break drops exactly one DISH_READY", () => {
  const driver = createDriver({
    id: "kitchenAndWaiter",
    create: () => {
      const clock = VirtualClock();
      const made = createKitchenAndWaiter({ clock });
      return { actor: made.actor, clock, made };
    },
  });
  const step = (event: string, actor?: { region: string }) =>
    driver.step({ kind: "event", event, payload: {}, ...(actor === undefined ? {} : { actor }) });
  const taken = step("DISH_COOKED");
  expect(taken.after[0]?.message).toEqual({ sender: "", dropped: null });
  step("DISH_SERVED", { region: "waiter" });
  step("BREAK_STARTED", { region: "waiter" });
  const live = step("DISH_COOKED");
  const dropped = live.after.filter((entry) => entry.message?.dropped === "noHandler");
  expect(dropped).toHaveLength(1);
  expect(dropped[0]).toMatchObject({
    actor: { region: "waiter" },
    event: "DISH_READY",
    message: { dropped: "noHandler" },
  });
});
