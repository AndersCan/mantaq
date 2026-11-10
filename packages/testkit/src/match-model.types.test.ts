import { assertMatchesModel } from "./match-model.ts";
import type { MatchModelOptions } from "./match-model.ts";
import { Actor, event, state } from "@mantaq/core";
import { describe, expectTypeOf, test } from "vite-plus/test";

const put = event("put")<{ n: number }>();
const clear = event("clear")();
const a = state("a")();
const b = state("b")();

function model() {
  return Actor({ inputs: [put, clear], states: [a, b], initial: a, setup: () => {} });
}

function plain() {
  return Actor({ inputs: [clear], states: [a, b], initial: a, setup: () => {} });
}

const noop = () => {};

describe("assertMatchesModel types", () => {
  test("every input needs an events entry", () => {
    const options: MatchModelOptions<ReturnType<typeof model>, object> = {
      model,
      start: () => ({}),
      // @ts-expect-error -- clear is missing
      events: { put: noop },
      state: () => "a",
      payloads: { put: [{ n: 1 }] },
    };
    expectTypeOf(options).not.toBeAny();
  });

  test("state must be a model state name", () => {
    void (() =>
      assertMatchesModel({
        model: plain,
        start: () => ({}),
        events: { clear: noop },
        // @ts-expect-error -- "zzz" is not a model state
        state: () => "zzz",
      }));
  });

  test("a payload model needs payloads of the right shape", () => {
    void (() =>
      // @ts-expect-error -- payloads is missing
      assertMatchesModel({
        model,
        start: () => ({}),
        events: { put: noop, clear: noop },
        state: () => "a",
      }));
    void (() =>
      assertMatchesModel({
        model,
        start: () => ({}),
        events: { put: noop, clear: noop },
        state: () => "a",
        // @ts-expect-error -- m is not in the payload
        payloads: { put: [{ m: 1 }] },
      }));
  });

  test("a model without payloads rejects payloads", () => {
    void (() =>
      assertMatchesModel({
        model: plain,
        start: () => ({}),
        events: { clear: noop },
        state: () => "a",
        // @ts-expect-error -- no input carries data
        payloads: { clear: [] },
      }));
  });

  test("App is inferred from an async start", () => {
    void (() =>
      assertMatchesModel({
        model: plain,
        start: async () => ({ count: 1 }),
        events: {
          clear: (app) => {
            expectTypeOf(app).toEqualTypeOf<{ count: number }>();
          },
        },
        state: (app) => (app.count > 0 ? "a" : "b"),
      }));
  });
});
