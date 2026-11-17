import { VirtualClock, machine } from "@mantaq/core";
import type { Clock } from "@mantaq/core";
import { createKitchen } from "./fixtures/kitchen.ts";
import { inspect } from "./inspect.ts";
import { expect, test } from "vite-plus/test";

function isVirtual(clock: Clock): clock is VirtualClock {
  return typeof Reflect.get(clock, "advance") === "function";
}

test("a machine(...) whose create returns { actor, … } is fuzzed with the parts next to its actor, as its factory is", () => {
  const kitchen = machine("kitchen", {
    create: ({ clock }) => createKitchen({ clock: isVirtual(clock) ? clock : VirtualClock() }),
  });
  const asMachine = inspect({ machine: kitchen, fuzz: { seed: 1 } });
  const asFactory = inspect({ id: "kitchen", create: () => createKitchen(), fuzz: { seed: 1 } });
  expect(JSON.stringify(asMachine.machine.actors)).toContain('"orders"');
  expect(asMachine.machine).toEqual(asFactory.machine);
});
