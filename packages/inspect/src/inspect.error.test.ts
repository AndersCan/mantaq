import { EXAMPLE_ROOT } from "./examples.ts";
import { createCheckoutActor } from "./fixtures/checkout.ts";
import { createDoorActor } from "./fixtures/factories.ts";
import { createTimerThrowActor } from "./fixtures/timer-throw.ts";
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

describe("inspect: fuzz that cannot finish or crashes is reported, not fatal", () => {
  test("a timer callback that throws under clock.advance is a fuzz error; fuzzing goes on", () => {
    const { machine, warnings } = inspect({
      id: "pay",
      create: () => createTimerThrowActor(),
      // `{}` is the payload the type forbids but fuzz may send: `card` is undefined.
      payloads: { pay: [{ card: "4111" }, { card: "5500" }, {}], ok: [null], no: [null] },
    });
    const crash = machine.fuzz?.errors.find((error) => error.event === "advance");
    expect(crash?.from).toBe("charging");
    expect(crash?.message).toMatch(/^TypeError: .*startsWith/);
    // The shrunk event path that reproduces it: pay with no card, then time passes.
    expect(crash?.steps.map((step) => step.kind)).toEqual(["event", "advance"]);
    expect(crash?.steps[0]).toMatchObject({ event: "pay", payload: {} });
    // Runs with a card still reach both outcomes.
    expect(warnings).toEqual([]);
    const hits = (id: string) => machine.states.find((state) => state.id === id)?.coverage?.hits;
    expect(hits("paid")).toBeGreaterThan(0);
    expect(hits("declined")).toBeGreaterThan(0);
  });

  test("no source: events go out without payloads, and the warning says so", () => {
    const { warnings } = inspect({ id: "pay", create: () => createTimerThrowActor() });
    expect(warnings).toContain(
      "no source, so payload types are unknown: fuzz sends no, ok, pay without a payload. Pass `source` (samples from the event types) or `payloads`.",
    );
  });

  test("timeLimitMs 0 runs no iterations and names the time limit as the reason", () => {
    const { machine, warnings } = inspect({
      id: "checkout",
      create: () => createCheckoutActor(),
      source: { file: join(FIXTURES, "checkout.ts"), root: EXAMPLE_ROOT },
      fuzz: { timeLimitMs: 0 },
    });
    expect(machine.fuzz?.iterations).toBe(0);
    expect(warnings).toEqual([
      "fuzz never reached: error, payment, shippingAddress, submitting, success, basicInfo -submitBasicInfo-> shippingAddress (ran 0 iterations, stopped: time limit). Raise fuzz.timeLimitMs / iterations or add a named run to `tests`.",
    ]);
  });
});
