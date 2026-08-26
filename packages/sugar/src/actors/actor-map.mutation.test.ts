import { createActorMap } from "./actor-map.ts";
import type { ActorMapChild } from "./actor-map.ts";
import { Actor, event, state } from "@mantaq/core";
import { describe, expect, test, vi } from "vite-plus/test";

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
    snapshot() {
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

describe("ActorMap mutation tests", () => {
  function makeActor(actorKey: string) {
    const toggle = event("toggle")();
    const output = event("output")<{ from: string }>();
    const off = state("off")();
    const onState = state("on")();
    const actor = Actor({
      inputs: [toggle],
      outputs: [output],
      internal: [],
      context: {},
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

  function capturingActor(capture: { signal?: AbortSignal }) {
    const toggle = event("toggle")();
    const onState = state("on")();
    const off = state("off")();
    return Actor({
      inputs: [toggle],
      context: {},
      states: [off, onState],
      initial: off,
      setup: (m) => {
        m.on(off, { eventRef: toggle, handler: () => ({ state: onState }) });
        m.effect(onState, {
          name: "captureSignal",
          fn: ({ signal }) => {
            capture.signal = signal;
          },
        });
      },
    });
  }

  test("removes the old actor by aborting its effects when re-spawning the same key", () => {
    const toggle = event("toggle")();
    const captured: { signal?: AbortSignal } = {};
    const map = createActorMap(() => capturingActor(captured));
    map.spawn("a");
    map.send("a", toggle.create());
    const beforeRespawn = captured.signal?.aborted;

    map.spawn("a");
    expect({ beforeRespawn, aborted: captured.signal?.aborted }).toEqual({
      beforeRespawn: false,
      aborted: true,
    });
  });

  test("removes and replaces the old actor silently when re-spawning the same key", () => {
    const toggle = event("toggle")();
    const captured: { signal?: AbortSignal } = {};
    const map = createActorMap(() => capturingActor(captured));
    map.spawn("a");
    map.send("a", toggle.create());
    expect(captured.signal?.aborted).toBe(false);

    map.spawn("a");
    expect({ aborted: captured.signal?.aborted, has: map.has("a"), size: map.size }).toEqual({
      aborted: true,
      has: true,
      size: 1,
    });
  });

  test("keeps re-spawning the same key working after kill", () => {
    const map = createActorMap((id) => makeActor(id).actor);
    map.spawn("a");
    expect(map.has("a")).toBe(true);

    map.kill("a");
    expect(map.has("a")).toBe(false);

    map.spawn("a");
    expect({ has: map.has("a"), size: map.size }).toEqual({ has: true, size: 1 });
  });

  test("returns answers from the new instance after replacing an actor", () => {
    const map = createActorMap((id) => makeActor(id).actor);
    const { toggle } = makeActor("a");
    map.spawn("a");
    map.send("a", toggle.create());
    expect(map.snapshot("a")?.path).toEqual(["on"]);

    map.spawn("a");
    expect({
      freshPath: map.snapshot("a")?.path,
      afterSend: (map.send("a", toggle.create()), map.snapshot("a")?.path),
    }).toEqual({ freshPath: ["off"], afterSend: ["on"] });
  });

  test("removes the old actor's effects so only the fresh instance counts runs", () => {
    const toggle = event("toggle")();
    const off = state("off")();
    const onState = state("on")();
    let effectCount = 0;
    const map = createActorMap(() =>
      Actor({
        inputs: [toggle],
        outputs: [],
        internal: [],
        context: {},
        states: [off, onState],
        initial: off,
        setup: (m) => {
          m.on(off, { eventRef: toggle, handler: () => ({ state: onState }) });
          m.effect(onState, {
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
});

describe("ActorMap directed mutation tests", () => {
  function makeChild(actorKey: string) {
    const toggle = event("toggle")();
    const output = event("output")<{ from: string }>();
    const off = state("off")();
    const onState = state("on")();
    const actor = Actor({
      inputs: [toggle],
      outputs: [output],
      internal: [],
      context: {},
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
    return { actor, toggle, output };
  }

  function childMap() {
    return createActorMap((id) => makeChild(id).actor);
  }

  test("keeps sending to a missing key harmless", () => {
    const map = childMap();
    expect(() => map.send("missing", { type: "x" })).not.toThrow();
  });

  test("keeps killing a missing key harmless", () => {
    const map = childMap();
    expect(() => map.kill("missing")).not.toThrow();
  });

  test("returns spawned keys and counts them in size", () => {
    const map = childMap();
    map.spawn("a");
    map.spawn("b");
    expect({ keys: map.keys().sort(), size: map.size, a: map.has("a"), z: map.has("z") }).toEqual({
      keys: ["a", "b"],
      size: 2,
      a: true,
      z: false,
    });
  });

  test("calls the factory with the spawn key", () => {
    const factory = vi.fn((id: string) => makeChild(id).actor);
    const map = createActorMap(factory);
    map.spawn("x");
    map.spawn("y");
    expect(factory).toHaveBeenNthCalledWith(1, "x");
    expect(factory).toHaveBeenNthCalledWith(2, "y");
  });

  test("creates only once through ensure for an existing key", () => {
    const factory = vi.fn((id: string) => makeChild(id).actor);
    const map = createActorMap(factory);
    map.ensure("a");
    map.ensure("a");
    expect(factory).toHaveBeenCalledTimes(1);
    expect(map.size).toBe(1);
  });

  test("returns the child snapshot and undefined for a missing key", () => {
    const map = childMap();
    map.spawn("a");
    expect([map.snapshot("missing"), map.snapshot("a")?.path[0]]).toEqual([undefined, "off"]);
  });

  test("throws when the factory raises inside spawn", () => {
    // malformed JSON raises inside the factory, mirroring any constructor crash
    const map = createActorMap(() => JSON.parse("{"));
    expect(() => map.spawn("a")).toThrow(SyntaxError);
  });
});

describe("ActorMap autoReap directed mutation tests", () => {
  function finalChild() {
    const toggle = event("toggle")();
    const off = state("off")();
    const onState = state("on")().final();
    return {
      actor: Actor({
        inputs: [toggle],
        context: {},
        states: [off, onState],
        initial: off,
        setup: (m) => m.on(off, { eventRef: toggle, handler: () => ({ state: onState }) }),
      }),
      toggle,
    };
  }

  function reapingMap() {
    const toggle = event("toggle")();
    const off = state("off")();
    const onState = state("on")().final();
    return createActorMap(
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
  }

  test("keeps a completed child lingering when autoReap is off by default", () => {
    const map = createActorMap(() => finalChild().actor);
    const { toggle } = finalChild();
    map.spawn("a");
    map.send("a", toggle.create());
    expect({ has: map.has("a"), size: map.size }).toEqual({ has: true, size: 1 });
  });

  test("removes a child that reaches a final state under autoReap", () => {
    const map = reapingMap();
    const { toggle } = finalChild();
    map.spawn("a");
    expect(map.size).toBe(1);
    map.send("a", toggle.create());
    expect({ has: map.has("a"), size: map.size }).toEqual({ has: false, size: 0 });
  });

  test("removes a child that dies into __error under autoReap", () => {
    const goEvent = event("go")();
    const off = state("off")();
    // malformed JSON raises inside the transition, driving the child into __error
    const map = createActorMap(
      () =>
        Actor({
          inputs: [goEvent],
          context: {},
          states: [off],
          initial: off,
          setup: (m) => m.on(off, { eventRef: goEvent, handler: () => JSON.parse("{") }),
        }),
      { autoReap: true },
    );
    map.spawn("a");
    map.send("a", goEvent.create());
    expect(map.has("a")).toBe(false);
  });

  test("removes a child already final at spawn under autoReap", () => {
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

  test("removes only the re-spawned child when the old child's done fires", () => {
    const map = reapingMap();
    const { toggle } = finalChild();
    map.spawn("a");
    map.send("a", toggle.create());
    expect(map.has("a")).toBe(false);

    map.spawn("a");
    map.send("a", toggle.create());
    expect(map.has("a")).toBe(false);
  });

  test("removes a child already final at spawn after the deferred microtask", async () => {
    const stats: ChildStats = { disposeCalls: () => 0, doneSubs: () => 0 };
    const child = fakeChild(stats, { done: true });
    const map = createActorMap(() => child, { autoReap: true });
    map.spawn("x");
    expect(map.has("x")).toBe(false);
    // disposal is deferred to a microtask to avoid reentrancy during spawn
    await Promise.resolve();
    await Promise.resolve();
    expect(stats.disposeCalls()).toBe(1);
  });
});
