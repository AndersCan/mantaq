import { test, describe } from "vite-plus/test";
import { fc, runProperty } from "@mantaq/pbt";
import { Actor, VirtualClock } from "../src/index.ts";
import { state } from "../src/state.ts";
import { event } from "../src/event.ts";

describe("Actor property tests", () => {
  test("timer effect drives a deterministic final transition exactly at deadline", () => {
    runProperty(
      fc.tuple(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 1000 }), fc.boolean()),
      ([timeoutMs, advanceMs, aborted]) => {
        const clock = new VirtualClock();
        const idle = state("idle")();
        const waiting = state("waiting")();
        const done = state("done")().final();
        const start = event("START")();
        const tick = event("TICK")();
        const stop = event("STOP")();

        const actor = new Actor({
          clock,
          inputs: [start, stop],
          internal: [tick],
          states: [idle, waiting, done],
          initial: idle,
          setup: (m) => {
            m.on(idle, start, () => ({ state: waiting }));
            m.on(waiting, stop, () => ({ state: idle }));
            m.on(waiting, tick, () => ({ state: done }));
            m.effect(waiting, {
              name: "armDeadlineTimer",
              fn: ({ signal, clock: c, emit }) => {
                c.setTimeout(timeoutMs, () => emit(tick.create()), { signal });
              },
            });
          },
        });

        actor.send(start.create());
        if (aborted) actor.send(stop.create());
        clock.advance(advanceMs);

        const expectedDone = !aborted && advanceMs >= timeoutMs;
        const actualDone = actor.snapshot().done === true;
        if (actualDone !== expectedDone) return false;
        return true;
      },
    );
  });

  test("change subscribers fire once per transition plus the initial snapshot", () => {
    runProperty(fc.integer({ min: 0, max: 30 }), (count) => {
      const idle = state("idle")();
      const on = state("on")();
      const toggle = event("TOGGLE")();

      const actor = new Actor({
        inputs: [toggle],
        states: [idle, on],
        initial: idle,
        setup: (m) => {
          m.on(idle, toggle, () => ({ state: on }));
          m.on(on, toggle, () => ({ state: idle }));
        },
      });

      let changeCalls = 0;
      let doneCalls = 0;
      actor.on("change", () => changeCalls++);
      actor.on("done", () => doneCalls++);

      for (let i = 0; i < count; i++) {
        actor.send(toggle.create());
      }

      if (changeCalls !== count + 1) return false;
      if (doneCalls !== 0) return false;
      return true;
    });
  });
});
