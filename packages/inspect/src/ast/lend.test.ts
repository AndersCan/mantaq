import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { EXAMPLE_ROOT } from "../examples.ts";
import { inspectModule } from "../inspect.ts";

const FIXTURES = join(EXAMPLE_ROOT, "packages/inspect/src/fixtures");

test("a file that supplied no handler lends no descriptions", async () => {
  const result = await inspectModule(join(FIXTURES, "lend/parent.ts"), {
    load: (path) => import(path),
    fuzz: false,
  });
  const machine = result.machines[0];
  if (machine === undefined) throw new Error("no machine");
  expect(machine.edges.find((e) => e.kind === "effect")?.doc).toBe(null);
  expect(machine.states.map((s) => s.doc)).toEqual([null, null]);
});
