import { EXAMPLE_ROOT } from "../examples.ts";
import { analyzeModule } from "./annotate.ts";
import type { ModuleAnalysis } from "./annotate.ts";
import { Either } from "@mantaq/utils";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";

const FIXTURES = join(EXAMPLE_ROOT, "packages/inspect/src/fixtures");

function analysis(name: string): ModuleAnalysis | undefined {
  return Either.getRight(analyzeModule({ file: join(FIXTURES, `${name}.ts`), root: EXAMPLE_ROOT }));
}

describe("analyzeModule: machine exports", () => {
  test("each factory shape is called the way its type allows", () => {
    expect(analysis("factories")?.machines).toEqual([
      {
        name: "createDoorActor",
        call: "clock",
        unwrap: "self",
        context: null,
        samples: { open: expect.any(Array) },
      },
      {
        name: "createGate",
        call: "options",
        unwrap: "actor",
        context: null,
        samples: { open: expect.any(Array) },
      },
      {
        name: "createRealDoor",
        call: "call",
        unwrap: "self",
        context: null,
        samples: { open: expect.any(Array) },
      },
      {
        name: "sharedDoor",
        call: "instance",
        unwrap: "self",
        context: null,
        samples: { open: expect.any(Array) },
      },
    ]);
  });

  test("an actor instance is found when it is the only export", () => {
    expect(analysis("instance")?.machines).toEqual([
      {
        name: "retry",
        call: "instance",
        unwrap: "self",
        context: [expect.objectContaining({ name: "attempts", input: "number" })],
        samples: {},
      },
    ]);
  });

  test("a file without machines has none", () => {
    expect(analysis("no-machines")?.machines).toEqual([]);
  });
});

describe("analyzeModule: payload samples from event types", () => {
  test("literal unions vary one field at a time; optional fields stay; void events have none", () => {
    const base = { by: "key", code: "sample", tags: ["sample"], at: { floor: 1, urgent: false } };
    expect(analysis("factories")?.payloads).toEqual({
      open: [base, { ...base, by: "code" }, { ...base, at: { floor: 1, urgent: true } }],
    });
  });

  test("handlers' events across the example machines", () => {
    expect(analysis("credit")?.payloads).toEqual({
      apply: [{ score: 1, amount: 1 }],
      decide: [{ approve: false }, { approve: true }],
      setTier: [{ tier: "sample" }],
    });
    expect(analysis("saga")?.payloads["START"]).toEqual([
      { order: { orderId: "sample", items: ["sample"], amount: 1 } },
    ]);
  });
});

describe("analyzeModule: context and payload fields from types", () => {
  const fields = analysis("fields");

  test("context fields keep declaration order, docs and input kinds; functions are skipped", () => {
    const [found] = fields?.machines ?? [];
    expect(found?.context?.map((field) => [field.name, field.input])).toEqual([
      ["folderId", "text"],
      ["validFor", "choice"],
      ["count", "number"],
      ["enabled", "choice"],
      ["flags", "json"],
    ]);
    expect(found?.context?.[0]).toEqual({
      name: "folderId",
      type: "string",
      optional: false,
      doc: "The album.",
      input: "text",
      choices: [],
      sample: "sample",
    });
    expect(found?.context?.[1]).toMatchObject({ choices: ["10m", "1h"], sample: "10m", doc: null });
    expect(found?.context?.[2]).toMatchObject({ sample: 1 });
    expect(found?.context?.[3]).toMatchObject({ choices: [false, true] });
    expect(found?.context?.[4]).toMatchObject({ optional: true, type: "{ a: boolean; }" });
  });

  test("payload fields per event; events without payload have none", () => {
    expect(fields?.eventPayloads.get("submit")).toMatchObject([{ name: "code", input: "text" }]);
    expect(fields?.eventPayloads.get("choose")).toMatchObject([
      { name: "validFor", input: "choice", doc: "How long it lasts." },
      { name: "code", input: "text", optional: true },
    ]);
    expect(fields?.eventPayloads.has("touch")).toBe(false);
  });

  test("an @example tag becomes the field's sample when it fits", () => {
    const found = analysis("examples")?.eventPayloads.get("save");
    expect(found?.map((field) => [field.name, field.sample])).toEqual([
      ["email", "ana@example.com"],
      ["name", "Ana Lima"],
      ["amount", 1],
      ["tier", "b"],
      ["note", "sample"],
      ["tags", { a: 42 }],
      ["broken", ["sample"]],
      ["level", 2],
      ["size", "s"],
    ]);
    expect(found?.[0]?.doc).toBe("Where to reach them.");
  });

  test("a machine without a declared context has none", () => {
    expect(analysis("documented")?.machines[0]?.context).toBeNull();
  });
});
