import { describe, expect, test } from "vite-plus/test";
import { documentOf } from "./embed-document.ts";
import { Either } from "@mantaq/utils";
import { validateViz } from "../validate.ts";

function issuesOf(value: unknown): string[] {
  return (Either.getLeft(validateViz(value)) ?? []).map(
    (issue) => `${issue.path}: ${issue.message}`,
  );
}

describe("validateViz rejects embedded machines", () => {
  test("a reference to a machine the document does not have", () => {
    const document = documentOf([{ id: "checkout", states: [{ id: "paying", machine: "pay" }] }]);
    expect(issuesOf(document)).toEqual(['$.machines[0].states[0].machine: unknown machine "pay"']);
  });

  test("a machine that embeds itself", () => {
    const document = documentOf([
      { id: "checkout", states: [{ id: "again", machine: "checkout" }] },
    ]);
    expect(issuesOf(document)).toEqual([
      '$.machines[0].states[0].machine: machine "checkout" embeds itself: checkout > checkout',
    ]);
  });

  test("a cycle through other machines, at each reference on it and nowhere else", () => {
    const document = documentOf([
      { id: "order", states: [{ id: "paying", machine: "payment" }] },
      { id: "payment", states: [{ id: "refunding", machine: "refund" }] },
      {
        id: "refund",
        states: [
          { id: "reordering", machine: "order" },
          { id: "mailing", machine: "email" },
        ],
      },
      { id: "email", states: [{ id: "sending" }] },
    ]);
    expect(issuesOf(document)).toEqual([
      '$.machines[0].states[0].machine: machine "order" embeds itself: order > payment > refund > order',
      '$.machines[1].states[0].machine: machine "payment" embeds itself: payment > refund > order > payment',
      '$.machines[2].states[0].machine: machine "refund" embeds itself: refund > order > payment > refund',
    ]);
  });

  test("a reference that is not a string", () => {
    const document = documentOf([{ id: "checkout", states: [{ id: "paying" }] }]);
    const parsed = JSON.parse(JSON.stringify(document));
    parsed.machines[0].states[0].machine = null;
    expect(issuesOf(parsed)).toEqual(["$.machines[0].states[0].machine: expected string"]);
  });

  test("forwarded inputs that are not a list of strings", () => {
    const document = documentOf([{ id: "checkout", states: [{ id: "paying" }] }]);
    const parsed = JSON.parse(JSON.stringify(document));
    parsed.machines[0].states[0].forward = "cancel";
    expect(issuesOf(parsed)).toEqual(["$.machines[0].states[0].forward: expected string[]"]);
  });

  test("nothing about embeds while the document has other read errors", () => {
    const document = documentOf([{ id: "checkout", states: [{ id: "paying", machine: "pay" }] }]);
    expect(issuesOf({ ...document, machines: [42, ...document.machines] })).toEqual([
      "$.machines[0]: expected object",
    ]);
  });

  test("a version 18 document, from before states could embed a machine", () => {
    expect(issuesOf({ schemaVersion: 18, machines: [] })).toEqual([
      "$.schemaVersion: expected 19, got 18",
    ]);
  });
});
