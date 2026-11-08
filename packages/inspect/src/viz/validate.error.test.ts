import { toViz } from "../structure.ts";
import { createCheckoutActor } from "../fixtures/checkout.ts";
import { parseViz, validateViz } from "@mantaq/viz";
import { Either } from "@mantaq/utils";
import { describe, expect, test } from "vite-plus/test";

function valid(): unknown {
  return JSON.parse(JSON.stringify(toViz([{ id: "checkout", actor: createCheckoutActor() }])));
}

function issues(value: unknown): string[] {
  return (Either.getLeft(validateViz(value)) ?? []).map(
    (issue) => `${issue.path}: ${issue.message}`,
  );
}

describe("validateViz rejects", () => {
  test("non-object and wrong version", () => {
    expect(issues(42)).toEqual(["$: expected object"]);
    expect(issues({ schemaVersion: 999, machines: [] })).toEqual([
      expect.stringMatching(/^\$\.schemaVersion: expected \d+, got 999$/),
    ]);
  });

  test("version 9 documents and a missing outputs list", () => {
    expect(issues({ schemaVersion: 9, machines: [] })).toEqual([
      "$.schemaVersion: expected 15, got 9",
    ]);
    const doc = valid() as { machines: Array<Record<string, unknown>> };
    delete doc.machines[0]?.["outputs"];
    expect(issues(doc)).toEqual(["$.machines[0].outputs: expected string[]"]);
  });

  test("version 11 documents", () => {
    expect(issues({ schemaVersion: 11, machines: [] })).toEqual([
      "$.schemaVersion: expected 15, got 11",
    ]);
  });

  test("a context field with a bad input kind", () => {
    const doc = valid() as { machines: Array<Record<string, unknown>> };
    const field = {
      name: "a",
      type: "string",
      optional: false,
      doc: null,
      input: "dial",
      choices: [],
      sample: "x",
    };
    doc.machines[0] = { ...doc.machines[0], context: [field] };
    expect(issues(doc)).toEqual([
      "$.machines[0].context[0].input: expected one of text, number, choice, json",
    ]);
  });

  test("invalid JSON text", () => {
    const result = parseViz("{nope");
    expect(Either.getLeft(result)?.[0]?.message).toMatch(/^invalid JSON/);
  });

  test("collects every issue with its path", () => {
    const doc = valid();
    if (typeof doc !== "object" || doc === null || !("machines" in doc)) return;
    const machines = doc.machines;
    if (!Array.isArray(machines)) return;
    machines[0].states[0].final = "yes";
    machines[0].edges[0].kind = "teleport";
    machines[0].edges[1].to = "nowhere";
    expect(issues(doc)).toEqual([
      "$.machines[0].states[0].final: expected boolean",
      "$.machines[0].edges[0].kind: expected one of initial, transition, effect, stay",
      "$.machines[0].edges[1].to: unknown state nowhere",
    ]);
  });

  test("coverage must be null or integer hits", () => {
    const doc = valid();
    if (typeof doc !== "object" || doc === null || !("machines" in doc)) return;
    const machines = doc.machines;
    if (!Array.isArray(machines)) return;
    machines[0].states[0].coverage = { hits: 1.5 };
    expect(issues(doc)).toEqual([
      "$.machines[0].states[0].coverage: expected null or { hits: integer }",
    ]);
  });

  test("fuzz section: bad step kind and non-JSON payload", () => {
    const doc = valid();
    if (typeof doc !== "object" || doc === null || !("machines" in doc)) return;
    const machines = doc.machines;
    if (!Array.isArray(machines)) return;
    machines[0].fuzz = {
      seed: 1,
      iterations: 1,
      corpus: [
        {
          discovered: [],
          steps: [{ kind: "teleport" }, { kind: "event", event: "x", payload: Number.NaN }],
        },
      ],
      errors: [],
      failedExpectations: [],
      expectations: [],
    };
    expect(issues(doc)).toEqual([
      "$.machines[0].fuzz.corpus[0].steps[0].kind: expected event or advance",
      "$.machines[0].fuzz.corpus[0].steps[0].event: expected string",
      "$.machines[0].fuzz.corpus[0].steps[0].payload: expected JSON value",
      "$.machines[0].fuzz.corpus[0].steps[1].payload: expected JSON value",
    ]);
  });

  test("fuzz.failedExpectations: kind must be neverSee or mustSee, steps null or a list", () => {
    const doc = valid();
    if (typeof doc !== "object" || doc === null || !("machines" in doc)) return;
    const machines = doc.machines;
    if (!Array.isArray(machines)) return;
    machines[0].fuzz = {
      seed: 1,
      iterations: 1,
      corpus: [],
      errors: [],
      failedExpectations: [
        { kind: "maybe", state: "a", match: "{}", steps: null },
        { kind: "mustSee", state: "a", match: "{}", steps: null },
      ],
      expectations: [],
    };
    expect(issues(doc)).toEqual([
      "$.machines[0].fuzz.failedExpectations[0].kind: expected neverSee or mustSee",
    ]);
  });

  test("fuzz.expectations: held must be a boolean", () => {
    const doc = valid();
    if (typeof doc !== "object" || doc === null || !("machines" in doc)) return;
    const machines = doc.machines;
    if (!Array.isArray(machines)) return;
    machines[0].fuzz = {
      seed: 1,
      iterations: 1,
      corpus: [],
      errors: [],
      failedExpectations: [],
      expectations: [{ kind: "neverSee", state: "a", match: "{}", held: "yes" }],
    };
    expect(issues(doc)).toEqual(["$.machines[0].fuzz.expectations[0].held: expected boolean"]);
  });

  test("effects: name must be a string, sends null or string[]", () => {
    const doc = valid();
    if (typeof doc !== "object" || doc === null || !("machines" in doc)) return;
    const machines = doc.machines;
    if (!Array.isArray(machines)) return;
    machines[0].states[0].effects = [{ name: 1, sends: null }, { name: "a", sends: [2] }, "b"];
    expect(issues(doc)).toEqual([
      "$.machines[0].states[0].effects[0].name: expected string",
      "$.machines[0].states[0].effects[1].sends: expected string[]",
      "$.machines[0].states[0].effects[2]: expected object",
    ]);
  });

  test("explanation: unknown status and bad branch target", () => {
    const doc = valid();
    if (typeof doc !== "object" || doc === null || !("machines" in doc)) return;
    const machines = doc.machines;
    if (!Array.isArray(machines)) return;
    machines[0].edges[1].explanation = { status: "guessed" };
    machines[0].edges[2].explanation = {
      status: "analyzed",
      location: { file: "a.ts", line: 1, column: 1 },
      registration: "on",
      branches: [{ conditions: [], target: { kind: "teleport" } }],
      payloadReads: [],
      contextReads: [],
      contextWrites: [],
      readsActorState: false,
      comparisons: [],
      literals: [],
    };
    expect(issues(doc)).toEqual([
      "$.machines[0].edges[1].explanation.status: expected one of analyzed, not_analyzed",
      "$.machines[0].edges[1].explanation.location: expected null or object",
      "$.machines[0].edges[1].explanation.reason: expected string",
      "$.machines[0].edges[1].explanation.snippet: expected string",
      "$.machines[0].edges[2].explanation.branches[0].target.kind: expected one of state, stay, unresolved",
    ]);
  });
});

describe("validateViz region steps", () => {
  const withStep = (step: unknown): unknown => {
    const doc = valid() as { machines: Array<{ runs: unknown }> };
    doc.machines[0]!.runs = [{ name: "r", steps: [step] }];
    return doc;
  };

  test("a region step is accepted", () => {
    expect(
      issues(withStep({ kind: "event", event: "go", payload: null, actor: { region: "a" } })),
    ).toEqual([]);
  });

  test("a map child step is accepted", () => {
    expect(
      issues(
        withStep({
          kind: "event",
          event: "go",
          payload: null,
          actor: { map: "photos", key: "p1" },
        }),
      ),
    ).toEqual([]);
  });

  test("a map step without a key is an issue", () => {
    expect(
      issues(withStep({ kind: "event", event: "go", payload: null, actor: { map: "photos" } })),
    ).toEqual(["$.machines[0].runs[0].steps[0].actor: expected {region} or {map, key}"]);
  });

  test("a map that is not a region is an issue, and maps are required", () => {
    const doc = valid() as { machines: Array<Record<string, unknown>> };
    doc.machines[0]!["maps"] = ["photos"];
    expect(issues(doc)).toEqual(['$.machines[0].maps[0]: "photos" is not in regions']);
    delete doc.machines[0]!["maps"];
    expect(issues(doc)).toEqual(["$.machines[0].maps: expected string[]"]);
  });

  test("a bad actor is an issue", () => {
    expect(issues(withStep({ kind: "event", event: "go", payload: null, actor: 3 }))).toEqual([
      "$.machines[0].runs[0].steps[0].actor: expected {region} or {map, key}",
    ]);
  });
});
