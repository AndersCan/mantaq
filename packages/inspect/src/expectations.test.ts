import { VirtualClock } from "@mantaq/core";
import { machineFindings } from "@mantaq/viz";
import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { checkExpectations, matches, printPattern } from "./expectations.ts";
import type { Expectations } from "./expectations.ts";
import { createCheckoutActor } from "./fixtures/checkout.ts";
import { createExpectedActor, expectedExpectations } from "./fixtures/expected.ts";
import { createThrowingActor } from "./fixtures/throwing.ts";
import { fuzz } from "./fuzz/fuzz.ts";
import { execute } from "./fuzz/run.ts";
import type { FuzzTarget } from "./fuzz/run.ts";
import { expectNoDesignErrors } from "./gate.ts";
import { EXAMPLE_ROOT } from "./examples.ts";
import { inspect, inspectModule } from "./inspect.ts";
import { join } from "node:path";

const EXPECTED = join(EXAMPLE_ROOT, "packages/inspect/src/fixtures/expected.ts");

function target(expectations: unknown = expectedExpectations): FuzzTarget {
  const checked = checkExpectations(expectations, ["idle", "counting", "done"]).checked;
  return {
    id: "expected",
    create: () => {
      const clock = VirtualClock();
      return { actor: createExpectedActor(clock), clock };
    },
    expectations: checked,
  };
}

describe("matches", () => {
  test("listed keys must match, others are ignored", () => {
    expect(matches({ address: "" }, { email: "x", address: "" })).toBe(true);
    expect(matches({ address: "" }, { address: "a" })).toBe(false);
    expect(matches({ basicInfo: { email: "" } }, { basicInfo: { email: "", name: "n" } })).toBe(
      true,
    );
  });

  test("undefined means the key is not set", () => {
    expect(matches({ shippingAddress: undefined }, { basicInfo: {} })).toBe(true);
    expect(matches({ shippingAddress: undefined }, { shippingAddress: {} })).toBe(false);
  });

  test("arrays and values are compared exactly", () => {
    expect(matches({ items: [] }, { items: [1] })).toBe(false);
    expect(matches({ items: [{ a: 1 }] }, { items: [{ a: 1, b: 2 }] })).toBe(false);
    expect(matches({ items: [{ a: 1 }] }, { items: [{ a: 1 }] })).toBe(true);
    expect(matches({ count: 3 }, { count: "3" })).toBe(false);
  });

  test("an empty pattern matches any context", () => {
    expect(matches({}, null)).toBe(true);
    expect(matches({}, { a: 1 })).toBe(true);
    expect(matches({ a: 1 }, null)).toBe(false);
  });

  test("prints JSON, with undefined spelled out", () => {
    expect(printPattern({ shippingAddress: undefined })).toBe('{"shippingAddress":undefined}');
    expect(printPattern({ a: { b: [1, "x"] } })).toBe('{"a":{"b":[1,"x"]}}');
  });
});

describe("checkExpectations", () => {
  const states = ["idle", "counting", "done"];

  test("orders by state, neverSee before mustSee, then as written", () => {
    const { checked, warnings } = checkExpectations(
      {
        done: { mustSee: [{ count: 1 }] },
        counting: { mustSee: [{ count: 5 }], neverSee: [{ count: 1 }, { count: 2 }] },
      },
      states,
    );
    expect(warnings).toEqual([]);
    expect(checked.map((each) => each.feature)).toEqual([
      "never:counting:0",
      "never:counting:1",
      "must:counting:0",
      "must:done:0",
    ]);
    expect(checked[0]?.text).toBe('{"count":1}');
  });

  test("nothing written: nothing to check", () => {
    expect(checkExpectations(undefined, states)).toEqual({ checked: [], warnings: [] });
  });
});

describe("fuzz with expectations", () => {
  test("the never-see is reported with shrunk steps that reach it", () => {
    const run = target();
    const result = fuzz(run, { seed: 1, iterations: 500 });
    const hit = result.failedExpectations.find((each) => each.kind === "neverSee");
    expect(hit?.state).toBe("counting");
    expect(hit?.match).toBe('{"count":3}');
    const steps = hit?.steps ?? [];
    expect(steps.map((step) => (step.kind === "event" ? step.event : "advance"))).toEqual([
      "begin",
      "bump",
      "bump",
      "bump",
    ]);
    const trace = execute(run, steps);
    expect(trace.visited.at(-1)).toBe("counting");
    expect(trace.observations.at(-1)?.context).toMatchObject({ count: 3 });
  });

  test("the must-see nobody reaches has no steps and says so", () => {
    const result = fuzz(target(), { seed: 1, iterations: 500 });
    expect(result.failedExpectations.find((each) => each.kind === "mustSee")).toEqual({
      kind: "mustSee",
      state: "counting",
      match: '{"count":-1}',
      steps: null,
    });
  });

  test("a must-see that is reached passes", () => {
    const result = fuzz(target({ counting: { mustSee: [{ count: 2 }] } }), {
      seed: 1,
      iterations: 500,
    });
    expect(result.failedExpectations).toEqual([]);
  });

  test("the initial context counts", () => {
    const result = fuzz(target({ idle: { neverSee: [{ count: 0 }] } }), {
      seed: 1,
      iterations: 10,
    });
    expect(result.failedExpectations).toMatchObject([
      { kind: "neverSee", state: "idle", steps: [] },
    ]);
  });

  test("same seed, same result", () => {
    const first = fuzz(target(), { seed: 7, iterations: 300 });
    const second = fuzz(target(), { seed: 7, iterations: 300 });
    expect(second.failedExpectations).toEqual(first.failedExpectations);
    expect(second.corpus).toEqual(first.corpus);
  });

  test("without expectations the result is the one fuzzing gave before", () => {
    const plain = { ...target(), expectations: undefined };
    const empty = { ...target(), expectations: [] };
    const first = fuzz(plain, { seed: 3, iterations: 300 });
    const second = fuzz(empty, { seed: 3, iterations: 300 });
    expect(first.failedExpectations).toEqual([]);
    expect(second.corpus).toEqual(first.corpus);
    expect(second.errors).toEqual(first.errors);
    expect([...second.firstHit]).toEqual([...first.firstHit]);
  });
});

describe("inspect with expectations", () => {
  test("the findings show up on the machine", () => {
    const { machine, warnings } = inspect({
      id: "expected",
      create: () => createExpectedActor(),
      expectations: expectedExpectations,
      fuzz: { iterations: 500 },
    });
    expect(warnings).toEqual([]);
    expect(machineFindings(machine).map((each) => each.kind)).toEqual(["neverSee", "mustSee"]);
  });

  test("fuzzing off: warns and finds nothing", () => {
    const { machine, warnings } = inspect({
      id: "expected",
      create: () => createExpectedActor(),
      expectations: expectedExpectations,
      fuzz: false,
    });
    expect(warnings).toEqual(["expectations not checked: fuzzing is off"]);
    expect(machineFindings(machine)).toEqual([]);
  });

  test("a bad entry is ignored with a warning, the rest still checked", () => {
    const { warnings, machine } = inspect({
      id: "expected",
      create: () => createExpectedActor(),
      expectations: JSON.parse('{"counting":{"neverSee":[{"count":3}],"neverse":[]},"paymnt":{}}'),
      fuzz: { iterations: 500 },
    });
    expect(warnings).toEqual([
      'expectations for unknown state "paymnt" ignored',
      'expectations for counting: unknown field "neverse" ignored (use neverSee or mustSee)',
    ]);
    expect(machineFindings(machine).map((each) => each.kind)).toEqual(["neverSee"]);
  });

  test("the module lookup finds <machine id>Expectations", async () => {
    const result = await inspectModule(EXPECTED, {
      load: async (file) => import(file),
      fuzz: { iterations: 500 },
    });
    expect(result.warnings).toEqual([]);
    expect(machineFindings(result.machines[0]!).map((each) => each.kind)).toEqual([
      "neverSee",
      "mustSee",
    ]);
  });

  test("an export no machine claims gets a warning that names the expected export", async () => {
    const result = await inspectModule(EXPECTED, {
      load: async (file) => ({ ...(await import(file)), wrongExpectations: {} }),
      fuzz: { iterations: 100 },
    });
    expect(result.warnings).toEqual([
      `${EXPECTED}: wrongExpectations matches no machine; name it <machine id>Expectations (machines: expected)`,
    ]);
  });
});

describe("expectNoDesignErrors with expectations", () => {
  test("lists the never-see with the events that reach it", () => {
    expect(() =>
      expectNoDesignErrors({
        id: "expected",
        create: () => createExpectedActor(),
        expectations: { counting: { neverSee: [{ count: 3 }] } },
        fuzz: { iterations: 500 },
      }),
    ).toThrow(
      'expected has 1 design error:\n  - state counting reached never-see context {"count":3}\n    after: begin → bump → bump → bump',
    );
  });

  test("a must-see miss says how many runs looked", () => {
    expect(() =>
      expectNoDesignErrors({
        id: "expected",
        create: () => createExpectedActor(),
        expectations: { counting: { mustSee: [{ count: -1 }] } },
        fuzz: { iterations: 200 },
      }),
    ).toThrow('state counting never reached must-see context {"count":-1} in 200 fuzz runs');
  });

  test("a handler error gets its after: line too", () => {
    expect(() =>
      expectNoDesignErrors({ id: "throwing", create: () => createThrowingActor() }),
    ).toThrow(/- pick in idle throws[^\n]*\n {4}after: pick/);
  });
});

describe("Expectations type", () => {
  test("is keyed by the machine's states and typed by its context", () => {
    type Checkout = Expectations<typeof createCheckoutActor>;
    expectTypeOf<{ payment: { neverSee: [{ orderId: string }] } }>().toExtend<Checkout>();
    expectTypeOf<{ payment: { neverSee: [{ orderId: undefined }] } }>().toExtend<Checkout>();
    expectTypeOf<{ paymnt: object }>().not.toExtend<Checkout>();
    expectTypeOf<{ payment: { neverSee: [{ orderId: number }] } }>().not.toExtend<Checkout>();
    expectTypeOf<{ __error: object }>().not.toExtend<Checkout>();
  });
});
