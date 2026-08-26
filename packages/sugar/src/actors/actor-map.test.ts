import { broadcast } from "../transitions/broadcast.ts";
import { createActorMap } from "./actor-map.ts";
import type { ActorMapChild } from "./actor-map.ts";
import { Actor, VirtualClock, event, state } from "@mantaq/core";
import type { Snapshot } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface ChildStats {
  disposeCalls: () => number;
  doneSubs: () => number;
}

function fakeChild(
  stats: ChildStats,
  { done }: { done?: boolean } = {},
): ActorMapChild & { emitDone(): void } {
  const doneListeners = new Set<() => void>();
  let disposeCalls = 0;
  stats.disposeCalls = () => disposeCalls;
  stats.doneSubs = () => doneListeners.size;
  return {
    snapshot(): Snapshot {
      return { path: ["off"], context: {}, regions: {}, done: done === true };
    },
    on(eventName, { fn }: { fn: () => void }) {
      if (eventName === "done") doneListeners.add(fn);
      return () => {
        doneListeners.delete(fn);
      };
    },
    send() {},
    dispose() {
      disposeCalls += 1;
    },
    emitDone() {
      for (const listener of Array.from(doneListeners)) listener();
    },
  };
}

describe("ActorMap", () => {
  function makeActor(actorKey: string) {
    const toggle = event("toggle")();
    const output = event("output")<{ from: string }>();
    const off = state("off")();
    const onState = state("on")();
    const actor = Actor({
      inputs: [toggle],
      outputs: [output],
      internal: [],
      context: { id: actorKey },
      states: [off, onState],
      initial: off,
      setup: (m) => {
        m.on(off, {
          eventRef: toggle,
          handler: () => ({ state: onState, emit: [output.create({ from: actorKey })] }),
        });
        m.on(onState, { eventRef: toggle, handler: () => ({ state: off }) });
      },
    });
    return { actor, toggle, output, off, on: onState };
  }

  function actorMap() {
    return createActorMap((id) => makeActor(id).actor);
  }

  test("adds a child to the map under its key", () => {
    const map = actorMap();
    map.spawn("a");
    expect(map.keys()).toEqual(["a"]);
  });

  test("creates a fresh actor per key", () => {
    const map = actorMap();
    map.spawn("a");
    map.spawn("b");
    expect({
      keys: map.keys().sort(),
      aContext: map.snapshot("a")?.context,
      bContext: map.snapshot("b")?.context,
    }).toEqual({ keys: ["a", "b"], aContext: { id: "a" }, bContext: { id: "b" } });
  });

  test("updates the child state on send", () => {
    const map = actorMap();
    const { toggle } = makeActor("a");
    map.spawn("a");
    expect({
      before: map.snapshot("a")?.path,
      after: (map.send("a", toggle.create()), map.snapshot("a")?.path),
    }).toEqual({ before: ["off"], after: ["on"] });
  });

  test("removes a child on kill", () => {
    const map = actorMap();
    map.spawn("a");
    expect(map.keys()).toEqual(["a"]);
    map.kill("a");
    expect(map.keys()).toEqual([]);
  });

  test("updates size as children spawn and get killed", () => {
    const map = actorMap();
    const sizes: number[] = [];
    sizes.push(map.size);
    map.spawn("a");
    sizes.push(map.size);
    map.spawn("b");
    sizes.push(map.size);
    map.kill("a");
    sizes.push(map.size);
    expect(sizes).toEqual([0, 1, 2, 1]);
  });

  test("returns true from has for an existing key", () => {
    const map = actorMap();
    map.spawn("a");
    expect(map.has("a")).toBe(true);
  });

  test("returns false from has for a missing key", () => {
    const map = actorMap();
    expect(map.has("a")).toBe(false);
  });

  test("returns false from has after kill", () => {
    const map = actorMap();
    map.spawn("a");
    map.kill("a");
    expect(map.has("a")).toBe(false);
  });

  test("does not throw when sending to a non-existent key", () => {
    const map = actorMap();
    expect(() => map.send("nonexistent", { type: "test" })).not.toThrow();
  });

  test("does not throw when killing a non-existent key", () => {
    const map = actorMap();
    expect(() => map.kill("nonexistent")).not.toThrow();
  });

  test("removes every live child and clears the map on dispose", () => {
    const tracked: Array<{ wasDisposed: () => boolean }> = [];
    const map = createActorMap((id) => {
      const actor = makeActor(id).actor;
      let disposed = false;
      const originalDispose = actor.dispose.bind(actor);
      actor.dispose = () => {
        disposed = true;
        originalDispose();
      };
      tracked.push({ wasDisposed: () => disposed });
      return actor;
    });
    map.spawn("a");
    map.spawn("b");
    expect(map.size).toBe(2);

    map.dispose();

    expect({ size: map.size, keys: map.keys() }).toEqual({ size: 0, keys: [] });
    for (const child of tracked) {
      expect(child.wasDisposed()).toBe(true);
    }
  });

  test("sets the done subscription count back to zero when disposing an autoReap map", () => {
    const stats: ChildStats = { disposeCalls: () => 0, doneSubs: () => 0 };
    const child = fakeChild(stats);
    const map = createActorMap(() => child, { autoReap: true });
    map.spawn("a");
    expect(stats.doneSubs()).toBe(1);

    map.dispose();

    expect({ doneSubs: stats.doneSubs(), size: map.size }).toEqual({
      doneSubs: 0,
      size: 0,
    });
  });

  test("keeps dispose safe to call on an empty map", () => {
    const map = actorMap();
    expect(() => map.dispose()).not.toThrow();
    expect(map.size).toBe(0);
  });

  test("keeps dispose idempotent when called twice", () => {
    const map = actorMap();
    map.spawn("a");
    map.dispose();
    expect(() => map.dispose()).not.toThrow();
    expect(map.size).toBe(0);
  });

  test("returns no snapshot for a killed child whose effects already ran once", () => {
    const clock = VirtualClock();
    const toggle = event("toggle")();
    const off = state("off")();
    const onState = state("on")();
    let effectRan = false;

    const map = createActorMap(() =>
      Actor({
        inputs: [toggle],
        outputs: [],
        internal: [],
        context: {},
        clock,
        states: [off, onState],
        initial: off,
        setup: (m) => {
          m.on(off, { eventRef: toggle, handler: () => ({ state: onState }) });
          m.effect(onState, {
            name: "markEffectRan",
            fn: () => {
              effectRan = true;
            },
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
    expect(effectRan).toBe(false);
  });

  test("creates the child when ensure finds no existing key", () => {
    let factoryCalls = 0;
    const map = createActorMap((id) => {
      factoryCalls++;
      return makeActor(id).actor;
    });
    map.ensure("a");
    expect(factoryCalls).toBe(1);
    expect(map.keys()).toEqual(["a"]);
  });

  test("calls the factory only once when ensure finds an existing child", () => {
    let factoryCalls = 0;
    const map = createActorMap((id) => {
      factoryCalls++;
      return makeActor(id).actor;
    });
    map.spawn("a");
    expect(factoryCalls).toBe(1);
    map.ensure("a");
    expect(factoryCalls).toBe(1);
    expect(map.keys()).toEqual(["a"]);
  });

  test("returns the child snapshot for a spawned key", () => {
    const map = actorMap();
    map.spawn("a");
    const snap = map.snapshot("a");
    expect(snap?.path).toEqual(["off"]);
  });

  test("returns undefined from snapshot for a missing key", () => {
    const map = actorMap();
    expect(map.snapshot("nonexistent")).toBeUndefined();
  });

  test("creates a fresh instance when re-spawning the same key", () => {
    const map = actorMap();
    map.spawn("a");
    const first = map.snapshot("a");
    map.spawn("a");
    const second = map.snapshot("a");
    expect({
      keys: map.keys(),
      first: first?.context,
      second: second?.context,
    }).toEqual({ keys: ["a"], first: { id: "a" }, second: { id: "a" } });
  });

  test("keeps a completed child when autoReap is off by default", () => {
    const toggle = event("toggle")();
    const off = state("off")();
    const onState = state("on")().final();
    const map = createActorMap(() =>
      Actor({
        inputs: [toggle],
        context: {},
        states: [off, onState],
        initial: off,
        setup: (m) => m.on(off, { eventRef: toggle, handler: () => ({ state: onState }) }),
      }),
    );
    map.spawn("a");
    map.send("a", toggle.create());
    expect({ has: map.has("a"), size: map.size }).toEqual({ has: true, size: 1 });
  });

  test("removes a child that reaches a final state under autoReap", () => {
    const toggle = event("toggle")();
    const off = state("off")();
    const onState = state("on")().final();
    const map = createActorMap(
      () =>
        Actor({
          inputs: [toggle],
          context: {},
          states: [off, onState],
          initial: off,
          setup: (m) => m.on(off, { eventRef: toggle, handler: () => ({ state: onState }) }),
        }),
      { autoReap: true },
    );
    map.spawn("a");
    expect(map.size).toBe(1);
    map.send("a", toggle.create());
    expect({ has: map.has("a"), size: map.size }).toEqual({ has: false, size: 0 });
  });

  test("removes a child that dies into __error under autoReap", () => {
    const goEvent = event("go")();
    const off = state("off")();
    const map = createActorMap(
      () =>
        Actor({
          inputs: [goEvent],
          context: {},
          states: [off],
          initial: off,
          setup: (m) =>
            // malformed JSON raises inside the transition, driving the child into __error
            m.on(off, { eventRef: goEvent, handler: () => JSON.parse("{") }),
        }),
      { autoReap: true },
    );
    map.spawn("a");
    map.send("a", goEvent.create());
    expect(map.has("a")).toBe(false);
  });

  test("removes a child that is already final at spawn under autoReap", () => {
    const init = state("init")();
    const done = state("done")().final();
    const tick = event("TICK")();
    const map = createActorMap(
      () =>
        Actor({
          inputs: [],
          internal: [tick],
          context: {},
          states: [init, done],
          initial: init,
          setup: (m) => {
            m.effect(init, { name: "emitTick", fn: ({ emit }) => emit(tick.create()) });
            m.on(init, { eventRef: tick, handler: () => ({ state: done }) });
          },
        }),
      { autoReap: true },
    );
    map.spawn("a");
    expect(map.size).toBe(0);
  });

  test("removes each completed child individually across re-spawns under autoReap", () => {
    const toggle = event("toggle")();
    const off = state("off")();
    const onState = state("on")().final();
    const map = createActorMap(
      () =>
        Actor({
          inputs: [toggle],
          context: {},
          states: [off, onState],
          initial: off,
          setup: (m) => m.on(off, { eventRef: toggle, handler: () => ({ state: onState }) }),
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

  test("sets disposed flags and zeroes done subscriptions for every completed child", async () => {
    const children: Array<{ stats: ChildStats; child: ReturnType<typeof fakeChild> }> = [];

    const map = createActorMap(
      () => {
        const stats: ChildStats = { disposeCalls: () => 0, doneSubs: () => 0 };
        const child = fakeChild(stats);
        children.push({ stats, child });
        return child;
      },
      { autoReap: true },
    );

    for (let index = 0; index < 10; index++) {
      map.spawn(`child-${index}`);
      children[children.length - 1]?.child.emitDone();
    }

    expect(map.size).toBe(0);
    await flush();
    const summaries = children.map((entry) => ({
      disposed: entry.stats.disposeCalls() > 0,
      doneSubs: entry.stats.doneSubs(),
    }));
    expect(summaries).toEqual(Array.from({ length: 10 }, () => ({ disposed: true, doneSubs: 0 })));
  });

  test("keeps a running child undisposed with its done subscription live", () => {
    const stats: ChildStats = { disposeCalls: () => 0, doneSubs: () => 0 };
    const child = fakeChild(stats);
    const map = createActorMap(() => child, { autoReap: true });

    map.spawn("a");
    expect({
      disposed: stats.disposeCalls() > 0,
      doneSubs: stats.doneSubs(),
      present: map.has("a"),
    }).toEqual({ disposed: false, doneSubs: 1, present: true });
  });

  test("updates every child state when broadcasting an event", () => {
    const map = actorMap();
    const { toggle } = makeActor("a");
    map.spawn("a");
    map.spawn("b");
    broadcast(map, toggle.create());
    expect([map.snapshot("a")?.path, map.snapshot("b")?.path]).toEqual([["on"], ["on"]]);
  });

  test("emits a child's outputs into the parent through the factory wiring", () => {
    const childOutput = event("childOutput")<{ data: string }>();
    const childOff = state("childOff")();
    const childOn = state("childOn")();
    const parentOff = state("parentOff")();
    const parentDone = state("parentDone")();
    const goEvent = event("go")();

    const parent = Actor({
      inputs: [childOutput],
      outputs: [],
      internal: [],
      context: {},
      states: [parentOff, parentDone],
      initial: parentOff,
      setup: (m) => {
        m.on(parentOff, { eventRef: childOutput, handler: () => ({ state: parentDone }) });
      },
    });

    const map = createActorMap(() => {
      const child = Actor({
        inputs: [goEvent],
        outputs: [childOutput],
        internal: [],
        context: {},
        states: [childOff, childOn],
        initial: childOff,
        setup: (m) => {
          m.on(childOff, {
            eventRef: goEvent,
            handler: () => ({
              state: childOn,
              emit: [childOutput.create({ data: "hello" })],
            }),
          });
        },
      });
      child.on("output", {
        fn: (emitted) => parent.inject(emitted),
      });
      return child;
    });
    map.spawn("child");

    map.send("child", goEvent.create());
    expect(parent.snapshot().path[0]).toBe("parentDone");
  });
});
