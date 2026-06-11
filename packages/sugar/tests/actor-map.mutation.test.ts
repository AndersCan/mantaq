import { describe, test, expect, vi, afterEach } from "vite-plus/test";
import { Actor, event, state } from "@mantaq/core";
import { ActorMap } from "../src/actors/actor-map.ts";
import { matches } from "../src/actors/matches.ts";

describe("ActorMap mutation tests", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  function makeActor(id: string) {
    const toggle = event("toggle")();
    const output = event("output")();
    const off = state("off")();
    const on = state("on")();
    const actor = new Actor({
      inputs: [toggle],
      outputs: [output],
      internal: [],
      context: {},
      states: [off, on],
      initial: off,
      effects: {},
      transitions: {
        off: { toggle: () => ({ state: on, emit: [output.create({ from: id })] }) },
        on: { toggle: () => ({ state: off }) },
      },
    });
    return { actor, toggle, output, off, on };
  }

  // ── Default test env (NODE_ENV=test, IS_DEV=false) ──

  test("re-spawn calls __abortEffects on old actor", () => {
    const map = new ActorMap();
    const oldActor = makeActor("old").actor;
    const abortSpy = vi.spyOn(oldActor, "__abortEffects");

    map.spawn("a", () => oldActor);
    expect(abortSpy).not.toHaveBeenCalled();

    map.spawn("a", () => makeActor("new").actor);
    expect(abortSpy).toHaveBeenCalledOnce();
  });

  test("re-spawn does not call console.warn when IS_DEV is false", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const map = new ActorMap();

    map.spawn("a", () => makeActor("a").actor);
    warnSpy.mockClear();

    map.spawn("a", () => makeActor("b").actor);
    expect(warnSpy).not.toHaveBeenCalled();
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
    map.send("a", oldToggle);
    expect(matches(oldActor, "on")).toBe(true);

    const { actor: newActor, toggle: newToggle } = makeActor("new");
    map.spawn("a", () => newActor);

    expect(matches(newActor, "off")).toBe(true);
    map.send("a", newToggle);
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
          effects: {
            on1: [
              () => {
                effectCount++;
              },
            ],
          },
          transitions: { off1: { toggle1: () => ({ state: on1 }) } },
        }),
    );

    map.send("a", toggle1.create({}));
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
          effects: {
            on2: [
              () => {
                effectCount += 10;
              },
            ],
          },
          transitions: { off2: { toggle2: () => ({ state: on2 }) } },
        }),
    );

    map.send("a", toggle2.create({}));
    expect(effectCount).toBe(10);
  });

  // ── Dev env (NODE_ENV=development, IS_DEV=true) ──

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

  test("re-spawn warns in development mode with correct message", async () => {
    const DevActorMap = await loadDevActorMap();
    try {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const map = new DevActorMap();

      map.spawn("a", () => makeActor("a").actor);
      map.spawn("a", () => makeActor("b").actor);

      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy).toHaveBeenCalledWith(
        '[ActorMap] spawning over existing key "a". Old actor will be aborted.',
      );
    } finally {
      cleanupDevMode();
    }
  });

  test("first spawn does not warn in development mode", async () => {
    const DevActorMap = await loadDevActorMap();
    try {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const map = new DevActorMap();

      map.spawn("a", () => makeActor("a").actor);

      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      cleanupDevMode();
    }
  });

  test("re-spawn kills old actor in development mode", async () => {
    const DevActorMap = await loadDevActorMap();
    try {
      const map = new DevActorMap();
      const oldActor = makeActor("old").actor;
      const abortSpy = vi.spyOn(oldActor, "__abortEffects");

      map.spawn("a", () => oldActor);
      map.spawn("a", () => makeActor("new").actor);

      expect(abortSpy).toHaveBeenCalledOnce();
    } finally {
      cleanupDevMode();
    }
  });
});
