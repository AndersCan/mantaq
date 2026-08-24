import { expect, test, describe } from "vite-plus/test";
import { Actor, state, event } from "../src/index.ts";

const idle = state("idle")();
const active = state("active")();
const done = state("done")();
const go = event("GO")();

describe("ActorBuilder registration override", () => {
  test("a later on(state, event) overrides the earlier handler", () => {
    const actor = new Actor({
      inputs: [go],
      states: [idle, active, done],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: active }));
        m.on(idle, go, () => ({ state: done }));
      },
    });
    actor.send(go.create());
    expect(actor.snapshot().path[0]).toBe("done");
  });

  test("a later onAny(event) overrides the earlier handler", () => {
    const actor = new Actor({
      inputs: [go],
      states: [idle, active, done],
      initial: idle,
      setup: (m) => {
        m.onAny(go, () => ({ state: active }));
        m.onAny(go, () => ({ state: done }));
      },
    });
    actor.send(go.create());
    expect(actor.snapshot().path[0]).toBe("done");
  });

  test("composing the same part twice overrides with the later handler", () => {
    const actor = new Actor({
      inputs: [go],
      states: [idle, active, done],
      initial: idle,
      setup: (m) => {
        const part = (b: typeof m): void => {
          b.on(idle, go, () => ({ state: active }));
        };
        part(m);
        part(m);
        m.on(idle, go, () => ({ state: done }));
      },
    });
    actor.send(go.create());
    expect(actor.snapshot().path[0]).toBe("done");
  });
});
