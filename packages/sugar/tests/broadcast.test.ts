import { expect, test, describe } from "vite-plus/test";
import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { broadcast, type SendableMap } from "../src/transitions/broadcast.ts";
import { ActorMap } from "../src/actors/actor-map.ts";
import { matches } from "../src/actors/matches.ts";

function mockMap(keys: string[], sent: Array<{ key: string; event: unknown }>): SendableMap {
  return {
    keys: () => keys,
    send: (key: string, event: unknown) => sent.push({ key, event }),
  };
}

describe("broadcast", () => {
  test("sends event to all children", () => {
    const sent: Array<{ key: string; event: unknown }> = [];
    const map = mockMap(["a", "b"], sent);

    broadcast(map, { id: "ping" });

    expect(sent).toEqual([
      { key: "a", event: { id: "ping" } },
      { key: "b", event: { id: "ping" } },
    ]);
  });

  test("empty map — no error", () => {
    const sent: Array<{ key: string; event: unknown }> = [];
    const map = mockMap([], sent);

    expect(() => broadcast(map, { id: "ping" })).not.toThrow();
    expect(sent).toEqual([]);
  });

  test("with ActorMap — sends event to all spawned actors", () => {
    const toggle = event("toggle")();
    const off = state("off")();
    const on = state("on")();
    const map = new ActorMap();
    const a1 = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: {},
      states: [off, on],
      initial: off,
      effects: {},
      transitions: { off: { toggle: () => ({ state: on }) } },
    });
    const a2 = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: {},
      states: [off, on],
      initial: off,
      effects: {},
      transitions: { off: { toggle: () => ({ state: on }) } },
    });
    map.spawn("a", () => a1);
    map.spawn("b", () => a2);

    broadcast(map, toggle.create({}));

    expect(matches(a1, "on")).toBe(true);
    expect(matches(a2, "on")).toBe(true);
  });

  test("with empty ActorMap — no-op", () => {
    const map = new ActorMap();
    expect(() => broadcast(map, { id: "ping" })).not.toThrow();
  });

  test("with different event types via ActorMap", () => {
    const toggle = event("toggle")();
    const reset = event("reset")();
    const off = state("off")();
    const on = state("on")();
    const map = new ActorMap();
    const a1 = new Actor({
      inputs: [toggle, reset],
      outputs: [],
      internal: [],
      context: {},
      states: [off, on],
      initial: off,
      effects: {},
      transitions: {
        off: { toggle: () => ({ state: on }) },
        on: { reset: () => ({ state: off }) },
      },
    });
    const a2 = new Actor({
      inputs: [toggle, reset],
      outputs: [],
      internal: [],
      context: {},
      states: [off, on],
      initial: on,
      effects: {},
      transitions: {
        off: { toggle: () => ({ state: on }) },
        on: { reset: () => ({ state: off }) },
      },
    });
    map.spawn("a", () => a1);
    map.spawn("b", () => a2);

    broadcast(map, toggle.create({}));
    expect(matches(a1, "on")).toBe(true);
    expect(matches(a2, "on")).toBe(true);

    broadcast(map, reset.create({}));
    expect(matches(a1, "off")).toBe(true);
    expect(matches(a2, "off")).toBe(true);
  });

  test("with ActorMap where some actors ignore event — does not throw", () => {
    const toggle = event("toggle")();
    const off = state("off")();
    const on = state("on")();
    const map = new ActorMap();
    const a1 = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: {},
      states: [off, on],
      initial: off,
      effects: {},
      transitions: { off: { toggle: () => ({ state: on }) } },
    });
    const a2 = new Actor({
      inputs: [],
      outputs: [],
      internal: [],
      context: {},
      states: [off, on],
      initial: off,
      effects: {},
      transitions: {},
    });
    map.spawn("a", () => a1);
    map.spawn("b", () => a2);

    expect(() => broadcast(map, toggle.create({}))).not.toThrow();
    expect(matches(a1, "on")).toBe(true);
    expect(matches(a2, "off")).toBe(true);
  });

  test("broadcast inside actor effect — integration with VirtualClock", () => {
    const clock = new VirtualClock();
    const ping = event("ping")();
    const pong = event("pong")();
    const idle = state("idle")();
    const done = state("done")();
    const childOff = state("childOff")();
    const childOn = state("childOn")();

    const map = new ActorMap();

    const child = new Actor({
      clock,
      inputs: [pong],
      outputs: [],
      internal: [],
      context: {},
      states: [childOff, childOn],
      initial: childOff,
      effects: {},
      transitions: { childOff: { pong: () => ({ state: childOn }) } },
    });
    map.spawn("child", () => child);

    const parent = new Actor({
      clock,
      inputs: [ping],
      outputs: [],
      internal: [],
      context: {},
      states: [idle, done],
      initial: idle,
      effects: {},
      transitions: {
        idle: {
          ping: () => {
            broadcast(map, pong.create({}));
            return { state: done };
          },
        },
      },
    });

    parent.send(ping.create({}));

    expect(matches(parent, "done")).toBe(true);
    expect(matches(child, "childOn")).toBe(true);
  });
});
