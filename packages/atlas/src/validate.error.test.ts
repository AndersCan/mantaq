import { toAtlas } from "./atlas.ts";
import { createCheckoutActor } from "./fixtures/checkout.ts";
import { parseAtlas, validateAtlas } from "./validate.ts";
import { Either } from "@mantaq/utils";
import { describe, expect, test } from "vite-plus/test";

function valid(): unknown {
  return JSON.parse(JSON.stringify(toAtlas([{ id: "checkout", actor: createCheckoutActor() }])));
}

function issues(value: unknown): string[] {
  return (Either.getLeft(validateAtlas(value)) ?? []).map(
    (issue) => `${issue.path}: ${issue.message}`,
  );
}

describe("validateAtlas rejects", () => {
  test("non-object and wrong version", () => {
    expect(issues(42)).toEqual(["$: expected object"]);
    expect(issues({ schemaVersion: 999, machines: [] })).toEqual([
      expect.stringMatching(/^\$\.schemaVersion: expected \d+, got 999$/),
    ]);
  });

  test("invalid JSON text", () => {
    const result = parseAtlas("{nope");
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
    };
    expect(issues(doc)).toEqual([
      "$.machines[0].fuzz.corpus[0].steps[0].kind: expected event or advance",
      "$.machines[0].fuzz.corpus[0].steps[0].event: expected string",
      "$.machines[0].fuzz.corpus[0].steps[0].payload: expected JSON value",
      "$.machines[0].fuzz.corpus[0].steps[1].payload: expected JSON value",
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
