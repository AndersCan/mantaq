import { withParts, actorSpec, definePart, use } from "./parts.ts";
import type { BuilderOf } from "./parts.ts";
import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { fc, runProperty } from "@mantaq/pbt";
import { describe, expect, test } from "vite-plus/test";

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
  context: { hits: 0 },
});

function rawA(builder: BuilderOf<typeof base>): void {
  builder.on(idle, {
    eventRef: start,
    handler: (_event, { context }) => {
      const cur = context.get();
      cur.hits += 1;
      context.set(cur);
      return { state: loading };
    },
  });
  builder.on(loading, {
    eventRef: finish,
    handler: (_event, { context }) => {
      const cur = context.get();
      cur.hits += 1;
      context.set(cur);
      return { state: done };
    },
  });
}

function rawB(builder: BuilderOf<typeof base>): void {
  builder.on(loading, {
    eventRef: fail,
    handler: (_event, { context }) => {
      const cur = context.get();
      cur.hits += 1;
      context.set(cur);
      return { state: idle };
    },
  });
}

const partA = definePart<typeof base>(rawA);
const partB = definePart<typeof base>(rawB);

const anyEvent = fc.constantFrom(start.create(), finish.create({ value: 1 }), fail.create());

function freshBase() {
  return { ...base, context: { hits: 0 }, clock: VirtualClock() };
}

describe("parts property tests", () => {
  test("keeps traces identical between withParts and an inline setup registering the same parts", () => {
    runProperty(fc.array(anyEvent, { maxLength: 30 }), (events) => {
      const composed = withParts(freshBase(), partA, partB);
      const inline = Actor({
        ...freshBase(),
        setup: (m) => {
          use(m, rawA);
          use(m, rawB);
        },
      });
      for (const emitted of events) {
        composed.send(emitted);
        inline.send(emitted);
      }
      expect({
        state: composed.state.name,
        context: composed.context,
      }).toEqual({
        state: inline.state.name,
        context: inline.context,
      });
    });
  });
});
