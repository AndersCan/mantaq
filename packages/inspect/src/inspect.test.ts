import { EXAMPLE_ROOT } from "./examples.ts";
import { createDoorActor } from "./fixtures/factories.ts";
import { inspect, inspectModule, machineId } from "./inspect.ts";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";

const FACTORIES = join(EXAMPLE_ROOT, "packages/inspect/src/fixtures/factories.ts");
const source = { file: FACTORIES, root: EXAMPLE_ROOT };

describe("inspect", () => {
  test("payloads read from the event types let fuzzing reach a payload-guarded state", () => {
    const { machine, warnings } = inspect({ id: "door", create: () => createDoorActor(), source });
    expect(warnings).toEqual([]);
    expect(machine.fuzz?.iterations).toBe(2000);
    expect(machine.states.find((state) => state.id === "opened")?.coverage?.hits).toBeGreaterThan(
      0,
    );
    const open = machine.edges.find((edge) => edge.event === "open");
    expect(open?.explanation?.status).toBe("analyzed");
  });

  test("structure only, with no source: nothing to warn about", () => {
    const { machine, warnings } = inspect({
      id: "door",
      create: () => createDoorActor(),
      fuzz: false,
    });
    expect(warnings).toEqual([]);
    expect(machine.fuzz).toBeNull();
    expect(machine.initial).toBe("closed");
    expect(machine.edges.every((edge) => edge.explanation === null)).toBe(true);
  });

  test("test sequences fill `tested`", () => {
    const { machine } = inspect({
      id: "door",
      create: () => createDoorActor(),
      fuzz: false,
      tests: [[{ kind: "event", event: "knock", payload: null }]],
    });
    const knock = machine.edges.find((edge) => edge.event === "knock");
    const open = machine.edges.find((edge) => edge.event === "open");
    expect(knock?.tested).toEqual({ hits: 1 });
    expect(open?.tested).toEqual({ hits: 0 });
  });

  test("given payloads replace the ones read from types", () => {
    const given = { by: "code", code: "given", tags: [], at: { floor: 7, urgent: true } };
    const { machine } = inspect({
      id: "door",
      create: () => createDoorActor(),
      source,
      payloads: { open: [given] },
      fuzz: { iterations: 200 },
    });
    const sent = (machine.fuzz?.corpus ?? []).flatMap((sequence) =>
      sequence.steps.flatMap((step) => (step.kind === "event" ? [step.payload] : [])),
    );
    expect(sent).toContainEqual(given);
    expect(JSON.stringify(sent)).not.toContain('"sample"');
  });
});

describe("inspectModule", () => {
  test("every factory becomes a machine; the instance export is left out", async () => {
    const result = await inspectModule(FACTORIES, {
      load: async (file) => import(file),
      fuzz: { iterations: 100 },
    });
    expect(result.machines.map((machine) => machine.id)).toEqual(["door", "gate", "realDoor"]);
    expect(result.machines.find((machine) => machine.id === "gate")?.fuzz).not.toBeNull();
    expect(result.warnings).toEqual([
      "realDoor: not fuzzed: the actor does not run on a VirtualClock",
    ]);
  });
});

describe("machineId", () => {
  test("drops create… and …Actor, keeps other names", () => {
    expect(machineId("createCheckoutActor")).toBe("checkout");
    expect(machineId("createGate")).toBe("gate");
    expect(machineId("sharedDoor")).toBe("sharedDoor");
    expect(machineId("create")).toBe("create");
  });
});
