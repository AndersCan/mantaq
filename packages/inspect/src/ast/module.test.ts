import { EXAMPLE_ROOT } from "../examples.ts";
import { analyzeModule } from "./annotate.ts";
import type { ModuleAnalysis } from "./annotate.ts";
import { Either } from "@mantaq/utils";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";

const FIXTURES = join(EXAMPLE_ROOT, "packages/inspect/src/fixtures");

function analysis(name: string): ModuleAnalysis | undefined {
  return Either.getRight(analyzeModule({ file: join(FIXTURES, `${name}.ts`), root: EXAMPLE_ROOT }));
}

describe("analyzeModule: machine exports", () => {
  test("each factory shape is called the way its type allows", () => {
    expect(analysis("factories")?.machines).toEqual([
      { name: "createDoorActor", call: "clock", unwrap: "self" },
      { name: "createGate", call: "options", unwrap: "actor" },
      { name: "createRealDoor", call: "call", unwrap: "self" },
      { name: "sharedDoor", call: "instance", unwrap: "self" },
    ]);
  });

  test("an actor instance is found when it is the only export", () => {
    expect(analysis("instance")?.machines).toEqual([
      { name: "retry", call: "instance", unwrap: "self" },
    ]);
  });

  test("a file without machines has none", () => {
    expect(analysis("no-machines")?.machines).toEqual([]);
  });
});

describe("analyzeModule: payload samples from event types", () => {
  test("literal unions vary one field at a time; optional fields stay; void events have none", () => {
    const base = { by: "key", code: "sample", tags: ["sample"], at: { floor: 1, urgent: false } };
    expect(analysis("factories")?.payloads).toEqual({
      open: [base, { ...base, by: "code" }, { ...base, at: { floor: 1, urgent: true } }],
    });
  });

  test("handlers' events across the example machines", () => {
    expect(analysis("credit")?.payloads).toEqual({
      apply: [{ score: 1, amount: 1 }],
      decide: [{ approve: false }, { approve: true }],
      setTier: [{ tier: "sample" }],
    });
    expect(analysis("saga")?.payloads["START"]).toEqual([
      { order: { orderId: "sample", items: ["sample"], amount: 1 } },
    ]);
  });
});
