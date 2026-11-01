import { EXAMPLE_ROOT } from "./examples.ts";
import { createDoorActor } from "./fixtures/factories.ts";
import { inspect, inspectModule } from "./inspect.ts";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";

const FIXTURES = join(EXAMPLE_ROOT, "packages/inspect/src/fixtures");
const load = async (file: string): Promise<Record<string, unknown>> => import(file);

describe("inspect: what cannot be done is a warning, never a guess", () => {
  test("a source that cannot be analyzed leaves handler edges not_analyzed", () => {
    const missing = join(FIXTURES, "missing.ts");
    const { machine, warnings } = inspect({
      id: "door",
      create: () => createDoorActor(),
      source: { file: missing, root: EXAMPLE_ROOT },
      fuzz: false,
    });
    expect(warnings).toEqual([`source not found: ${missing}`]);
    const open = machine.edges.find((edge) => edge.event === "open");
    expect(open?.explanation?.status).toBe("not_analyzed");
  });

  test("a file with no machine export", async () => {
    const file = join(FIXTURES, "no-machines.ts");
    expect(await inspectModule(file, { load })).toEqual({
      machines: [],
      warnings: [`${file}: no exported actor or actor factory found`],
    });
  });

  test("an actor instance is drawn but not fuzzed", async () => {
    const result = await inspectModule(join(FIXTURES, "instance.ts"), { load });
    expect(result.machines.map((machine) => [machine.id, machine.fuzz])).toEqual([["retry", null]]);
    expect(result.warnings).toEqual(["retry: not fuzzed: exported as one actor, not a factory"]);
  });

  test("an export that does not return an actor at runtime is skipped", async () => {
    const result = await inspectModule(join(FIXTURES, "factories.ts"), {
      load: async (file) => ({
        ...(await load(file)),
        createDoorActor: () => ({ not: "an actor" }),
      }),
      fuzz: false,
    });
    expect(result.machines.map((machine) => machine.id)).toEqual(["gate", "realDoor"]);
    expect(result.warnings[0]).toBe("door: createDoorActor did not return an actor");
  });
});
