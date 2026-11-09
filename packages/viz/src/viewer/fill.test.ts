import { describe, expect, test } from "vite-plus/test";
import type { VizField, VizJson } from "../schema.ts";
import { fillChoices, fillSources, fuzzSources, knownPayload } from "./fill.ts";

function field(name: string, input: VizField["input"], choices: VizJson[] = []): VizField {
  return { name, type: "x", optional: false, doc: null, input, choices, sample: "sample" };
}

const live = (state: string, payload: VizJson, context: VizJson) => ({ state, payload, context });

describe("fillSources", () => {
  test("fills a text field from the state's payload", () => {
    const fields = [
      field("code", "text"),
      field("answer", "choice", ["accepted", "declined"]),
      field("folderId", "text"),
    ];
    const result = fillSources(
      fields,
      live(
        "waitingForAdminToAccept",
        { code: "aaa", owner: "bbb", album: "Spain 2026", ownerName: "Nils" },
        { error: "" },
      ),
    );
    expect(result).toEqual([
      { path: "waitingForAdminToAccept", values: [{ field: "code", value: "aaa" }] },
    ]);
  });

  test("offers each list item, skipping a null entry", () => {
    const fields = [
      field("folderId", "text"),
      field("requesterKey", "text"),
      field("approve", "choice", [true, false]),
      field("role", "choice", ["viewer", "editor"]),
    ];
    const result = fillSources(
      fields,
      live("idle", null, {
        requests: [
          { folderId: "f1", requesterKey: "k1" },
          { folderId: "f2", requesterKey: "k2" },
        ],
        pendingRespond: null,
      }),
    );
    expect(result.map((each) => each.path)).toEqual(["context.requests[0]", "context.requests[1]"]);
    expect(result[1]?.values).toEqual([
      { field: "folderId", value: "f2" },
      { field: "requesterKey", value: "k2" },
    ]);
  });

  test("fills only the fields that share a name", () => {
    const result = fillSources(
      [field("folderId", "text"), field("name", "text")],
      live("idle", null, { folders: [{ id: "a", name: "Trip", role: "owner" }] }),
    );
    expect(result).toEqual([
      { path: "context.folders[0]", values: [{ field: "name", value: "Trip" }] },
    ]);
  });

  test("empty text does not fit", () => {
    expect(
      fillSources(
        [field("folderId", "text"), field("code", "text")],
        live("idle", null, { folderId: "", validFor: "1d", offCode: "" }),
      ),
    ).toEqual([]);
  });

  test("a choice-only match gives no source", () => {
    expect(
      fillSources(
        [field("role", "choice", ["viewer"]), field("who", "text")],
        live("idle", null, { role: "viewer" }),
      ),
    ).toEqual([]);
  });

  test("a kept source also fills a matching choice", () => {
    const result = fillSources(
      [field("role", "choice", ["viewer"]), field("who", "text")],
      live("idle", null, { role: "viewer", who: "me" }),
    );
    expect(result[0]?.values).toEqual([
      { field: "role", value: "viewer" },
      { field: "who", value: "me" },
    ]);
  });

  test("numbers must be finite; json takes anything", () => {
    const fields = [field("n", "number"), field("j", "json")];
    expect(fillSources(fields, live("s", { n: "1" }, null))).toEqual([]);
    expect(fillSources(fields, live("s", { n: 2, j: null }, null))[0]?.values).toEqual([
      { field: "n", value: 2 },
      { field: "j", value: null },
    ]);
  });

  test("the source with more filled fields comes first; ties keep state before context", () => {
    const fields = [field("a", "text"), field("b", "text")];
    const result = fillSources(fields, live("s", { a: "1" }, { a: "2", b: "3" }));
    expect(result.map((each) => each.path)).toEqual(["context", "s"]);
    const tie = fillSources(fields, live("s", { a: "1" }, { a: "2" }));
    expect(tie.map((each) => each.path)).toEqual(["s", "context"]);
  });

  test("25 list items give 20 sources", () => {
    const items = Array.from({ length: 25 }, (_, index) => ({ a: `v${index}` }));
    expect(fillSources([field("a", "text")], live("s", null, { a: "root", items }))).toHaveLength(
      20,
    );
  });

  test("an inherited key does not fit", () => {
    const payload = Object.create({ code: "x" }) as VizJson;
    expect(fillSources([field("code", "text")], live("s", payload, null))).toEqual([]);
  });
});

describe("fuzzSources", () => {
  const fields = [field("email", "text"), field("age", "number")];
  const numbered = (age: number) => ({ ...field("age", "number"), sample: age });

  test("keeps object samples with fitting values, in field order", () => {
    expect(fuzzSources(fields, [{ age: 2, email: "x" }])).toEqual([
      {
        path: "fuzz example 1",
        values: [
          { field: "email", value: "x" },
          { field: "age", value: 2 },
        ],
      },
    ]);
  });

  test("drops empty text, and samples left with no values", () => {
    expect(fuzzSources(fields, [{ email: "" }, { email: "", age: 3 }, { other: 1 }])).toEqual([
      { path: "fuzz example 1", values: [{ field: "age", value: 3 }] },
    ]);
  });

  test("drops samples equal to the type's examples", () => {
    expect(
      fuzzSources([field("email", "text"), numbered(1)], [{ email: "sample", age: 1 }]),
    ).toEqual([]);
  });

  test("collapses duplicates and skips non-objects", () => {
    const result = fuzzSources(fields, [null, "x", [1], { email: "a" }, { email: "a" }]);
    expect(result.map((each) => each.path)).toEqual(["fuzz example 1"]);
  });

  test("keeps five, numbered after drops", () => {
    const samples: VizJson[] = [{ email: "" }];
    for (let index = 0; index < 8; index += 1) samples.push({ email: `e${index}` });
    const result = fuzzSources(fields, samples);
    expect(result.map((each) => each.path)).toEqual(
      [1, 2, 3, 4, 5].map((n) => `fuzz example ${n}`),
    );
    expect(result[0]?.values).toEqual([{ field: "email", value: "e0" }]);
  });
});

describe("fillSources: what the walk sent", () => {
  const step = (event: string, payload: VizJson) => ({ kind: "event" as const, event, payload });

  test("a field takes the latest value a same-named field was sent with, ranked first", () => {
    const result = fillSources([field("name", "text")], {
      ...live("s", { name: "held" }, null),
      steps: [step("EDIT_NAME", { name: "Al" }), step("EDIT_NAME", { name: "Ada" })],
    });
    expect(result.map((each) => each.path)).toEqual(["Last sent", "s"]);
    expect(result[0]?.values).toEqual([{ field: "name", value: "Ada" }]);
  });

  test("ignores advances, non-object payloads, empty text and unrelated fields", () => {
    const result = fillSources([field("name", "text")], {
      ...live("s", null, null),
      steps: [
        step("A", { name: "kept" }),
        { kind: "advance", ms: 5 },
        step("B", "name"),
        step("C", null),
        step("D", { name: "" }),
        step("E", { other: "x" }),
      ],
    });
    expect(result).toEqual([{ path: "Last sent", values: [{ field: "name", value: "kept" }] }]);
  });

  test("nothing sent means no typed source", () => {
    expect(fillSources([field("name", "text")], { ...live("s", null, null), steps: [] })).toEqual(
      [],
    );
  });
});

describe("knownPayload", () => {
  const step = (event: string, payload: VizJson) => ({ kind: "event" as const, event, payload });
  const card: VizField = { ...field("cardNumber", "text"), sample: "4242 4242 4242 4242" };
  const base = { event: "pay", samples: [], steps: [] };

  test("with nothing sent or fuzzed, the field's example", () => {
    expect(knownPayload([card], base)).toEqual({ payload: { cardNumber: "4242 4242 4242 4242" } });
  });

  test("the fuzzer's first payload beats the example", () => {
    const samples = [{ cardNumber: "1111" }, { cardNumber: "2222" }];
    expect(knownPayload([card], { ...base, samples })).toEqual({ payload: { cardNumber: "1111" } });
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

describe("fillChoices", () => {
  const code = field("code", "text");
  const mode: VizField = { ...field("mode", "choice", ["a", "b"]), sample: "a" };
  const send = (payload: VizJson) => ({ kind: "event" as const, event: "go", payload });
  const labels = (found: ReturnType<typeof fillChoices>) => found.map((each) => each.label);

  test("orders Last sent, Fuzz 1, Fuzz 2, Example", () => {
    const found = fillChoices([code, mode], {
      live: null,
      samples: [
        { code: "z1", mode: "b" },
        { code: "z2", mode: "b" },
      ],
      steps: [send({ code: "sent", mode: "b" })],
    });
    expect(labels(found)).toEqual(["Last sent", "Fuzz 1", "Fuzz 2", "Example"]);
  });

  test("Context is the first match that is not Last sent, titled with where it is", () => {
    const found = fillChoices([code], {
      live: live("idle", null, { code: "held" }),
      samples: [],
      steps: [send({ code: "sent" })],
    });
    expect(found).toEqual([
      { label: "Last sent", title: null, values: [{ field: "code", value: "sent" }] },
      { label: "Example", title: null, values: [{ field: "code", value: "sample" }] },
      { label: "Context", title: "context", values: [{ field: "code", value: "held" }] },
    ]);
  });

  test("Context is offered when nothing was sent", () => {
    const found = fillChoices([code], {
      live: live("idle", null, { code: "held" }),
      samples: [],
      steps: [],
    });
    expect(found.map((each) => [each.label, each.title])).toEqual([
      ["Example", null],
      ["Context", "context"],
    ]);
  });

  test("a choice repeating an earlier one is dropped", () => {
    const found = fillChoices([code], {
      live: live("idle", null, { code: "sample" }),
      samples: [],
      steps: [],
    });
    expect(found).toEqual([]);
  });

  test("past four, Fuzz 2 goes", () => {
    const found = fillChoices([code], {
      live: live("idle", null, { code: "held" }),
      samples: [{ code: "z1" }, { code: "z2" }],
      steps: [send({ code: "sent" })],
    });
    expect(labels(found)).toEqual(["Last sent", "Fuzz 1", "Example", "Context"]);
  });

  test("fewer than two choices: none", () => {
    expect(fillChoices([code], { live: null, samples: [], steps: [] })).toEqual([]);
  });

  test("with only optional fields there is no Example button", () => {
    const note: VizField = { ...code, name: "note", optional: true };
    const found = fillChoices([note], {
      live: null,
      samples: [{ note: "n" }],
      steps: [send({ note: "sent" })],
    });
    expect(labels(found)).toEqual(["Last sent", "Fuzz 1"]);
  });

  test("Example leaves out optional fields", () => {
    const note: VizField = { ...code, name: "note", optional: true };
    const found = fillChoices([code, note], {
      live: null,
      samples: [{ code: "z", note: "n" }],
      steps: [],
    });
    expect(found.at(-1)).toEqual({
      label: "Example",
      title: null,
      values: [{ field: "code", value: "sample" }],
    });
  });
});
