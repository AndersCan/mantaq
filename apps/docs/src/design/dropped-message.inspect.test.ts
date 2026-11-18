import { VirtualClock } from "@mantaq/core";
import { expectNoDesignErrors, inspectModule } from "@mantaq/inspect";
import { createDriver } from "@mantaq/inspect/drive";
import { recordRuns } from "@mantaq/inspect/record";
import { expect, test } from "vite-plus/test";
import { cookMachine } from "./dropped-message.ts";

const recorded = recordRuns(cookMachine);

const file = new URL("./dropped-message.ts", import.meta.url).pathname;

test("the kitchen and waiter board draws the waiter as a part", async () => {
  const result = await inspectModule(file, { load: (path) => import(path) });
  expect(result.machines[0]?.actors).toEqual(["waiter"]);
});

test("the kitchen and waiter fixture has no design errors", () => {
  expectNoDesignErrors({
    machine: cookMachine,
    payloads: {},
  });
});

test("A dish cooked while the waiter is on a break is lost", () => {
  const driver = createDriver({
    id: "cook",
    create: () => {
      const clock = VirtualClock();
      const made = recorded.create();
      return { actor: made.actor, clock, made };
    },
  });
  const step = (event: string, actor?: { region: string }) =>
    driver.step({ kind: "event", event, payload: {}, ...(actor === undefined ? {} : { actor }) });
  const taken = step("DISH_COOKED");
  expect(taken.after[0]?.message).toEqual({ sender: "", dropped: null });
  expect(step("DISH_SERVED", { region: "waiter" }).last.to).toBe("waiter.serving");
  expect(step("BREAK_STARTED", { region: "waiter" }).last.to).toBe("waiter.onBreak");
  const live = step("DISH_COOKED");
  const dropped = live.after.filter((entry) => entry.message?.dropped === "noHandler");
  expect(dropped).toHaveLength(1);
  expect(dropped[0]).toMatchObject({
    actor: { region: "waiter" },
    event: "DISH_READY",
    from: "waiter.onBreak",
    outcome: "ignored",
    message: { dropped: "noHandler" },
  });
});
