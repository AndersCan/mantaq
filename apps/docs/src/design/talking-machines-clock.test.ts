import { VirtualClock } from "@mantaq/core";
import { createDriver } from "@mantaq/inspect/drive";
import { expect, test } from "vite-plus/test";
import { checkoutMachine } from "./talking-machines.ts";

test("the 30 s payment deadline runs on the clock create() is given", () => {
  const driver = createDriver(
    {
      id: "checkout",
      create: () => {
        const clock = VirtualClock();
        const made = checkoutMachine.create({ clock });
        return { actor: made.actor, clock, made };
      },
    },
    { effectMode: "real" },
  );
  driver.step({ kind: "event", event: "CHECKOUT_STARTED", payload: {} });
  const step = driver.step({ kind: "advance", ms: 30_000 });
  expect(step.state).toBe("expired");
  expect(step.regions).toEqual({ stock: "stock.free" });
});
