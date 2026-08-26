import { Actor, state, event } from "./index.ts";
import { expect, test, describe } from "vite-plus/test";

const idle = state("idle")();
const active = state("active")();
const done = state("done")();
const trigger = event("GO")();

describe("ActorBuilder registration override", () => {
  test("a later on(state, event) call replaces the earlier handler", () => {
    const actor = Actor({
      inputs: [trigger],
      states: [idle, active, done],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: active }) });
        m.on(idle, { eventRef: trigger, handler: () => ({ state: done }) });
      },
    });
    actor.send(trigger.create());
    expect(actor.snapshot().path[0]).toBe("done");
  });

  test("a later onAny(event) call replaces the earlier handler", () => {
    const actor = Actor({
      inputs: [trigger],
      states: [idle, active, done],
      initial: idle,
      setup: (m) => {
        m.onAny({ eventRef: trigger, handler: () => ({ state: active }) });
        m.onAny({ eventRef: trigger, handler: () => ({ state: done }) });
      },
    });
    actor.send(trigger.create());
    expect(actor.snapshot().path[0]).toBe("done");
  });

  test("composing the same part twice keeps the later handler", () => {
    const actor = Actor({
      inputs: [trigger],
      states: [idle, active, done],
      initial: idle,
      setup: (m) => {
        function part(b: typeof m): void {
          b.on(idle, { eventRef: trigger, handler: () => ({ state: active }) });
        }
        part(m);
        part(m);
        m.on(idle, { eventRef: trigger, handler: () => ({ state: done }) });
      },
    });
    actor.send(trigger.create());
    expect(actor.snapshot().path[0]).toBe("done");
  });
});
