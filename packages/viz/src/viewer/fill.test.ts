import { describe, expect, test } from "vite-plus/test";
import type { VizField, VizJson, VizLiveChild, VizMachine, VizStep } from "../schema.ts";
import {
  decodeValues,
  defaultValue,
  encodeValues,
  freshKeys,
  knownPayload,
  parseValue,
  payloadFor,
  valueFields,
  valueText,
} from "./fill.ts";

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

  test("an optional field has no example, so it is left out even when the fuzzer made a value", () => {
    const note: VizField = { ...field("note", "text"), optional: true };
    expect(knownPayload([note], { ...base, samples: [{ note: "hi" }] })).toEqual({ payload: {} });
  });

  test("a fuzz value that is only the type's default loses to the example", () => {
    const amount: VizField = { ...field("amount", "number"), sample: 42 };
    const result = knownPayload([card, amount], {
      ...base,
      samples: [{ cardNumber: "sample", amount: 1 }],
    });
    expect(result).toEqual({ payload: { cardNumber: "4242 4242 4242 4242", amount: 42 } });
  });

  test("an empty example gives way to the first non-empty value the fuzzer sent", () => {
    const friends: VizField = { ...field("friends", "json"), sample: [] };
    const samples = [{ friends: [] }, { friends: ["a"] }, { friends: ["b"] }];
    expect(knownPayload([friends], { ...base, samples })).toEqual({ payload: { friends: ["a"] } });
  });

  test("an empty example with no non-empty fuzz value stays the example", () => {
    const friends: VizField = { ...field("friends", "json"), sample: [] };
    expect(knownPayload([friends], { ...base, samples: [{ friends: [] }] })).toEqual({
      payload: { friends: [] },
    });
    expect(knownPayload([friends], base)).toEqual({ payload: { friends: [] } });
  });

  test("a fuzz value that does not fit the field is not used for an empty example", () => {
    const kind = { ...field("kind", "choice", ["a", "b"]), sample: "" };
    expect(knownPayload([kind], { ...base, samples: [{ kind: "z" }, { kind: "b" }] })).toEqual({
      payload: { kind: "b" },
    });
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

  test("without fields: the fuzzer's first, whatever the walk sent", () => {
    const steps = [step("pay", { a: 1 }), step("pay", { a: 3 }), step("other", { a: 5 })];
    const samples = [{ a: 1 }, { a: 2 }];
    expect(knownPayload(null, { event: "pay", samples, steps })).toEqual({ payload: { a: 1 } });
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

describe("values set in the Context tab", () => {
  const step = (event: string, payload: VizJson) => ({ kind: "event" as const, event, payload });
  const email = { ...field("email", "text"), sample: "ana@example.com" };
  const answer = { ...field("answer", "choice", ["accepted", "declined"]), sample: "accepted" };
  const code = field("code", "text");
  const machine = (events: Array<{ id: string; payload: VizField[] | null }>): VizMachine =>
    ({
      events: events.map((each) => ({ internal: false, doc: null, ...each })),
      fuzz: null,
    }) as unknown as VizMachine;
  const answering = machine([
    { id: "ask", payload: [code] },
    { id: "answered", payload: [code, answer] },
    { id: "ping", payload: null },
  ]);
  const none = { live: null, afters: [] };

  test("a set value wins over the example", () => {
    const checkout = machine([{ id: "submit", payload: [email, field("name", "text")] }]);
    expect(payloadFor(checkout, "submit", { set: {}, ...none })).toEqual({
      email: "ana@example.com",
      name: "sample",
    });
    expect(payloadFor(checkout, "submit", { set: { email: "x@y.z" }, ...none })).toEqual({
      email: "x@y.z",
      name: "sample",
    });
  });

  test("a set value that does not fit its field falls back to the default", () => {
    const checkout = machine([{ id: "submit", payload: [email] }]);
    expect(payloadFor(checkout, "submit", { set: { email: 5 }, ...none })).toEqual({
      email: "ana@example.com",
    });
  });

  test("an event with no data sends null, whatever is set", () => {
    expect(payloadFor(answering, "ping", { set: { code: "x" }, ...none })).toBeNull();
  });

  test("one row per field name, the first event's field wins", () => {
    expect(valueFields(answering).map((each) => each.name)).toEqual(["code", "answer"]);
  });

  test("the default shown is the latest value the walk sent under that name, else the example", () => {
    const live = { steps: [step("ask", { code: "c1" })], children: [] } as never;
    expect(defaultValue(code, { live, afters: [] })).toBe("c1");
    expect(defaultValue(answer, { live, afters: [] })).toBe("accepted");
    expect(defaultValue({ ...code, optional: true }, { live: null, afters: [] })).toBeUndefined();
  });

  test("the default for a key that started a child is the next free key, as Send sends", () => {
    const live = {
      steps: [step("ask", { code: "p1" })],
      children: [{ map: "m", key: "p1", state: "s", since: 1 }],
    } as never;
    expect(defaultValue(code, { live, afters: [], events: ["ask"] })).toBe("p2");
    expect(defaultValue(code, { live, afters: [] })).toBe("p1");
    expect(defaultValue(code, { live, afters: [], events: ["other"] })).toBe("p1");
  });

  test("a value the walk sent under another event's name is sent, and a set one beats it", () => {
    const live = { steps: [step("ask", { code: "c1" })], children: [] } as never;
    expect(payloadFor(answering, "answered", { set: {}, live, afters: [] })).toEqual({
      code: "c1",
      answer: "accepted",
    });
    expect(
      payloadFor(answering, "answered", { set: { answer: "declined" }, live, afters: [] }),
    ).toEqual({ code: "c1", answer: "declined" });
  });

  test("what a part sent after a step is heard", () => {
    const worker = field("worker", "text");
    const pool = machine([{ id: "ITEMS_FINISHED", payload: [worker] }]);
    const live = { steps: [step("ITEM_ARRIVED", null)], children: [] } as never;
    const afters = [
      [
        {
          event: "ITEMS_ASSIGNED",
          message: { sender: "", dropped: null, payload: { worker: "w1" } },
        },
      ],
    ] as never;
    expect(payloadFor(pool, "ITEMS_FINISHED", { set: {}, live, afters })).toEqual({ worker: "w1" });
  });

  test("text for each kind of field, and back", () => {
    const count = field("count", "number");
    const flags = field("flags", "json");
    expect(parseValue(count, "3")).toBe(3);
    expect(parseValue(count, "abc")).toBeUndefined();
    expect(parseValue(code, "")).toBeUndefined();
    expect(parseValue(code, "hi")).toBe("hi");
    expect(parseValue(answer, "declined")).toBe("declined");
    expect(parseValue(answer, "maybe")).toBeUndefined();
    expect(parseValue(flags, '{"a":1}')).toEqual({ a: 1 });
    expect(parseValue(flags, "{")).toBeUndefined();
    expect(valueText(code, "hi")).toBe("hi");
    expect(valueText(count, 3)).toBe("3");
    expect(valueText(flags, { a: 1 })).toBe('{"a":1}');
    expect(valueText(flags, "hi")).toBe('"hi"');
    expect(parseValue(code, "   ")).toBeUndefined();
    expect(parseValue(flags, " ")).toBeUndefined();
  });

  test("of two events with one field name, the one that requires it supplies the row", () => {
    const optional: VizField = { ...field("code", "text"), optional: true };
    const required = field("code", "text");
    const other = field("code", "text");
    const events = [
      { id: "a", payload: [optional] },
      { id: "b", payload: [required] },
      { id: "c", payload: [{ ...other, sample: "later" }] },
    ];
    expect(valueFields({ ...answering, events } as never)).toEqual([required]);
  });

  test("values round-trip through the address; entries with no name, no = or bad JSON are skipped", () => {
    expect(decodeValues(["a=1", "bad", "b={", "=3"])).toEqual({ a: 1 });
    const values = { email: "a@b", count: 3, flags: { a: [1] } };
    expect(encodeValues(values)).toEqual(['email="a@b"', "count=3", 'flags={"a":[1]}']);
    expect(decodeValues(encodeValues(values))).toEqual(values);
    expect(decodeValues(['a="x=y"'])).toEqual({ a: "x=y" });
  });
});

test("an optional field with nothing set or heard is left out, as its empty box shows", () => {
  const note: VizField = { ...field("note", "text"), optional: true };
  const machine = {
    events: [{ id: "submit", internal: false, doc: null, payload: [note] }],
    fuzz: {
      corpus: [{ steps: [{ kind: "event", event: "submit", payload: { note: "x" } }] }],
      errors: [],
    },
  } as unknown as VizMachine;
  const from = { set: {}, live: null, afters: [] };
  expect(defaultValue(note, from)).toBeUndefined();
  expect(payloadFor(machine, "submit", from)).toEqual({});
});

test("of two events that both leave a field name optional, the first supplies the row", () => {
  const first: VizField = { ...field("code", "text"), optional: true };
  const second: VizField = { ...field("code", "number"), optional: true };
  const events = [
    { id: "a", payload: [first] },
    { id: "b", payload: [second] },
  ];
  expect(valueFields({ events } as never)).toEqual([first]);
});
