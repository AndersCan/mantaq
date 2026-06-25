import { expect, test, describe } from "vite-plus/test";
import { Actor, state, event, VirtualClock } from "../src/index.ts";

describe("API smoke", () => {
  test("example from user", () => {
    const idle = state("idle")();
    const running = state("running")();

    const start = event("START")();
    const stop = event("STOP")();

    const machine = new Actor({
      inputs: [start, stop],
      states: [idle, running],
      initial: idle,
      setup: (m) => {
        m.on(idle, start, () => ({ state: running }));
        m.on(running, stop, () => ({ state: idle }));
      },
    });

    machine.send(start.create());
    expect(machine.snapshot().path[0]).toBe("running");

    machine.send(stop.create());
    expect(machine.snapshot().path[0]).toBe("idle");
  });

  test("object payload event", () => {
    const idle = state("idle")<{ x: number }>();
    const running = state("running")();

    const start = event("START")<{ url: string }>();

    const machine = new Actor({
      inputs: [start],
      states: [idle, running],
      initial: { state: idle, payload: { x: 0 } },
      setup: (m) => {
        m.on(idle, start, (event) => {
          expect(typeof event.url).toBe("string");
          return { state: running };
        });
      },
    });

    machine.send(start.create({ url: "https://example.com" }));
    expect(machine.snapshot().path[0]).toBe("running");
  });

  test("VirtualClock works inline", () => {
    const clock = new VirtualClock();
    const idle = state("idle")();
    const ping = event("PING")();
    const actor = new Actor({
      inputs: [ping],
      states: [idle],
      initial: idle,
      clock,
      setup: (m) => {
        m.on(idle, ping, () => ({}));
      },
    });
    actor.send(ping.create());
    expect(actor.snapshot().path[0]).toBe("idle");
  });
});
