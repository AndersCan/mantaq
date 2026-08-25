import { describe, test, expect, vi, afterEach } from "vite-plus/test";
import { Actor, event, state, type AnyActor } from "@mantaq/core";
import { ActorMap } from "../src/actors/actor-map.ts";

describe("ActorMap mutation tests", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  function makeActor(id: string) {
    const toggle = event("toggle")();
    const output = event("output")<{ from: string }>();
    const off = state("off")();
    const on = state("on")();
    const actor = new Actor({
      inputs: [toggle],
      outputs: [output],
      internal: [],
      context: {},
      states: [off, on],
      initial: off,
      setup: (m) => {
        m.on(off, toggle, () => ({ state: on, emit: [output.create({ from: id })] }));
        m.on(on, toggle, () => ({ state: off }));
      },
    });
    return { actor, toggle, output, off, on };
  }

  // ── Default test env ──

  test("re-spawn aborts old actor effects", () => {
    const toggle = event("toggle")();
    const on = state("on")();
    const off = state("off")();
    let signal: AbortSignal | undefined;
    const map = new ActorMap(
      () =>
        new Actor({
          inputs: [toggle],
          context: {},
          states: [off, on],
          initial: off,
          setup: (m) => {
            m.on(off, toggle, () => ({ state: on }));
            m.effect(on, {
              name: "captureSignal",
              fn: ({ signal: s }) => {
                signal = s;
              },
            });
          },
        }),
    );
    map.spawn("a");
    map.send("a", toggle.create());
    expect(signal?.aborted).toBe(false);

    map.spawn("a");
    expect(signal?.aborted).toBe(true);
  });

  test("re-spawn silently replaces and aborts the old actor", () => {
    const toggle = event("toggle")();
    const on = state("on")();
    const off = state("off")();
    let signal: AbortSignal | undefined;
    const map = new ActorMap(
      () =>
        new Actor({
          inputs: [toggle],
          context: {},
          states: [off, on],
          initial: off,
          setup: (m) => {
            m.on(off, toggle, () => ({ state: on }));
            m.effect(on, {
              name: "captureSignal",
              fn: ({ signal: s }) => {
                signal = s;
              },
            });
          },
        }),
    );
    map.spawn("a");
    map.send("a", toggle.create());
    expect(signal?.aborted).toBe(false);

    map.spawn("a");
    expect(signal?.aborted).toBe(true);
    expect(map.has("a")).toBe(true);
    expect(map.size).toBe(1);
  });

  test("after kill, can re-spawn with same key", () => {
    const map = new ActorMap((id) => makeActor(id).actor);
    map.spawn("a");
    expect(map.has("a")).toBe(true);

    map.kill("a");
    expect(map.has("a")).toBe(false);

    map.spawn("a");
    expect(map.has("a")).toBe(true);
    expect(map.size).toBe(1);
  });

  test("re-spawn replaces actor - the new instance responds to events", () => {
    const map = new ActorMap((id) => makeActor(id).actor);
    const { toggle } = makeActor("a");
    map.spawn("a");
    map.send("a", toggle.create());
    expect(map.snapshot("a")?.path).toEqual(["on"]);

    map.spawn("a");
    expect(map.snapshot("a")?.path).toEqual(["off"]);
    map.send("a", toggle.create());
    expect(map.snapshot("a")?.path).toEqual(["on"]);
  });

  test("re-spawn kills old actor effects and the fresh instance is functional", () => {
    const toggle = event("toggle")();
    const off = state("off")();
    const on = state("on")();
    let effectCount = 0;
    const map = new ActorMap(
      () =>
        new Actor({
          inputs: [toggle],
          outputs: [],
          internal: [],
          context: {},
          states: [off, on],
          initial: off,
          setup: (m) => {
            m.on(off, toggle, () => ({ state: on }));
            m.effect(on, {
              name: "countEffect",
              fn: () => {
                effectCount++;
              },
            });
          },
        }),
    );

    map.spawn("a");
    map.send("a", toggle.create());
    expect(effectCount).toBe(1);

    map.spawn("a");
    map.send("a", toggle.create());
    expect(effectCount).toBe(2);
  });

  // ── Dev env (NODE_ENV=development) ──

  async function loadDevActorMap() {
    vi.resetModules();
    process.env.NODE_ENV = "development";
    const mod = await import("../src/actors/actor-map.ts");
    return mod.ActorMap;
  }

  function cleanupDevMode() {
    delete process.env.NODE_ENV;
    vi.resetModules();
  }

  test("re-spawn aborts old actor effects in development mode", async () => {
    const DevActorMap = await loadDevActorMap();
    try {
      const toggle = event("toggle")();
      const on = state("on")();
      const off = state("off")();
      let signal: AbortSignal | undefined;
      const map = new DevActorMap(
        () =>
          new Actor({
            inputs: [toggle],
            context: {},
            states: [off, on],
            initial: off,
            setup: (m) => {
              m.on(off, toggle, () => ({ state: on }));
              m.effect(on, {
                name: "captureSignal",
                fn: ({ signal: s }) => {
                  signal = s;
                },
              });
            },
          }),
      );

      map.spawn("a");
      map.send("a", toggle.create());
      expect(signal?.aborted).toBe(false);

      map.spawn("a");
      expect(signal?.aborted).toBe(true);
    } finally {
      cleanupDevMode();
    }
  });
});

describe("ActorMap directed mutation tests", () => {
  function makeChild(id: string) {
    const toggle = event("toggle")();
    const output = event("output")<{ from: string }>();
    const off = state("off")();
    const on = state("on")();
    const actor = new Actor({
      inputs: [toggle],
      outputs: [output],
      internal: [],
      context: {},
      states: [off, on],
      initial: off,
      setup: (m) => {
        m.on(off, toggle, () => ({ state: on, emit: [output.create({ from: id })] }));
        m.on(on, toggle, () => ({ state: off }));
      },
    });
    return { actor, toggle, output };
  }

  const childMap = () => new ActorMap((id) => makeChild(id).actor);

  test("send to a missing key is a no-op", () => {
    const map = childMap();
    expect(() => map.send("missing", { type: "x" })).not.toThrow();
  });

  test("kill of a missing key is a no-op", () => {
    const map = childMap();
    expect(() => map.kill("missing")).not.toThrow();
  });

  test("keys lists spawned keys and size counts them", () => {
    const map = childMap();
    map.spawn("a");
    map.spawn("b");
    expect(map.keys().sort()).toEqual(["a", "b"]);
    expect(map.size).toBe(2);
    expect(map.has("a")).toBe(true);
    expect(map.has("z")).toBe(false);
  });

  test("spawn passes the key to the factory", () => {
    const factory = vi.fn((id: string) => makeChild(id).actor);
    const map = new ActorMap(factory);
    map.spawn("x");
    map.spawn("y");
    expect(factory).toHaveBeenNthCalledWith(1, "x");
    expect(factory).toHaveBeenNthCalledWith(2, "y");
  });

  test("ensure spawns only when the key is missing", () => {
    const factory = vi.fn((id: string) => makeChild(id).actor);
    const map = new ActorMap(factory);
    map.ensure("a");
    map.ensure("a");
    expect(factory).toHaveBeenCalledTimes(1);
    expect(map.size).toBe(1);
  });

  test("snapshot returns the child snapshot and undefined for a missing key", () => {
    const map = childMap();
    map.spawn("a");
    expect(map.snapshot("a")?.path[0]).toBe("off");
    expect(map.snapshot("missing")).toBeUndefined();
  });

  test("a throwing factory propagates out of spawn", () => {
    const map = new ActorMap(() => {
      throw new Error("factory boom");
    });
    expect(() => map.spawn("a")).toThrow("factory boom");
  });
});

describe("ActorMap autoReap directed mutation tests", () => {
  function finalChild() {
    const toggle = event("toggle")();
    const off = state("off")();
    const on = state("on")().final();
    return {
      actor: new Actor({
        inputs: [toggle],
        context: {},
        states: [off, on],
        initial: off,
        setup: (m) => m.on(off, toggle, () => ({ state: on })),
      }),
      toggle,
    };
  }

  const reapingMap = () => {
    const toggle = event("toggle")();
    const off = state("off")();
    const on = state("on")().final();
    return new ActorMap(
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
  };

  test("autoReap is off by default — a completed child lingers", () => {
    const map = new ActorMap(() => finalChild().actor);
    const { toggle } = finalChild();
    map.spawn("a");
    map.send("a", toggle.create());
    expect(map.has("a")).toBe(true);
    expect(map.size).toBe(1);
  });

  test("autoReap removes a child that reaches a final state", () => {
    const map = reapingMap();
    const { toggle } = finalChild();
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
            m.effect(init, { name: "emitTick", fn: ({ emit }) => emit(tick.create()) });
            m.on(init, tick, () => ({ state: done }));
          },
        }),
      { autoReap: true },
    );
    map.spawn("a");
    expect(map.size).toBe(0);
  });

  test("autoReap does not reap a re-spawned child on the old child's done", () => {
    const map = reapingMap();
    const { toggle } = finalChild();
    map.spawn("a");
    map.send("a", toggle.create());
    expect(map.has("a")).toBe(false);

    map.spawn("a");
    map.send("a", toggle.create());
    expect(map.has("a")).toBe(false);
  });

  test("autoReap disposes a child already final at spawn", async () => {
    const start = state("start")();
    const done = state("done")().final();
    const go = event("GO")();
    let child: AnyActor | undefined;
    const disposed = vi.fn();
    const map = new ActorMap(
      () => {
        child = new Actor({
          inputs: [],
          internal: [go],
          context: {},
          states: [start, done],
          initial: start,
          setup: (m) => {
            m.on(start, go, () => ({ state: done }));
            m.effect(start, { name: "emitGo", fn: ({ emit }) => emit(go.create()) });
          },
        });
        return child;
      },
      { autoReap: true },
    );
    map.spawn("x");
    if (child) vi.spyOn(child, "dispose").mockImplementation(disposed);
    expect(map.has("x")).toBe(false);
    // disposal is deferred to a microtask to avoid reentrancy during spawn
    await Promise.resolve();
    await Promise.resolve();
    expect(disposed).toHaveBeenCalled();
  });
});
