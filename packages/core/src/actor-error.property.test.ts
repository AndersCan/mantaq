import { Actor, VirtualClock, state, event } from "./index.ts";
import { fc, runProperty } from "@mantaq/pbt";
import { test, describe } from "vite-plus/test";

/**
 * A handler/subscriber explosion is a programmer bug, i.e. an assert-style bad
 * state, so the containment paths below use a guard-shaped throw helper.
 */
function isErrorBomb(message: string): never {
  throw new Error(message);
}

describe("Actor error state property tests", () => {
  test("the machine treats errors as terminal, monotone, and frozen across later sends", () => {
    runProperty(
      fc.array(fc.oneof(fc.constant<"GO">("GO"), fc.constant<"BAD">("BAD")), {
        minLength: 1,
        maxLength: 40,
      }),
      (sequence) => {
        const idle = state("idle")();
        const active = state("active")();
        const trigger = event("GO")();
        const bad = event("BAD")();
        const actor = Actor({
          clock: VirtualClock(),
          inputs: [trigger, bad],
          states: [idle, active],
          initial: idle,
          setup: (m) => {
            m.on(idle, { eventRef: trigger, handler: () => ({ state: active }) });
            m.on(active, { eventRef: trigger, handler: () => ({ state: idle }) });
            m.onAny({ eventRef: bad, handler: () => isErrorBomb("boom") });
          },
        });

        let expectedState = "idle";
        let errored = false;
        let lastGoodName = "idle";
        for (const eventName of sequence) {
          actor.send(eventName === "GO" ? trigger.create() : bad.create());
          if (errored) continue;
          if (eventName === "GO") {
            expectedState = expectedState === "idle" ? "active" : "idle";
          } else {
            lastGoodName = expectedState;
            errored = true;
          }
        }

        const snap = actor.snapshot();
        if (errored) {
          if (snap.path[0] !== "__error") return false;
          if (snap.error === undefined) return false;
          if (snap.error.reason !== "transition") return false;
          if (snap.error.event.type !== "BAD") return false;
          if (snap.error.state.name !== lastGoodName) return false;
        } else {
          if (snap.path[0] !== expectedState) return false;
          if (snap.error !== undefined) return false;
        }
        return true;
      },
    );
  });
});
