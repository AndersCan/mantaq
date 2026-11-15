import { describe, expect, test } from "vite-plus/test";
import type { VizField, VizJson, VizLiveChild, VizStep } from "../schema.ts";
import { freshKeys, knownPayload } from "./fill.ts";

function field(name: string, input: VizField["input"], choices: VizJson[] = []): VizField {
  return { name, type: "x", optional: false, doc: null, input, choices, sample: "sample" };
}

describe("knownPayload", () => {
  const step = (event: string, payload: VizJson) => ({ kind: "event" as const, event, payload });
  const card: VizField = { ...field("cardNumber", "text"), sample: "4242 4242 4242 4242" };
  const base = { event: "pay", samples: [], steps: [] };

  test("with nothing sent or fuzzed, the field's example", () => {
    expect(knownPayload([card], base)).toEqual({ payload: { cardNumber: "4242 4242 4242 4242" } });
  });

  test("the field's example beats the fuzzer's first payload", () => {
    const samples = [{ cardNumber: "1111" }, { cardNumber: "2222" }];
    expect(knownPayload([card], { ...base, samples })).toEqual({
      payload: { cardNumber: "4242 4242 4242 4242" },
    });
  });

  test("an optional field has no example, so the fuzzer's value fills it", () => {
    const note: VizField = { ...field("note", "text"), optional: true };
    expect(knownPayload([note], { ...base, samples: [{ note: "hi" }] })).toEqual({
      payload: { note: "hi" },
    });
  });

  test("a fuzz value that is only the type's default loses to the example", () => {
    const amount: VizField = { ...field("amount", "number"), sample: 42 };
    const result = knownPayload([card, amount], {
      ...base,
      samples: [{ cardNumber: "sample", amount: 1 }],
    });
    expect(result).toEqual({ payload: { cardNumber: "4242 4242 4242 4242", amount: 42 } });
  });

  test("what this walk sent under that name, on any event, beats the fuzzer", () => {
    const result = knownPayload([card], {
      ...base,
      samples: [{ cardNumber: "1111" }],
      steps: [step("other", { cardNumber: "8" }), step("other", { cardNumber: "9" })],
    });
    expect(result).toEqual({ payload: { cardNumber: "9" } });
  });

  test("a sent value that does not fit its field is skipped for an older one that does", () => {
    const answer = field("answer", "choice", ["accepted", "declined"]);
    const code = field("code", "text");
    const steps = [
      step("ask", { code: "c1", answer: "declined" }),
      step("ask", { code: "", answer: "maybe" }),
    ];
    expect(knownPayload([code, answer], { ...base, steps })).toEqual({
      payload: { code: "c1", answer: "declined" },
    });
  });

  test("a json field takes whatever was sent", () => {
    const data = field("data", "json");
    expect(knownPayload([data], { ...base, steps: [step("other", { data: [1, "x"] })] })).toEqual({
      payload: { data: [1, "x"] },
    });
  });

  test("an optional field with nothing known is left out", () => {
    const optional: VizField = { ...card, optional: true };
    expect(knownPayload([optional], base)).toEqual({ payload: {} });
  });

  test("a fuzz value that does not fit falls back to the example", () => {
    const amount: VizField = { ...field("amount", "number"), sample: 1 };
    expect(knownPayload([amount], { ...base, samples: [{ amount: "lots" }] })).toEqual({
      payload: { amount: 1 },
    });
  });

  test("without fields: the last payload sent with this event, else the fuzzer's first", () => {
    const steps = [step("pay", { a: 1 }), step("pay", { a: 3 }), step("other", { a: 5 })];
    const samples = [{ a: 1 }, { a: 2 }];
    expect(knownPayload(null, { event: "pay", samples, steps })).toEqual({ payload: { a: 3 } });
    expect(knownPayload([], { event: "pay", samples, steps: [] })).toEqual({ payload: { a: 1 } });
  });

  test("without fields and nothing known: undefined", () => {
    expect(knownPayload(null, base)).toBeUndefined();
    expect(knownPayload(null, { ...base, steps: [step("pay", null)] })).toBeUndefined();
  });
});

describe("freshKeys", () => {
  const add = (photoId: VizJson): VizStep => ({
    kind: "event",
    event: "photoAdded",
    payload: { photoId },
  });
  const child = (key: string, since: number): VizLiveChild => ({
    map: "photos",
    key,
    state: "photos.sendingPhoto",
    since,
  });
  const ask = (payload: VizJson, state: Parameters<typeof freshKeys>[1]["state"]) =>
    freshKeys(payload, { event: "photoAdded", state });

  test("a key this event started gets the next number", () => {
    const state = { steps: [add("p1")], children: [child("p1", 1)] };
    expect(ask({ photoId: "p1" }, state)).toEqual({ photoId: "p2" });
  });

  test("it counts past keys that are taken", () => {
    const steps = [add("p1"), add("p2")];
    const two = { steps, children: [child("p1", 1), child("p2", 2)] };
    expect(ask({ photoId: "p2" }, two)).toEqual({ photoId: "p3" });
    const three = { steps, children: [...two.children, child("p3", 9)] };
    expect(ask({ photoId: "p2" }, three)).toEqual({ photoId: "p4" });
  });

  test("a key with no number gets -2", () => {
    const state = { steps: [add("sample")], children: [child("sample", 1)] };
    expect(ask({ photoId: "sample" }, state)).toEqual({ photoId: "sample-2" });
    const taken = { ...state, children: [...state.children, child("sample-2", 5)] };
    expect(ask({ photoId: "sample" }, taken)).toEqual({ photoId: "sample-3" });
  });

  test("the number keeps its width", () => {
    const state = { steps: [add("p09")], children: [child("p09", 1)] };
    expect(ask({ photoId: "p09" }, state)).toEqual({ photoId: "p10" });
  });

  test("a key with twenty digits still gets the next number", () => {
    const big = "p99999999999999999999";
    const state = { steps: [add(big)], children: [child(big, 1)] };
    const next = { photoId: "p100000000000000000000" };
    expect(ask({ photoId: big }, state)).toEqual(next);
    const taken = { ...state, children: [...state.children, child(next.photoId, 2)] };
    expect(ask({ photoId: big }, taken)).toEqual({ photoId: "p100000000000000000001" });
  });

  test("the number keeps its width past leading zeros", () => {
    const state = { steps: [add("p001")], children: [child("p001", 1)] };
    expect(ask({ photoId: "p001" }, state)).toEqual({ photoId: "p2" });
  });

  test("another step of this event with a different payload is no evidence", () => {
    const steps = [add("x")];
    const state = { steps, children: [child("p1", 1)] };
    expect(ask({ photoId: "p1" }, state)).toEqual({ photoId: "p1" });
  });

  test("another event's step is no evidence", () => {
    const state = { steps: [add("p1")], children: [child("p1", 1)] };
    const result = freshKeys({ photoId: "p1" }, { event: "photoRemoved", state });
    expect(result).toEqual({ photoId: "p1" });
  });

  test("a key that is not live stays", () => {
    const state = { steps: [add("p1")], children: [], removed: [{ ...child("p1", 1), until: 2 }] };
    expect(ask({ photoId: "p1" }, state)).toEqual({ photoId: "p1" });
  });

  test("a live key this event did not start stays", () => {
    const state = { steps: [add("p1")], children: [child("p1", 5)] };
    expect(ask({ photoId: "p1" }, state)).toEqual({ photoId: "p1" });
  });

  test("a removed child with the key counts as the step's start", () => {
    const state = {
      steps: [add("p1")],
      children: [child("p1", 2)],
      removed: [{ ...child("p1", 1), until: 2 }],
    };
    expect(ask({ photoId: "p1" }, state)).toEqual({ photoId: "p2" });
  });

  test("numbers and other fields stay; the input is not changed", () => {
    const state = { steps: [add("p1")], children: [child("p1", 1)] };
    const payload = { photoId: "p1", size: 3, note: "x" };
    expect(ask(payload, state)).toEqual({ photoId: "p2", size: 3, note: "x" });
    expect(payload.photoId).toBe("p1");
    expect(ask({ photoId: 1 }, state)).toEqual({ photoId: 1 });
    expect(ask("p1", state)).toBe("p1");
    expect(ask(null, state)).toBeNull();
  });
});

test("without declared fields, a payload another event carried with the example's keys fills the box", () => {
  const steps: VizStep[] = [
    { kind: "event", event: "ITEMS_ASSIGNED", payload: { worker: "w1", items: ["a"] } },
    { kind: "event", event: "OTHER", payload: { worker: "w2" } },
  ];
  expect(
    knownPayload(null, { event: "ITEMS_FINISHED", samples: [{ items: [], worker: "x" }], steps }),
  ).toEqual({ payload: { worker: "w1", items: ["a"] } });
});
