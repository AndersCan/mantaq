import { describe, expect, test } from "vite-plus/test";
import { documentOf } from "./embed-document.ts";
import { Either } from "@mantaq/utils";
import { validateViz } from "../validate.ts";

describe("validateViz reads embedded machines", () => {
  test("a state that embeds another machine keeps its reference and the inputs it forwards", () => {
    const paying = { id: "paying", machine: "payment", forward: ["cancel"] };
    const document = documentOf([
      { id: "checkout", states: [paying, { id: "done" }] },
      { id: "payment", states: [{ id: "charging" }] },
    ]);
    expect(Either.getRight(validateViz(JSON.parse(JSON.stringify(document))))).toEqual(document);
  });

  test("two paths to the same machine are not a cycle", () => {
    const document = documentOf([
      {
        id: "order",
        states: [
          { id: "paying", machine: "payment" },
          { id: "shipping", machine: "shipping" },
        ],
      },
      { id: "payment", states: [{ id: "notifying", machine: "email" }] },
      { id: "shipping", states: [{ id: "notifying", machine: "email" }] },
      { id: "email", states: [{ id: "sending" }] },
    ]);
    expect(Either.getRight(validateViz(document))).toEqual(document);
  });
});
