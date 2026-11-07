import { EXAMPLE_ROOT } from "./examples.ts";
import { createCheckoutActor } from "./fixtures/checkout.ts";
import { createDoorActor } from "./fixtures/factories.ts";
import { inspect, inspectModule, machineId } from "./inspect.ts";
import type { VizStep } from "@mantaq/viz";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";

const FACTORIES = join(EXAMPLE_ROOT, "packages/inspect/src/fixtures/factories.ts");
const source = { file: FACTORIES, root: EXAMPLE_ROOT };

describe("inspect", () => {
  test("payloads read from the event types let fuzzing reach a payload-guarded state", () => {
    const { machine, warnings } = inspect({ id: "door", create: () => createDoorActor(), source });
    expect(warnings).toEqual([]);
    // Full coverage ends the run before the 2000 cap.
    expect(machine.fuzz?.iterations).toBeLessThan(2000);
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
      tests: [{ name: "knock", steps: [{ kind: "event", event: "knock", payload: null }] }],
    });
    const knock = machine.edges.find((edge) => edge.event === "knock");
    const open = machine.edges.find((edge) => edge.event === "open");
    expect(knock?.tested).toEqual({ hits: 1 });
    expect(open?.tested).toEqual({ hits: 0 });
  });

  test("example tests seed the fuzz corpus", () => {
    const knock: VizStep[] = [{ kind: "event", event: "knock", payload: null }];
    const { machine } = inspect({
      id: "door",
      create: () => createDoorActor(),
      fuzz: { iterations: 0 },
      tests: [{ name: "knock", steps: knock }],
    });
    expect(machine.fuzz?.corpus.map((sequence) => sequence.steps)).toContainEqual(knock);
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

describe("inspect: fuzz budget", () => {
  const checkout = {
    id: "checkout",
    create: () => createCheckoutActor(),
    source: {
      file: join(EXAMPLE_ROOT, "packages/inspect/src/fixtures/checkout.ts"),
      root: EXAMPLE_ROOT,
    },
  };
  const never = (warnings: string[]) =>
    warnings.filter((warning) => warning.startsWith("fuzz never reached"));

  test("timeLimitMs stops at full coverage, long before the limit, and is seeded", () => {
    const run = () => inspect({ ...checkout, fuzz: { timeLimitMs: 60_000 } });
    const { machine, warnings } = run();
    expect(warnings).toEqual([]);
    expect(machine.fuzz?.iterations).toBeGreaterThan(0);
    expect(machine.fuzz?.iterations).toBeLessThan(2000);
    expect(machine.states.every((state) => (state.coverage?.hits ?? 0) > 0)).toBe(true);
    expect(run().machine).toEqual(machine);
  });

  test("without timeLimitMs, iterations is a cap: stops at full coverage, seeded", () => {
    const run = () => inspect({ ...checkout, fuzz: { iterations: 50_000 } });
    const { machine, warnings } = run();
    expect(warnings).toEqual([]);
    expect(machine.fuzz?.iterations).toBeLessThan(50_000);
    expect(machine.states.every((state) => (state.coverage?.hits ?? 0) > 0)).toBe(true);
    expect(run().machine).toEqual(machine);
  });

  test("states and edges fuzz missed are a warning with the iterations run and why it stopped", () => {
    const { machine, warnings } = inspect({ ...checkout, fuzz: { iterations: 3 } });
    expect(machine.fuzz?.iterations).toBe(3);
    expect(never(warnings)).toHaveLength(1);
    expect(never(warnings)[0]).toMatch(
      /^fuzz never reached: .*success.* \(ran 3 iterations, stopped: iteration cap\)\. Raise fuzz\.timeLimitMs \/ iterations or add a named run to `tests`\.$/,
    );
  });

  test("an iteration cap under a time limit stops first and says so", () => {
    const { warnings } = inspect({ ...checkout, fuzz: { timeLimitMs: 60_000, iterations: 3 } });
    expect(never(warnings)[0]).toContain("(ran 3 iterations, stopped: iteration cap)");
  });

  test("a named run that reaches the missed states clears the warning", () => {
    const payload = { email: "a@b.c", name: "A" };
    const steps: VizStep[] = [
      { kind: "event", event: "submitBasicInfo", payload },
      {
        kind: "event",
        event: "submitShipping",
        payload: { street: "s", city: "c", zip: "z" },
      },
      { kind: "event", event: "submitPayment", payload: { cardNumber: "4" } },
      { kind: "event", event: "paymentOk", payload: { orderId: "o" } },
    ];
    const { warnings } = inspect({
      ...checkout,
      fuzz: { iterations: 0 },
      tests: [{ name: "happy path", steps }],
    });
    expect(never(warnings).join("\n")).not.toContain("success");
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
