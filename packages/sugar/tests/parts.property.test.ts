import { expect, test, describe } from "vite-plus/test";
import { fc, runProperty } from "@mantaq/pbt";
import { Actor, event, state } from "@mantaq/core";
import { definePart, use, withParts } from "../src/parts.ts";

const idle = state("idle")();
const loading = state("loading")();
const done = state("done")().final();

const start = event("start")();
const finish = event("finish")<{ value: number }>();
const fail = event("fail")();

const base = {
  inputs: [start, finish, fail] as const,
  internal: [] as const,
  states: [idle, loading, done] as const,
  initial: idle,
  context: {} as { hits: number },
};

const partA = definePart<typeof base>((m) => {
  m.on(idle, start, (_event, opts) => {
    const cur = opts.context.get();
    cur.hits += 1;
    opts.context.set(cur);
    return { state: loading };
  });
  m.on(loading, finish, (_event, opts) => {
    const cur = opts.context.get();
    cur.hits += 1;
    opts.context.set(cur);
    return { state: done };
  });
});

const partB = definePart<typeof base>((m) => {
  m.on(loading, fail, (_event, opts) => {
    const cur = opts.context.get();
    cur.hits += 1;
    opts.context.set(cur);
    return { state: idle };
  });
});

const anyEvent = fc.constantFrom(start.create(), finish.create({ value: 1 }), fail.create());

describe("parts property tests", () => {
  test("withParts and an inline setup registering the same parts produce identical traces", () => {
    runProperty(fc.array(anyEvent, { maxLength: 30 }), (events) => {
      const composed = withParts({ ...base, context: { hits: 0 } }, [partA, partB]);
      const inline = new Actor({
        ...base,
        context: { hits: 0 },
        setup: (m) => {
          use(m, partA);
          use(m, partB);
        },
      });
      for (const e of events) {
        composed.send(e);
        inline.send(e);
      }
      expect(composed.state).toBe(inline.state);
      expect(composed.context).toEqual(inline.context);
    });
  });
});
