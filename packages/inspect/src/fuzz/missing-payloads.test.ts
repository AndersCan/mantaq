import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";
import { fuzz } from "./fuzz.ts";
import { execute } from "./run.ts";
import type { FuzzTarget } from "./run.ts";
import { inspect } from "../inspect.ts";

const off = state("off")();
const on = state("on")();

const lockSet = event("lockSet")<{ lockOn: boolean }>();
const probe = event("probe")<{ flag?: boolean }>();
const go = event("go")();
const keep = event("keep")<{ x?: number }>();

function createLockActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
    clock,
    inputs: [lockSet, probe, go],
    states: [off, on],
    initial: off,
    setup: (m) => {
      m.on(off, {
        event: lockSet,
        to: [on, off],
        handler: (e) => ({ state: e.payload.lockOn ? on : off }),
      });
      m.on(off, {
        event: probe,
        to: [on, off],
        handler: (e) => ({ state: "flag" in e.payload ? on : off }),
      });
      m.on(off, { event: go, to: [on], handler: () => ({ state: on }) });
    },
  });
}

function lockTarget(payloads?: FuzzTarget["payloads"]): FuzzTarget {
  return {
    id: "lock",
    create: () => {
      const clock = VirtualClock();
      return { actor: createLockActor(clock), clock };
    },
    ...(payloads === undefined ? {} : { payloads }),
  };
}

const step = (name: string, payload: { lockOn: boolean } | null) => ({
  kind: "event" as const,
  event: name,
  payload,
});

describe("execute records fields read from an empty payload", () => {
  test("an event sent without a payload and read", () => {
    const trace = execute(lockTarget(), [step("lockSet", null)]);
    expect(trace.missingPayloads).toEqual([{ event: "lockSet", fields: ["lockOn"] }]);
  });

  test("the same event with a payload records nothing", () => {
    const trace = execute(lockTarget(), [step("lockSet", { lockOn: true })]);
    expect(trace.missingPayloads).toEqual([]);
  });

  test("an event nobody reads from records nothing", () => {
    expect(execute(lockTarget(), [step("go", null)]).missingPayloads).toEqual([]);
  });

  test("an `in` check is a read", () => {
    const trace = execute(lockTarget(), [step("probe", null)]);
    expect(trace.missingPayloads).toEqual([{ event: "probe", fields: ["flag"] }]);
  });

  test("the handler still sees an empty payload", () => {
    const trace = execute(lockTarget(), [step("lockSet", null)]);
    expect(trace.visited).toEqual(["off", "off"]);
    expect(trace.observations[0]?.payload).toEqual({});
  });

  test("observations stay cloneable", () => {
    const trace = execute(lockTarget(), [step("lockSet", null), step("probe", null)]);
    expect(() => structuredClone(trace.observations)).not.toThrow();
  });

  test("a serializer probing toJSON is not a read", () => {
    const target: FuzzTarget = {
      id: "json",
      create: () => {
        const clock = VirtualClock();
        const actor = createLockActor(clock);
        return { actor, clock };
      },
    };
    const trace = execute(target, [step("go", null)]);
    expect(trace.missingPayloads).toEqual([]);
  });
});

describe("fuzz and inspect collect them", () => {
  test("fuzz merges every run, sorted", () => {
    const result = fuzz(lockTarget(), { seed: 1, iterations: 200 });
    expect(result.missingPayloads).toEqual([
      { event: "lockSet", fields: ["lockOn"] },
      { event: "probe", fields: ["flag"] },
    ]);
  });

  test("fuzz with payloads for both reads nothing missing", () => {
    const result = fuzz(lockTarget({ lockSet: [{ lockOn: true }], probe: [{ flag: true }] }), {
      seed: 1,
      iterations: 200,
    });
    expect(result.missingPayloads).toEqual([]);
  });

  test("inspect: one exact warning per event, and the same list on the result", () => {
    const { warnings, missingPayloads } = inspect({ id: "lock", create: () => createLockActor() });
    expect(missingPayloads).toEqual([
      { event: "lockSet", fields: ["lockOn"] },
      { event: "probe", fields: ["flag"] },
    ]);
    expect(warnings).toContain(
      "fuzz sent lockSet without a payload and the machine read lockOn. Pass `source` (samples from the event types) or `payloads` with a sample for lockSet.",
    );
    expect(warnings.filter((each) => each.startsWith("fuzz sent "))).toHaveLength(2);
  });

  test("inspect with payloads: neither warning nor list", () => {
    const { warnings, missingPayloads } = inspect({
      id: "lock",
      create: () => createLockActor(),
      payloads: { lockSet: [{ lockOn: true }], probe: [{ flag: true }] },
    });
    expect(missingPayloads).toEqual([]);
    expect(warnings.filter((each) => each.startsWith("fuzz sent "))).toEqual([]);
  });

  test("inspect with fuzzing off: nothing missing", () => {
    const { missingPayloads } = inspect({
      id: "lock",
      create: () => createLockActor(),
      fuzz: false,
    });
    expect(missingPayloads).toEqual([]);
  });
});

test("a read after the run ended is not part of that trace", () => {
  let kept: unknown;
  const target: FuzzTarget = {
    id: "keep",
    create: () => {
      const clock = VirtualClock();
      const actor = Actor({
        clock,
        inputs: [keep],
        states: [off, on],
        initial: off,
        setup: (m) => {
          m.on(off, {
            event: keep,
            to: [on],
            handler: (e) => {
              kept = e.payload;
              return { state: on };
            },
          });
        },
      });
      return { actor, clock };
    },
  };
  const trace = execute(target, [step("keep", null)]);
  void Reflect.get(Object(kept), "late");
  expect(trace.missingPayloads).toEqual([]);
});
