import { test, describe } from "vite-plus/test";
import { fc, runProperty } from "@mantaq/pbt";
import { Actor, VirtualClock, state, event } from "../src/index.ts";

describe("Actor error state property tests", () => {
  test("errors are terminal, monotone, and frozen across later sends", () => {
    runProperty(
      fc.array(fc.oneof(fc.constant<"GO">("GO"), fc.constant<"BAD">("BAD")), {
        minLength: 1,
        maxLength: 40,
      }),
      (sequence) => {
        const idle = state("idle")();
        const active = state("active")();
        const go = event("GO")();
        const bad = event("BAD")();
        const actor = new Actor({
          clock: new VirtualClock(),
          inputs: [go, bad],
          states: [idle, active],
          initial: idle,
          setup: (m) => {
            m.on(idle, go, () => ({ state: active }));
            m.on(active, go, () => ({ state: idle }));
            m.onAny(bad, () => {
              throw new Error("boom");
            });
          },
        });

        let expectedState = "idle";
        let errored = false;
        let lastGoodName = "idle";
        for (const e of sequence) {
          actor.send(e === "GO" ? go.create() : bad.create());
          if (errored) continue;
          if (e === "GO") {
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
