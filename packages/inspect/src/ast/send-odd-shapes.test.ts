import { Either } from "@mantaq/utils";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { EXAMPLE_ROOT } from "../examples.ts";
import { analyzeModule } from "./annotate.ts";
test("send shapes without a type, an unknown event or no parameter give no sample and no crash; a wrapped actor without an events map reads its send type", () => {
  const found = analyzeModule({
    file: join(EXAMPLE_ROOT, "packages/inspect/src/fixtures/review-send-odd.ts"),
    root: EXAMPLE_ROOT,
  });
  expect(Either.getLeft(found)).toBeUndefined();
  expect(Either.getRight(found)?.machines.map((m) => [m.name, m.samples])).toEqual([
    ["createOdd", { "odd.GO": [{ k: "sample" }] }],
    ["createLoose", {}],
    ["createNone", {}],
    ["createWrapped", { "wrapped.GO": [{ k: "sample" }] }],
  ]);
});
