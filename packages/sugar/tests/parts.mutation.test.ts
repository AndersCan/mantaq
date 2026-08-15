import { describe, expect, test } from "vite-plus/test";
import { Actor, event, state } from "@mantaq/core";
import type { BuilderOf } from "../src/parts.ts";
import { definePart, use, withParts } from "../src/parts.ts";

const idle = state("idle")();
const go = event("go")();

const base = {
  inputs: [go] as const,
  internal: [] as const,
  states: [idle] as const,
  initial: idle,
  context: {} as { n: number },
};

describe("parts directed mutation tests", () => {
  test("definePart returns its function unchanged", () => {
    const fn = (m: BuilderOf<typeof base>): void => {
      m.on(idle, go, () => ({ state: idle }));
    };
    expect(definePart<typeof base>(fn)).toBe(fn);
  });

  test("use invokes the part with the given builder", () => {
    let invoked = false;
    const part = definePart<typeof base>(() => {
      invoked = true;
    });
    const actor = new Actor({
      ...base,
      setup: (m) => {
        use(m, part);
      },
    });
    expect(invoked).toBe(true);
    expect(actor).toBeInstanceOf(Actor);
  });

  test("withParts runs every part in order against the builder", () => {
    const order: string[] = [];
    const first = (m: BuilderOf<typeof base>): void => {
      order.push("first");
      m.on(idle, go, () => ({ state: idle }));
    };
    const second = (_m: BuilderOf<typeof base>): void => {
      order.push("second");
    };
    withParts(base, [first, second]);
    expect(order).toEqual(["first", "second"]);
  });

  test("withParts accepts a single part without an array", () => {
    let invoked = false;
    const part = definePart<typeof base>(() => {
      invoked = true;
    });
    withParts(base, part);
    expect(invoked).toBe(true);
  });

  test("withParts carries base options onto the actor", () => {
    const actor = withParts({ ...base, internalBudget: 7 }, []);
    expect(actor.options.internalBudget).toBe(7);
  });
});
