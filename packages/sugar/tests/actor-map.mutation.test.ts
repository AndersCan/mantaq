import { describe, test, expect, vi, afterEach } from "vite-plus/test";
import { Actor, event, state, VirtualClock } from "@mantaq/core";
import { ActorMap } from "../src/actors/actor-map.ts";
import { matches } from "../src/actors/matches.ts";

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
    const map = new ActorMap();
    const toggle = event("toggle")();
    const on = state("on")();
    const off = state("off")();
    let signal: AbortSignal | undefined;

    const oldActor = new Actor({
      inputs: [toggle],
      states: [off, on],
      initial: off,
      setup: (m) => {
        m.on(off, toggle, () => ({ state: on }));
        m.effect(on, ({ signal: s }) => {
          signal = s;
        });
      },
    });

    map.spawn("a", () => oldActor);
    map.send("a", toggle.create());
    expect(signal?.aborted).toBe(false);

    map.spawn("a", () => makeActor("new").actor);
    expect(signal?.aborted).toBe(true);
  });

  test("re-spawn silently replaces and aborts the old actor", () => {
    const map = new ActorMap();
    const toggle = event("toggle")();
    const on = state("on")();
    const off = state("off")();
    let signal: AbortSignal | undefined;

    const oldActor = new Actor({
      inputs: [toggle],
      states: [off, on],
      initial: off,
      setup: (m) => {
        m.on(off, toggle, () => ({ state: on }));
        m.effect(on, ({ signal: s }) => {
          signal = s;
        });
      },
    });

    map.spawn("a", () => oldActor);
    map.send("a", toggle.create());
    expect(signal?.aborted).toBe(false);

    map.spawn("a", () => makeActor("b").actor);
    expect(signal?.aborted).toBe(true);
    expect(map.has("a")).toBe(true);
    expect(map.size).toBe(1);
  });

  test("after kill, can re-spawn with same key", () => {
    const map = new ActorMap();
    map.spawn("a", () => makeActor("a").actor);
    expect(map.has("a")).toBe(true);

    map.kill("a");
    expect(map.has("a")).toBe(false);

    map.spawn("a", () => makeActor("b").actor);
    expect(map.has("a")).toBe(true);
    expect(map.size).toBe(1);
  });

  test("re-spawn replaces actor - new actor responds to events", () => {
    const map = new ActorMap();
    const { actor: oldActor, toggle: oldToggle } = makeActor("old");
    map.spawn("a", () => oldActor);
    map.send("a", oldToggle.create());
    expect(matches(oldActor, "on")).toBe(true);

    const { actor: newActor, toggle: newToggle } = makeActor("new");
    map.spawn("a", () => newActor);

    expect(matches(newActor, "off")).toBe(true);
    map.send("a", newToggle.create());
    expect(matches(newActor, "on")).toBe(true);
  });

  test("re-spawn kills old actor effects and new actor is functional", () => {
    const toggle1 = event("toggle1")();
    const off1 = state("off1")();
    const on1 = state("on1")();
    let effectCount = 0;

    const map = new ActorMap();
    map.spawn(
      "a",
      () =>
        new Actor({
          inputs: [toggle1],
          outputs: [],
          internal: [],
          context: {},
          states: [off1, on1],
          initial: off1,
          setup: (m) => {
            m.on(off1, toggle1, () => ({ state: on1 }));
            m.effect(on1, () => {
              effectCount++;
            });
          },
        }),
    );

    map.send("a", toggle1.create());
    expect(effectCount).toBe(1);

    effectCount = 0;
    const toggle2 = event("toggle2")();
    const off2 = state("off2")();
    const on2 = state("on2")();
    map.spawn(
      "a",
      () =>
        new Actor({
          inputs: [toggle2],
          outputs: [],
          internal: [],
          context: {},
          states: [off2, on2],
          initial: off2,
          setup: (m) => {
            m.on(off2, toggle2, () => ({ state: on2 }));
            m.effect(on2, () => {
              effectCount += 10;
            });
          },
        }),
    );

    map.send("a", toggle2.create());
    expect(effectCount).toBe(10);
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
      const map = new DevActorMap();
      const toggle = event("toggle")();
      const on = state("on")();
      const off = state("off")();
      let signal: AbortSignal | undefined;

      const oldActor = new Actor({
        inputs: [toggle],
        states: [off, on],
        initial: off,
        setup: (m) => {
          m.on(off, toggle, () => ({ state: on }));
          m.effect(on, ({ signal: s }) => {
            signal = s;
          });
        },
      });

      map.spawn("a", () => oldActor);
      map.send("a", toggle.create());
      expect(signal?.aborted).toBe(false);

      map.spawn("a", () => makeActor("new").actor);
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

  test("send to a missing key is a no-op", () => {
    const map = new ActorMap();
    expect(() => map.send("missing", { type: "x" })).not.toThrow();
  });

  test("kill of a missing key is a no-op", () => {
    const map = new ActorMap();
    expect(() => map.kill("missing")).not.toThrow();
  });

  test("keys lists spawned keys and size counts them", () => {
    const map = new ActorMap();
    map.spawn("a", () => makeChild("a").actor);
    map.spawn("b", () => makeChild("b").actor);
    expect(map.keys().sort()).toEqual(["a", "b"]);
    expect(map.size).toBe(2);
    expect(map.has("a")).toBe(true);
    expect(map.has("z")).toBe(false);
  });

  test("ensure spawns only when the key is missing", () => {
    const map = new ActorMap();
    const factory = vi.fn(() => makeChild("a").actor);
    map.ensure("a", factory);
    map.ensure("a", factory);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(map.size).toBe(1);
  });

  test("snapshot returns the child snapshot and undefined for a missing key", () => {
    const map = new ActorMap();
    map.spawn("a", () => makeChild("a").actor);
    expect(map.snapshot("a")?.path[0]).toBe("off");
    expect(map.snapshot("missing")).toBeUndefined();
  });

  test("spawn with a parent wires child output to the parent send", () => {
    const sent: Array<{ type: string }> = [];
    const parent = {
      state: state("parent")(),
      clock: new VirtualClock(),
      regions: {},
      send: (e: unknown) => sent.push(e as { type: string }),
      snapshot: () => ({ path: ["parent"], regions: {} }),
      on: () => () => {},
      settled: async () => {},
    };
    const map = new ActorMap(parent as never);
    const { actor, toggle, output } = makeChild("a");
    map.spawn("a", () => actor);
    actor.send(toggle.create());
    expect(sent).toEqual([output.create({ from: "a" })]);
  });

  test("spawn with a parent and an unregistered child throws", () => {
    const parent = {
      state: state("parent")(),
      clock: new VirtualClock(),
      regions: {},
      send: () => {},
      snapshot: () => ({ path: ["parent"], regions: {} }),
      on: () => () => {},
      settled: async () => {},
    };
    const child = {
      state: state("c")(),
      clock: new VirtualClock(),
      regions: {},
      send: () => {},
      snapshot: () => ({ path: ["c"], regions: {} }),
      on: () => () => {},
      settled: async () => {},
    };
    const map = new ActorMap(parent as never);
    expect(() => map.spawn("a", () => child as never)).toThrow(/not registered/);
  });
});
