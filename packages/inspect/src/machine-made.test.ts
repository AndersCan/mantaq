import { kitchen } from "./fixtures/kitchen.ts";
import { inspect } from "./inspect.ts";
import { expect, test } from "vite-plus/test";

test("a machine(...) whose create returns { actor, … } is fuzzed with the parts next to its actor", () => {
  const result = inspect({ machine: kitchen, fuzz: { seed: 1 } });
  expect(JSON.stringify(result.machine.actors)).toContain('"orders"');
  expect(result.machine.fuzz).not.toBeNull();
});
