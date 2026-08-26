import { Actor, state, event, VirtualClock } from "./index.ts";
import { expect, test, describe } from "vite-plus/test";

describe("API smoke", () => {
  test("the README example returns the documented trace", () => {
    const idle = state("idle")();
    const running = state("running")();

    const start = event("START")();
    const stop = event("STOP")();

    const machine = Actor({
      inputs: [start, stop],
      states: [idle, running],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: start, handler: () => ({ state: running }) });
        m.on(running, { eventRef: stop, handler: () => ({ state: idle }) });
      },
    });

    machine.send(start.create());
    const stateAfterStart = machine.snapshot().path[0];
    machine.send(stop.create());
    const stateAfterStop = machine.snapshot().path[0];
    expect([stateAfterStart, stateAfterStop]).toEqual(["running", "idle"]);
  });

  test("object payloads flow through creation and handling", () => {
    const idle = state("idle")<{ x: number }>();
    const running = state("running")();

    const start = event("START")<{ url: string }>();

    const machine = Actor({
      inputs: [start],
      states: [idle, running],
      initial: { state: idle, payload: { x: 0 } },
      setup: (m) => {
        m.on(idle, {
          eventRef: start,
          handler: (event) => {
            expect(typeof event.payload.url).toBe("string");
            return { state: running };
          },
        });
      },
    });

    machine.send(start.create({ url: "https://example.com" }));
    expect(machine.snapshot().path[0]).toBe("running");
  });

  test("the actor handles an inline VirtualClock", () => {
    const clock = VirtualClock();
    const idle = state("idle")();
    const ping = event("PING")();
    const actor = Actor({
      inputs: [ping],
      states: [idle],
      initial: idle,
      clock,
      setup: (m) => {
        m.on(idle, { eventRef: ping, handler: () => ({}) });
      },
    });
    actor.send(ping.create());
    expect(actor.snapshot().path[0]).toBe("idle");
  });
});
