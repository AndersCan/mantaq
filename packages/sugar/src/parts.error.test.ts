import { actorSpec, definePart, withParts } from "./parts.ts";
import { event, state } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";

const idle = state("idle")();
const loading = state("loading")();

const start = event("start")();
const boom = event("boom")();

const machine = actorSpec({
  inputs: [start],
  internal: [boom],
  states: [idle, loading],
  initial: idle,
  context: { attempts: 0 },
});

function nameOf(actor: { state: { name: string } }): string {
  return actor.state.name;
}

const emitBoomPart = definePart<typeof machine>((m) => {
  m.on(idle, { eventRef: start, handler: () => ({ state: loading }) });
  m.effect(loading, {
    name: "emitBoom",
    fn: (input) => {
      input.emit(boom.create());
    },
  });
});

describe("parts error paths", () => {
  test("sets the actor to __error when a part emits an unhandled internal event", () => {
    const actor = withParts(machine, emitBoomPart);
    actor.send(start.create());
    expect({
      state: nameOf(actor),
      reason: actor.snapshot().error?.reason,
      eventType: actor.snapshot().error?.event.type,
    }).toEqual({ state: "__error", reason: "unhandled", eventType: "boom" });
  });

  test("keeps events unhandled when no part covers the entered state", () => {
    const actor = withParts(machine);
    actor.send(start.create());
    expect(nameOf(actor)).toBe("idle");
  });

  test("fails setup when a part body raises", () => {
    const boomPart = definePart<typeof machine>(() => {
      JSON.parse("{");
    });
    expect(() => withParts(machine, boomPart)).toThrow(SyntaxError);
  });

  test("sets the actor to __error when parts emit beyond the internal budget", () => {
    const loop = event("loop")();
    const flood = actorSpec({
      inputs: [start],
      internal: [loop],
      states: [idle, loading],
      initial: idle,
      context: { attempts: 0 },
      internalBudget: 2,
    });
    const floodPart = definePart<typeof flood>((m) => {
      m.on(idle, { eventRef: start, handler: () => ({ state: loading }) });
      m.on(loading, { eventRef: loop, handler: () => ({ state: loading }) });
      m.effect(loading, {
        name: "floodLoopEvents",
        fn: (input) => {
          input.emit(loop.create());
          input.emit(loop.create());
          input.emit(loop.create());
        },
      });
    });
    const actor = withParts(flood, floodPart);
    actor.send(start.create());
    expect({ state: nameOf(actor), reason: actor.snapshot().error?.reason }).toEqual({
      state: "__error",
      reason: "budget",
    });
  });
});
