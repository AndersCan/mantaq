import { expect, test, describe } from "vite-plus/test";
import { Actor, event, state, VirtualClock } from "@mantaq/core";
import type { AnyActor } from "@mantaq/core";
import { setOutputHandler } from "@mantaq/core/internal";
import { ActorMap } from "../src/actors/actor-map.ts";
import { broadcast } from "../src/transitions/broadcast.ts";

describe("ActorMap", () => {
  function makeActor(id: string) {
    const toggle = event("toggle")();
    const output = event("output")<{ from: string }>();
    const off = state("off")();
    const on = state("on")();
    const actor = new Actor({
      inputs: [toggle],
      outputs: [output],
      internal: [],
      context: { id },
      states: [off, on],
      initial: off,
      setup: (m) => {
        m.on(off, toggle, () => ({ state: on, emit: [output.create({ from: id })] }));
        m.on(on, toggle, () => ({ state: off }));
      },
    });
    return { actor, toggle, output, off, on };
  }

  const actorMap = () => new ActorMap((id) => makeActor(id).actor);

  test("spawn adds child", () => {
    const map = actorMap();
    map.spawn("a");
    expect(map.keys()).toEqual(["a"]);
  });

  test("spawn creates a fresh actor per key", () => {
    const map = actorMap();
    map.spawn("a");
    map.spawn("b");
    expect(map.keys().sort()).toEqual(["a", "b"]);
    expect(map.snapshot("a")?.context).toEqual({ id: "a" });
    expect(map.snapshot("b")?.context).toEqual({ id: "b" });
  });

  test("send transitions child state", () => {
    const map = actorMap();
    const { toggle } = makeActor("a");
    map.spawn("a");
    expect(map.snapshot("a")?.path).toEqual(["off"]);
    map.send("a", toggle.create());
    expect(map.snapshot("a")?.path).toEqual(["on"]);
  });

  test("kill removes child", () => {
    const map = actorMap();
    map.spawn("a");
    expect(map.keys()).toEqual(["a"]);
    map.kill("a");
    expect(map.keys()).toEqual([]);
  });

  test("size returns number of children", () => {
    const map = actorMap();
    expect(map.size).toBe(0);
    map.spawn("a");
    expect(map.size).toBe(1);
    map.spawn("b");
    expect(map.size).toBe(2);
    map.kill("a");
    expect(map.size).toBe(1);
  });

  test("has returns true for existing key", () => {
    const map = actorMap();
    map.spawn("a");
    expect(map.has("a")).toBe(true);
  });

  test("has returns false for missing key", () => {
    const map = actorMap();
    expect(map.has("a")).toBe(false);
  });

  test("has returns false after kill", () => {
    const map = actorMap();
    map.spawn("a");
    map.kill("a");
    expect(map.has("a")).toBe(false);
  });

  test("send to non-existent key does not throw", () => {
    const map = actorMap();
    expect(() => map.send("nonexistent", { type: "test" })).not.toThrow();
  });

  test("kill non-existent key does not throw", () => {
    const map = actorMap();
    expect(() => map.kill("nonexistent")).not.toThrow();
  });

  test("kill aborts child effects", () => {
    const clock = new VirtualClock();
    const toggle = event("toggle")();
    const off = state("off")();
    const on = state("on")();
    let effectRan = false;

    const map = new ActorMap(
      () =>
        new Actor({
          inputs: [toggle],
          outputs: [],
          internal: [],
          context: {},
          clock,
          states: [off, on],
          initial: off,
          setup: (m) => {
            m.on(off, toggle, () => ({ state: on }));
            m.effect(on, () => {
              effectRan = true;
            });
          },
        }),
    );
    map.spawn("a");

    map.send("a", toggle.create());
    expect(effectRan).toBe(true);

    effectRan = false;
    map.kill("a");

    expect(map.snapshot("a")).toBeUndefined();
  });

  test("ensure spawns if not exists", () => {
    let factoryCalls = 0;
    const map = new ActorMap((id) => {
      factoryCalls++;
      return makeActor(id).actor;
    });
    map.ensure("a");
    expect(factoryCalls).toBe(1);
    expect(map.keys()).toEqual(["a"]);
  });

  test("ensure does not re-spawn existing child", () => {
    let factoryCalls = 0;
    const map = new ActorMap((id) => {
      factoryCalls++;
      return makeActor(id).actor;
    });
    map.spawn("a");
    expect(factoryCalls).toBe(1);
    map.ensure("a");
    expect(factoryCalls).toBe(1);
    expect(map.keys()).toEqual(["a"]);
  });

  test("snapshot returns child snapshot", () => {
    const map = actorMap();
    map.spawn("a");
    const snap = map.snapshot("a");
    expect(snap).toBeDefined();
    expect(snap!.path).toEqual(["off"]);
  });

  test("snapshot returns undefined for missing key", () => {
    const map = actorMap();
    expect(map.snapshot("nonexistent")).toBeUndefined();
  });

  test("re-spawn replaces the child with a fresh instance", () => {
    const map = actorMap();
    map.spawn("a");
    const first = map.snapshot("a");
    map.spawn("a");
    const second = map.snapshot("a");
    expect(map.keys()).toEqual(["a"]);
    expect(first?.context).toEqual({ id: "a" });
    expect(second?.context).toEqual({ id: "a" });
  });

  test("autoReap is off by default — completed child lingers", () => {
    const toggle = event("toggle")();
    const off = state("off")();
    const on = state("on")().final();
    const map = new ActorMap(
      () =>
        new Actor({
          inputs: [toggle],
          context: {},
          states: [off, on],
          initial: off,
          setup: (m) => m.on(off, toggle, () => ({ state: on })),
        }),
    );
    map.spawn("a");
    map.send("a", toggle.create());
    expect(map.has("a")).toBe(true);
    expect(map.size).toBe(1);
  });

  test("autoReap removes a child that reaches a final state", () => {
    const toggle = event("toggle")();
    const off = state("off")();
    const on = state("on")().final();
    const map = new ActorMap(
      () =>
        new Actor({
          inputs: [toggle],
          context: {},
          states: [off, on],
          initial: off,
          setup: (m) => m.on(off, toggle, () => ({ state: on })),
        }),
      { autoReap: true },
    );
    map.spawn("a");
    expect(map.size).toBe(1);
    map.send("a", toggle.create());
    expect(map.has("a")).toBe(false);
    expect(map.size).toBe(0);
  });

  test("autoReap removes a child that dies into __error", () => {
    const go = event("go")();
    const off = state("off")();
    const map = new ActorMap(
      () =>
        new Actor({
          inputs: [go],
          context: {},
          states: [off],
          initial: off,
          setup: (m) =>
            m.on(off, go, () => {
              throw new Error("boom");
            }),
        }),
      { autoReap: true },
    );
    map.spawn("a");
    map.send("a", go.create());
    expect(map.has("a")).toBe(false);
  });

  test("autoReap reaps a child already final at spawn", () => {
    const init = state("init")();
    const done = state("done")().final();
    const tick = event("TICK")();
    const map = new ActorMap(
      () =>
        new Actor({
          inputs: [],
          internal: [tick],
          context: {},
          states: [init, done],
          initial: init,
          setup: (m) => {
            m.effect(init, ({ emit }) => emit(tick.create()));
            m.on(init, tick, () => ({ state: done }));
          },
        }),
      { autoReap: true },
    );
    map.spawn("a");
    expect(map.size).toBe(0);
  });

  test("re-spawn after autoReap reaps only the new child", () => {
    const toggle = event("toggle")();
    const off = state("off")();
    const on = state("on")().final();
    const map = new ActorMap(
      () =>
        new Actor({
          inputs: [toggle],
          context: {},
          states: [off, on],
          initial: off,
          setup: (m) => m.on(off, toggle, () => ({ state: on })),
        }),
      { autoReap: true },
    );
    map.spawn("a");
    map.send("a", toggle.create());
    expect(map.has("a")).toBe(false);
    map.spawn("a");
    map.send("a", toggle.create());
    expect(map.has("a")).toBe(false);
  });

  test("broadcast sends event to all children", () => {
    const map = actorMap();
    const { toggle } = makeActor("a");
    map.spawn("a");
    map.spawn("b");
    broadcast(map, toggle.create());
    expect(map.snapshot("a")?.path).toEqual(["on"]);
    expect(map.snapshot("b")?.path).toEqual(["on"]);
  });

  test("factory wires child output to a receiver", () => {
    const childOutput = event("childOutput")<{ data: string }>();
    const childOff = state("childOff")();
    const childOn = state("childOn")();
    const parentOff = state("parentOff")();
    const parentDone = state("parentDone")();
    const go = event("go")();

    const parent = new Actor({
      inputs: [childOutput],
      outputs: [],
      internal: [],
      context: {},
      states: [parentOff, parentDone],
      initial: parentOff,
      setup: (m) => {
        m.on(parentOff, childOutput, () => ({ state: parentDone }));
      },
    });

    const map = new ActorMap(() => {
      const child = new Actor({
        inputs: [go],
        outputs: [childOutput],
        internal: [],
        context: {},
        states: [childOff, childOn],
        initial: childOff,
        setup: (m) => {
          m.on(childOff, go, () => ({
            state: childOn,
            emit: [childOutput.create({ data: "hello" })],
          }));
        },
      });
      setOutputHandler(child, (event) => (parent as AnyActor).send(event));
      return child;
    });
    map.spawn("child");

    map.send("child", go.create());
    expect(parent.snapshot().path[0]).toBe("parentDone");
  });
});
