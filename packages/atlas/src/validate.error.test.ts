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
      "$.machines[0].edges[0].kind: expected one of initial, transition, effect",
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
});
