import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { EXAMPLE_ROOT } from "../examples.ts";
import { inspectModule } from "../inspect.ts";

const FIXTURES = join(EXAMPLE_ROOT, "packages/inspect/src/fixtures");

test("a helper called inside create does not lend its handler to the edge", async () => {
  const result = await inspectModule(join(FIXTURES, "review770e/app.ts"), {
    load: (path) => import(path),
    fuzz: false,
  });
  const edge = result.machines[0]?.edges.find((e) => e.event === "go");
  expect(edge?.doc).not.toBe("X finishes at once.");
});
