import { expect, test, describe } from "vite-plus/test";
import { Actor, event, state, VirtualClock } from "@mantaq/core";
import { ActorMap } from "../src/actors/actor-map.ts";
import { broadcast } from "../src/transitions/broadcast.ts";
import { matches } from "../src/actors/matches.ts";

describe("ActorMap", () => {
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
      transitions: {
        off: { toggle: () => ({ state: on, emit: [output.create({ from: id })] }) },
        on: { toggle: () => ({ state: off }) },
      },
    });
    return { actor, toggle, output, off, on };
  }

  test("spawn adds child", () => {
    const map = new ActorMap();
    const { actor } = makeActor("a");
    map.spawn("a", () => actor);
    expect(map.keys()).toEqual(["a"]);
  });

  test("spawn multiple children", () => {
    const map = new ActorMap();
    map.spawn("a", () => makeActor("a").actor);
    map.spawn("b", () => makeActor("b").actor);
    expect(map.keys().sort()).toEqual(["a", "b"]);
  });

  test("send transitions child state", () => {
    const map = new ActorMap();
    const { actor, toggle } = makeActor("a");
    map.spawn("a", () => actor);
    expect(matches(actor, "off")).toBe(true);
    map.send("a", toggle.create());
    expect(matches(actor, "on")).toBe(true);
  });

  test("kill removes child", () => {
    const map = new ActorMap();
    map.spawn("a", () => makeActor("a").actor);
    expect(map.keys()).toEqual(["a"]);
    map.kill("a");
    expect(map.keys()).toEqual([]);
  });

  test("size returns number of children", () => {
    const map = new ActorMap();
    expect(map.size).toBe(0);
    map.spawn("a", () => makeActor("a").actor);
    expect(map.size).toBe(1);
    map.spawn("b", () => makeActor("b").actor);
    expect(map.size).toBe(2);
    map.kill("a");
    expect(map.size).toBe(1);
  });

  test("has returns true for existing key", () => {
    const map = new ActorMap();
    map.spawn("a", () => makeActor("a").actor);
    expect(map.has("a")).toBe(true);
  });

  test("has returns false for missing key", () => {
    const map = new ActorMap();
    expect(map.has("a")).toBe(false);
  });

  test("has returns false after kill", () => {
    const map = new ActorMap();
    map.spawn("a", () => makeActor("a").actor);
    map.kill("a");
    expect(map.has("a")).toBe(false);
  });

  test("send to non-existent key does not throw", () => {
    const map = new ActorMap();
    expect(() => map.send("nonexistent", { id: "test" })).not.toThrow();
  });

  test("kill non-existent key does not throw", () => {
    const map = new ActorMap();
    expect(() => map.kill("nonexistent")).not.toThrow();
  });

  test("kill aborts child effects", () => {
    const clock = new VirtualClock();
    const toggle = event("toggle")();
    const off = state("off")();
    const on = state("on")();
    let effectRan = false;

    const map = new ActorMap();
    map.spawn("a", () => {
      const a = new Actor({
        inputs: [toggle],
        outputs: [],
        internal: [],
        context: {},
        clock,
        states: [off, on],
        initial: off,
        effects: {
          on: [
            () => {
              effectRan = true;
            },
          ],
        },
        transitions: {
          off: { toggle: () => ({ state: on }) },
        },
      });
      return a;
    });

    map.send("a", toggle.create());
    expect(effectRan).toBe(true);

    effectRan = false;
    map.kill("a");

    expect(map.snapshot("a")).toBeUndefined();
  });

  test("ensure spawns if not exists", () => {
    const map = new ActorMap();
    const { actor } = makeActor("a");
    let factoryCalls = 0;
    map.ensure("a", () => {
      factoryCalls++;
      return actor;
    });
    expect(factoryCalls).toBe(1);
    expect(map.keys()).toEqual(["a"]);
  });

  test("ensure does not re-spawn existing child", () => {
    const map = new ActorMap();
    const { actor } = makeActor("a");
    map.spawn("a", () => actor);
    let factoryCalls = 0;
    map.ensure("a", () => {
      factoryCalls++;
      return makeActor("a").actor;
    });
    expect(factoryCalls).toBe(0);
    expect(map.keys()).toEqual(["a"]);
  });

  test("snapshot returns child snapshot", () => {
    const map = new ActorMap();
    const { actor } = makeActor("a");
    map.spawn("a", () => actor);
    const snap = map.snapshot("a");
    expect(snap).toBeDefined();
    expect(snap!.path).toEqual(["off"]);
  });

  test("snapshot returns undefined for missing key", () => {
    const map = new ActorMap();
    expect(map.snapshot("nonexistent")).toBeUndefined();
  });

  test("broadcast sends event to all children", () => {
    const map = new ActorMap();
    const { actor: a1, toggle } = makeActor("a");
    const { actor: a2 } = makeActor("b");
    map.spawn("a", () => a1);
    map.spawn("b", () => a2);
    broadcast(map, toggle.create());
    expect(matches(a1, "on")).toBe(true);
    expect(matches(a2, "on")).toBe(true);
  });

  test("child output wired to parent", () => {
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
      transitions: {
        parentOff: { childOutput: () => ({ state: parentDone }) },
      },
    });

    const map = new ActorMap(parent);
    map.spawn(
      "child",
      () =>
        new Actor({
          inputs: [go],
          outputs: [childOutput],
          internal: [],
          context: {},
          states: [childOff, childOn],
          initial: childOff,
          transitions: {
            childOff: {
              go: () => ({
                state: childOn,
                emit: [childOutput.create({ data: "hello" })],
              }),
            },
          },
        }),
    );

    map.send("child", go.create());
    expect(matches(parent, "parentDone")).toBe(true);
  });
});
