import { Either } from "@mantaq/utils";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { EXAMPLE_ROOT } from "../examples.ts";
import { designErrors } from "../gate.ts";
import { inspectModule } from "../inspect.ts";
import { analyzeModule } from "./annotate.ts";

const FIXTURES = join(EXAMPLE_ROOT, "packages/inspect/src/fixtures");
const file = join(FIXTURES, "built-elsewhere.ts");

function machines() {
  return Either.getRight(analyzeModule({ file, root: EXAMPLE_ROOT }))?.machines ?? [];
}

describe("samples from the actor's send type", () => {
  test("a helper-built machine has a sample per event that carries a payload, from send and the events map", () => {
    expect(machines()[0]?.samples).toEqual({
      "jobs.ITEM_ARRIVED": [{ item: "sample" }],
      "jobs.ITEMS_ASSIGNED": [{ worker: "sample", items: ["sample"] }],
      "jobs.ITEMS_FINISHED": [{ worker: "sample", items: ["sample"] }],
      "jobs.ITEMS_FAILED": [{ worker: "sample", items: ["sample"], error: "sample" }],
      "jobs.ITEMS_RETURNED": [{ worker: "sample", items: ["sample"] }],
      "jobs.RUN_FAILED": [{ error: "sample" }],
    });
  });

  test("an event with a wide type, a void payload or no payload has no sample", () => {
    const found = Either.getRight(
      analyzeModule({ file: join(FIXTURES, "send-shapes.ts"), root: EXAMPLE_ROOT }),
    );
    expect(found?.machines[0]?.samples).toEqual({ "shapes.PICK": [{ n: 1 }] });
  });

  test("inspecting it sends real payloads: no missing payload, no design error", async () => {
    const result = await inspectModule(file, { load: (path) => import(path) });
    expect(result.warnings.filter((warning) => warning.includes("without a payload"))).toEqual([]);
    expect(result.machines).not.toEqual([]);
    expect(result.machines.flatMap((machine) => designErrors(machine))).toEqual([]);
  });
});
