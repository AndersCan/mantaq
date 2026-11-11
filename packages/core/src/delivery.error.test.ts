import { Actor, event, state } from "./index.ts";
import { describe, expect, test } from "vite-plus/test";

describe("delivery failures", () => {
  test("an internal event no state handles sends the actor to __error", () => {
    const idle = state("idle")();
    const go = event("go")();
    const done = event("done")();
    const actor = Actor({
      inputs: [go],
      internal: [done],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.effect(idle, { name: "finish", sends: [done], fn: ({ emit }) => emit(done.create()) });
      },
    });
    expect(actor.state.name).toBe("__error");
  });

  test("a region output that is an internal event of the parent, with no handler, sends the parent to __error", () => {
    const childIdle = state("childIdle")();
    const parentIdle = state("parentIdle")();
    const go = event("go")();
    const tell = event("tell")();
    const child = Actor({
      inputs: [go],
      outputs: [tell],
      states: [childIdle],
      initial: childIdle,
      setup: (m) => {
        m.on(childIdle, { event: go, handler: () => ({ emit: [tell.create()] }) });
      },
    });
    const parent = Actor({
      inputs: [],
      internal: [tell],
      states: [parentIdle],
      initial: parentIdle,
      regions: { child },
      setup: () => {},
    });
    child.send(go.create());
    expect(parent.state.name).toBe("__error");
  });

  test("when the first emit of an effect moves the machine, the second is never handled", () => {
    const start = state("start")();
    const next = state("next")();
    const go = event("go")();
    const first = event("first")();
    const second = event("second")();
    const handled: string[] = [];
    const actor = Actor({
      inputs: [go],
      internal: [first, second],
      states: [start, next],
      initial: start,
      setup: (m) => {
        m.effect(start, {
          name: "twice",
          sends: [first, second],
          fn: ({ emit }) => {
            emit(first.create());
            emit(second.create());
          },
        });
        m.on(start, {
          event: first,
          to: [next],
          handler: () => {
            handled.push("first");
            return { state: next };
          },
        });
        for (const where of [start, next]) {
          m.on(where, {
            event: second,
            handler: () => {
              handled.push("second");
              return {};
            },
          });
        }
      },
    });
    expect({ state: actor.state.name, handled }).toEqual({ state: "next", handled: ["first"] });
  });
});
