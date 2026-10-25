import { fuzz } from "./fuzz.ts";
import { execute } from "./run.ts";
import type { FuzzTarget } from "./run.ts";
import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";

const idle = state("idle")();
const left = state("left")();
const right = state("right")();
const pick = event("pick")<{ side: string }>();
// Typed as total, but only two sides exist: an unknown side reads `.next` of undefined.
const routes: Record<string, { next: typeof left | typeof right }> = {
  a: { next: left },
  b: { next: right },
};

/** Handler crashes on any side other than the two it knows. */
function brittleTarget(): FuzzTarget {
  return {
    id: "brittle",
    create: () => {
      const clock = VirtualClock();
      const actor = Actor({
        inputs: [pick],
        states: [idle, left, right],
        initial: idle,
        clock,
        setup: (m) => {
          m.on(idle, {
            eventRef: pick,
            handler: (e) => ({ state: routes[e.payload.side].next }),
          });
        },
      });
      return { actor, clock };
    },
    payloads: { pick: [{ side: "a" }] },
  };
}

describe("fuzz failure paths", () => {
  test("internal events the current state cannot handle are skipped, not errors", () => {
    const target: FuzzTarget = {
      id: "inject",
      create: () => {
        const clock = VirtualClock();
        const done = event("done")();
        const actor = Actor({
          inputs: [],
          internal: [done],
          states: [idle, left],
          initial: left,
          clock,
          setup: (m) => m.on(idle, { eventRef: done, handler: () => ({ state: left }) }),
        });
        return { actor, clock };
      },
    };
    const trace = execute(target, [{ kind: "event", event: "done", payload: null }]);
    expect(trace.errors).toEqual([]);
    expect(trace.features).toEqual(["state:left"]);
  });

  test("handler that throws is reported with a shrunk replay sequence", () => {
    const target = brittleTarget();
    const result = fuzz(target, { seed: 1, iterations: 200 });
    expect(result.errors.map((error) => `${error.from}>${error.event}`)).toEqual(["idle>pick"]);
    const [error] = result.errors;
    expect(error?.message).toMatch(/TypeError/);
    expect(error?.steps).toHaveLength(1);
    expect(execute(target, error?.steps ?? []).errors).toHaveLength(1);
  });

  test("zero iterations keeps only the empty run", () => {
    const result = fuzz(brittleTarget(), { seed: 1, iterations: 0 });
    expect(result.corpus.map((entry) => entry.steps)).toEqual([[]]);
    expect(result.errors).toEqual([]);
  });
});
