import { createActorMap } from "../actors/actor-map.ts";
import { matches } from "../actors/matches.ts";
import { broadcast } from "./broadcast.ts";
import type { SendableMap } from "./broadcast.ts";
import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";

function fakeMap(
  keys: string[],
  { sent }: { sent: Array<{ key: string; event: unknown }> },
): SendableMap {
  return {
    keys() {
      return keys;
    },
    send(key, ...events) {
      for (const event of events) {
        sent.push({ key, event });
      }
    },
  };
}

describe("broadcast", () => {
  test("calls send for every child in key order", () => {
    const sent: Array<{ key: string; event: unknown }> = [];
    const map = fakeMap(["a", "b"], { sent });

    broadcast(map, { type: "ping" });

    expect(sent).toEqual([
      { key: "a", event: { type: "ping" } },
      { key: "b", event: { type: "ping" } },
    ]);
  });

  test("keeps calling safe on an empty map", () => {
    const sent: Array<{ key: string; event: unknown }> = [];
    const map = fakeMap([], { sent });

    expect(() => broadcast(map, { type: "ping" })).not.toThrow();
    expect(sent).toEqual([]);
  });

  function makeChild() {
    const toggle = event("toggle")();
    const off = state("off")();
    const onState = state("on")();
    return {
      actor: Actor({
        inputs: [toggle],
        states: [off, onState],
        initial: off,
        setup: (m) => {
          m.on(off, { eventRef: toggle, handler: () => ({ state: onState }) });
        },
      }),
      toggle,
    };
  }

  test("updates every spawned actor on a real ActorMap", () => {
    const map = createActorMap(() => makeChild().actor);
    const { toggle } = makeChild();
    map.spawn("a");
    map.spawn("b");

    broadcast(map, toggle.create());

    expect([map.snapshot("a")?.path[0], map.snapshot("b")?.path[0]]).toEqual(["on", "on"]);
  });

  test("keeps an empty real map as a no-op", () => {
    const map = createActorMap(() => makeChild().actor);
    expect(() => broadcast(map, { type: "ping" })).not.toThrow();
  });

  test("keeps every child in step across fan-out then reset", () => {
    const toggle = event("toggle")();
    const reset = event("reset")();
    const off = state("off")();
    const onState = state("on")();
    const map = createActorMap(() =>
      Actor({
        inputs: [toggle, reset],
        context: {},
        states: [off, onState],
        initial: off,
        setup: (m) => {
          m.on(off, { eventRef: toggle, handler: () => ({ state: onState }) });
          m.on(onState, { eventRef: reset, handler: () => ({ state: off }) });
        },
      }),
    );
    map.spawn("a");
    map.spawn("b");

    broadcast(map, toggle.create());
    expect([map.snapshot("a")?.path[0], map.snapshot("b")?.path[0]]).toEqual(["on", "on"]);

    broadcast(map, reset.create());
    expect([map.snapshot("a")?.path[0], map.snapshot("b")?.path[0]]).toEqual(["off", "off"]);
  });

  test("does not throw when children ignore the event", () => {
    const toggle = event("toggle")();
    const off = state("off")();
    const onState = state("on")();
    const map = createActorMap(() =>
      Actor({
        inputs: [toggle],
        context: {},
        states: [off, onState],
        initial: off,
        setup: () => {},
      }),
    );
    map.spawn("a");
    map.spawn("b");

    expect(() => broadcast(map, toggle.create())).not.toThrow();
    expect([map.snapshot("a")?.path[0], map.snapshot("b")?.path[0]]).toEqual(["off", "off"]);
  });

  test("updates children when broadcast runs inside an actor effect driven by VirtualClock", () => {
    const clock = VirtualClock();
    const ping = event("ping")();
    const pong = event("pong")();
    const idle = state("idle")();
    const done = state("done")();
    const childOff = state("childOff")();
    const childOn = state("childOn")();

    const map = createActorMap(() =>
      Actor({
        clock,
        inputs: [pong],
        context: {},
        states: [childOff, childOn],
        initial: childOff,
        setup: (m) => {
          m.on(childOff, { eventRef: pong, handler: () => ({ state: childOn }) });
        },
      }),
    );
    map.spawn("child");

    const parent = Actor({
      clock,
      inputs: [ping],
      states: [idle, done],
      initial: idle,
      setup: (m) => {
        m.on(idle, {
          eventRef: ping,
          handler: () => {
            broadcast(map, pong.create());
            return { state: done };
          },
        });
      },
    });

    parent.send(ping.create());

    expect(matches(parent, "done")).toBe(true);
    expect(map.snapshot("child")?.path[0]).toBe("childOn");
  });
});
