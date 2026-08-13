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

    broadcast(map, { type: "ping" });

    expect(sent).toEqual([
      { key: "a", event: { type: "ping" } },
      { key: "b", event: { type: "ping" } },
    ]);
  });

  test("empty map — no error", () => {
    const sent: Array<{ key: string; event: unknown }> = [];
    const map = mockMap([], sent);

    expect(() => broadcast(map, { type: "ping" })).not.toThrow();
    expect(sent).toEqual([]);
  });

  function makeChild() {
    const toggle = event("toggle")();
    const off = state("off")();
    const on = state("on")();
    return {
      actor: new Actor({
        inputs: [toggle],
        states: [off, on],
        initial: off,
        setup: (m) => {
          m.on(off, toggle, () => ({ state: on }));
        },
      }),
      toggle,
    };
  }

  test("with ActorMap — sends event to all spawned actors", () => {
    const map = new ActorMap(() => makeChild().actor);
    const { toggle } = makeChild();
    map.spawn("a");
    map.spawn("b");

    broadcast(map, toggle.create());

    expect(map.snapshot("a")?.path[0]).toBe("on");
    expect(map.snapshot("b")?.path[0]).toBe("on");
  });

  test("with empty ActorMap — no-op", () => {
    const map = new ActorMap(() => makeChild().actor);
    expect(() => broadcast(map, { type: "ping" })).not.toThrow();
  });

  test("with ActorMap — fan-out then reset keeps every child in step", () => {
    const toggle = event("toggle")();
    const reset = event("reset")();
    const off = state("off")();
    const on = state("on")();
    const map = new ActorMap(
      () =>
        new Actor({
          inputs: [toggle, reset],
          context: {},
          states: [off, on],
          initial: off,
          setup: (m) => {
            m.on(off, toggle, () => ({ state: on }));
            m.on(on, reset, () => ({ state: off }));
          },
        }),
    );
    map.spawn("a");
    map.spawn("b");

    broadcast(map, toggle.create());
    expect(map.snapshot("a")?.path[0]).toBe("on");
    expect(map.snapshot("b")?.path[0]).toBe("on");

    broadcast(map, reset.create());
    expect(map.snapshot("a")?.path[0]).toBe("off");
    expect(map.snapshot("b")?.path[0]).toBe("off");
  });

  test("with ActorMap where children ignore the event — does not throw", () => {
    const toggle = event("toggle")();
    const off = state("off")();
    const on = state("on")();
    const map = new ActorMap(
      () =>
        new Actor({
          inputs: [toggle],
          context: {},
          states: [off, on],
          initial: off,
          setup: () => {},
        }),
    );
    map.spawn("a");
    map.spawn("b");

    expect(() => broadcast(map, toggle.create())).not.toThrow();
    expect(map.snapshot("a")?.path[0]).toBe("off");
    expect(map.snapshot("b")?.path[0]).toBe("off");
  });

  test("broadcast inside actor effect — integration with VirtualClock", () => {
    const clock = new VirtualClock();
    const ping = event("ping")();
    const pong = event("pong")();
    const idle = state("idle")();
    const done = state("done")();
    const childOff = state("childOff")();
    const childOn = state("childOn")();

    const map = new ActorMap(
      () =>
        new Actor({
          clock,
          inputs: [pong],
          context: {},
          states: [childOff, childOn],
          initial: childOff,
          setup: (m) => {
            m.on(childOff, pong, () => ({ state: childOn }));
          },
        }),
    );
    map.spawn("child");

    const parent = new Actor({
      clock,
      inputs: [ping],
      states: [idle, done],
      initial: idle,
      setup: (m) => {
        m.on(idle, ping, () => {
          broadcast(map, pong.create());
          return { state: done };
        });
      },
    });

    parent.send(ping.create());

    expect(matches(parent, "done")).toBe(true);
    expect(map.snapshot("child")?.path[0]).toBe("childOn");
  });
});
