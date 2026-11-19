import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { EXAMPLE_ROOT } from "../examples.ts";
import { inspectModule } from "../inspect.ts";

const FIXTURES = join(EXAMPLE_ROOT, "packages/inspect/src/fixtures");

test("a copied draft made with syncMachine.create() is read from the file the root imports", async () => {
  const result = await inspectModule(join(FIXTURES, "create-method/app.design-a.ts"), {
    load: (path) => import(path),
    fuzz: false,
  });
  const edge = result.machines[0]?.edges.find((e) => e.event === "go");
  expect(edge?.doc).toBe("The draft starts the work.");
  expect(edge?.explanation?.status).toBe("analyzed");
});
