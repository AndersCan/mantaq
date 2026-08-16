import { expect, test, describe } from "vite-plus/test";
import { fc, runProperty } from "@mantaq/pbt";
import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { actorSpec, definePart, use, withParts } from "../src/parts.ts";
import type { BuilderOf } from "../src/parts.ts";

const idle = state("idle")();
const loading = state("loading")();
const done = state("done")().final();

const start = event("start")();
const finish = event("finish")<{ value: number }>();
const fail = event("fail")();

const base = actorSpec({
  inputs: [start, finish, fail],
  internal: [],
  states: [idle, loading, done],
  initial: idle,
  context: {} as { hits: number },
});

const rawA = (m: BuilderOf<typeof base>): void => {
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
};

const rawB = (m: BuilderOf<typeof base>): void => {
  m.on(loading, fail, (_event, opts) => {
    const cur = opts.context.get();
    cur.hits += 1;
    opts.context.set(cur);
    return { state: idle };
  });
};

const partA = definePart<typeof base>(rawA);
const partB = definePart<typeof base>(rawB);

const anyEvent = fc.constantFrom(start.create(), finish.create({ value: 1 }), fail.create());

function freshBase() {
  return { ...base, context: { hits: 0 }, clock: new VirtualClock() };
}

describe("parts property tests", () => {
  test("withParts and an inline setup registering the same parts produce identical traces", () => {
    runProperty(fc.array(anyEvent, { maxLength: 30 }), (events) => {
      const composed = withParts(freshBase(), [partA, partB]);
      const inline = new Actor({
        ...freshBase(),
        setup: (m) => {
          use(m, rawA);
          use(m, rawB);
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
