import { toAtlasMachine } from "./atlas.ts";
import type { FuzzTarget } from "./fuzz/run.ts";
import { withJourneys } from "./journey.ts";
import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { Either } from "@mantaq/utils";
import { describe, expect, test } from "vite-plus/test";

const idle = state("idle")();
const broken = state("broken")();
const go = event("go")();

function throwingTarget(): FuzzTarget {
  return {
    id: "throwing",
    create: () => {
      const clock = VirtualClock();
      const actor = Actor({
        inputs: [go],
        states: [idle, broken],
        initial: idle,
        clock,
        setup: (m) => {
          m.on(idle, {
            event: go,
            to: [broken],
            handler: () => {
              throw new Error("boom");
            },
          });
        },
      });
      return { actor, clock };
    },
  };
}

const goStep = { step: { kind: "event" as const, event: "go", payload: null } };

describe("withJourneys rejects", () => {
  test("a journey whose handler throws: readers must see a run that happens", () => {
    const target = throwingTarget();
    const machine = toAtlasMachine({ id: "throwing", actor: target.create().actor });
    const result = withJourneys(target, machine, [
      { id: "crash", title: "Crash", inputs: [goStep] },
    ]);
    expect(Either.getLeft(result)).toEqual([
      { journey: "crash", message: "input 0 (go in idle) threw: Error: boom" },
    ]);
  });

  test("a repeated journey id", () => {
    const target = throwingTarget();
    const machine = toAtlasMachine({ id: "throwing", actor: target.create().actor });
    const result = withJourneys(target, machine, [
      { id: "same", title: "A", inputs: [] },
      { id: "same", title: "B", inputs: [] },
    ]);
    expect(Either.getLeft(result)).toEqual([{ journey: "same", message: "duplicate journey id" }]);
  });
});
