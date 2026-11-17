import { Either } from "@mantaq/utils";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { EXAMPLE_ROOT } from "../examples.ts";
import { analyzeModule } from "./annotate.ts";

const OPEN = [
  { by: "key", code: "sample", tags: ["sample"], at: { floor: 1, urgent: false } },
  { by: "code", code: "sample", tags: ["sample"], at: { floor: 1, urgent: false } },
  { by: "key", code: "sample", tags: ["sample"], at: { floor: 1, urgent: true } },
];

test("each machine(...) shape carries the samples of its send type", () => {
  const found = Either.getRight(
    analyzeModule({
      file: join(EXAMPLE_ROOT, "packages/inspect/src/fixtures/factories.ts"),
      root: EXAMPLE_ROOT,
    }),
  );
  expect(found?.machines.map((machine) => [machine.name, machine.samples])).toEqual([
    ["door", { open: OPEN }],
    ["gate", { open: OPEN }],
  ]);
});

test("an effect result of a machine the factory returns gets samples", () => {
  const found = Either.getRight(
    analyzeModule({
      file: join(EXAMPLE_ROOT, "packages/inspect/src/fixtures/part-results/app.ts"),
      root: EXAMPLE_ROOT,
    }),
  );
  expect(found?.machines.find((machine) => machine.name === "shop")?.samples["LOADED"]).toEqual([
    { items: ["sample"] },
  ]);
});
