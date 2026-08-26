import { actorSpec, definePart, use, withParts, type ActorSpec, type BuilderOf } from "./parts.ts";
import { Actor, event, state } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";

const idle = state("idle")();
const goEvent = event("go")();

const base = actorSpec({
  inputs: [goEvent],
  internal: [],
  states: [idle],
  initial: idle,
  context: { n: 0 },
});

describe("parts directed mutation tests", () => {
  test("returns its input unchanged from actorSpec", () => {
    const spec: ActorSpec = actorSpec({
      inputs: [goEvent],
      internal: [],
      states: [idle],
      initial: idle,
    });
    expect(spec).toEqual({
      inputs: [goEvent],
      internal: [],
      states: [idle],
      initial: idle,
    });
  });

  test("returns its function unchanged from definePart", () => {
    function part(builder: BuilderOf<typeof base>): void {
      builder.on(idle, { eventRef: goEvent, handler: () => ({ state: idle }) });
    }
    expect(definePart<typeof base>(part)).toBe(part);
  });

  test("calls the part with the given builder inside use", () => {
    let invoked = false;
    const part = definePart<typeof base>(() => {
      invoked = true;
    });
    const actor = Actor({
      ...base,
      setup: (m) => {
        use(m, part);
      },
    });
    expect({
      invoked,
      sends: typeof actor.send === "function",
      settles: typeof actor.settled === "function",
    }).toEqual({
      invoked: true,
      sends: true,
      settles: true,
    });
  });

  test("calls every part in order against the withParts builder", () => {
    const order: string[] = [];
    function first(builder: BuilderOf<typeof base>): void {
      order.push("first");
      builder.on(idle, { eventRef: goEvent, handler: () => ({ state: idle }) });
    }
    function second(_m: BuilderOf<typeof base>): void {
      order.push("second");
    }
    withParts(base, first, second);
    expect(order).toEqual(["first", "second"]);
  });

  test("creates a working setup from a single part without an array", () => {
    let invoked = false;
    const part = definePart<typeof base>(() => {
      invoked = true;
    });
    withParts(base, part);
    expect(invoked).toBe(true);
  });

  test("sets base options onto the built actor", () => {
    const actor = withParts({ ...base, internalBudget: 7 });
    expect(actor.options?.internalBudget).toEqual(7);
  });
});
