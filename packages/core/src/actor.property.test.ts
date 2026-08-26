import { event } from "./event.ts";
import { Actor, VirtualClock } from "./index.ts";
import { state } from "./state.ts";
import { fc, runProperty } from "@mantaq/pbt";
import { test, describe } from "vite-plus/test";

describe("Actor property tests", () => {
  test("a timer effect creates a deterministic final transition exactly at deadline", () => {
    runProperty(
      fc.tuple(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 1000 }), fc.boolean()),
      ([timeoutMs, advanceMs, aborted]) => {
        const clock = VirtualClock();
        const idle = state("idle")();
        const waiting = state("waiting")();
        const done = state("done")().final();
        const start = event("START")();
        const tick = event("TICK")();
        const stop = event("STOP")();

        const actor = Actor({
          clock,
          inputs: [start, stop],
          internal: [tick],
          states: [idle, waiting, done],
          initial: idle,
          setup: (m) => {
            m.on(idle, { eventRef: start, handler: () => ({ state: waiting }) });
            m.on(waiting, { eventRef: stop, handler: () => ({ state: idle }) });
            m.on(waiting, { eventRef: tick, handler: () => ({ state: done }) });
            m.effect(waiting, {
              name: "armDeadlineTimer",
              fn: ({ signal, clock: c, emit }) => {
                c.setTimeout(timeoutMs, { signal, cb: () => emit(tick.create()) });
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

  test("the actor calls change subscribers once per transition plus the initial snapshot", () => {
    runProperty(fc.integer({ min: 0, max: 30 }), (count) => {
      const idle = state("idle")();
      const onState = state("on")();
      const toggle = event("TOGGLE")();

      const actor = Actor({
        inputs: [toggle],
        states: [idle, onState],
        initial: idle,
        setup: (m) => {
          m.on(idle, { eventRef: toggle, handler: () => ({ state: onState }) });
          m.on(onState, { eventRef: toggle, handler: () => ({ state: idle }) });
        },
      });

      let changeCalls = 0;
      let doneCalls = 0;
      actor.on("change", { fn: () => changeCalls++ });
      actor.on("done", { fn: () => doneCalls++ });

      for (let idx = 0; idx < count; idx++) {
        actor.send(toggle.create());
      }

      if (changeCalls !== count + 1) return false;
      if (doneCalls !== 0) return false;
      return true;
    });
  });
});
