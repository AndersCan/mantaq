import { expect, test, describe } from "vite-plus/test";
import { event, state } from "@mantaq/core";
import { actorSpec, definePart, withParts } from "../src/parts.ts";

const idle = state("idle")();
const loading = state("loading")();

const start = event("start")();
const boom = event("boom")();

const machine = actorSpec({
  inputs: [start],
  internal: [boom],
  states: [idle, loading],
  initial: idle,
  context: {} as { attempts: number },
});

const emitBoomPart = definePart<typeof machine>((m) => {
  m.on(idle, start, () => ({ state: loading }));
  m.effect(loading, (input) => {
    input.emit(boom.create());
  });
});

describe("parts error paths", () => {
  test("unhandled internal event emitted from a part kills the actor", () => {
    const actor = withParts(machine, [emitBoomPart]);
    actor.send(start.create());
    expect(actor.state.name).toBe("__error");
    expect(actor.snapshot().error?.reason).toBe("unhandled");
    expect(actor.snapshot().error?.event.type).toBe("boom");
  });

  test("missing part for a state leaves its events unhandled", () => {
    const actor = withParts(machine, []);
    actor.send(start.create());
    expect(actor.state).toBe(idle);
  });

  test("a throwing part body propagates out of withParts", () => {
    const boomPart = definePart<typeof machine>(() => {
      throw new Error("part blew up");
    });
    expect(() => withParts(machine, [boomPart])).toThrow("part blew up");
  });

  test("parts emitting beyond the internal budget kill the actor", () => {
    const loop = event("loop")();
    const flood = actorSpec({
      inputs: [start],
      internal: [loop],
      states: [idle, loading],
      initial: idle,
      context: {} as { attempts: number },
      internalBudget: 2,
    });
    const floodPart = definePart<typeof flood>((m) => {
      m.on(idle, start, () => ({ state: loading }));
      m.on(loading, loop, () => ({ state: loading }));
      m.effect(loading, (input) => {
        input.emit(loop.create());
        input.emit(loop.create());
        input.emit(loop.create());
      });
    });
    const actor = withParts(flood, floodPart);
    actor.send(start.create());
    expect(actor.state.name).toBe("__error");
    expect(actor.snapshot().error?.reason).toBe("budget");
  });
});
