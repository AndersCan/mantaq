import { EXAMPLE_ROOT } from "./examples.ts";
import { vizDocument } from "./inspect.ts";
import { inspectFile } from "./load.ts";
import { htmlPage } from "./page.ts";
import { DOCUMENT_ELEMENT_ID, parseViz } from "@mantaq/viz";
import { Either } from "@mantaq/utils";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";

const FACTORIES = join(EXAMPLE_ROOT, "packages/inspect/src/fixtures/factories.ts");

describe("inspectFile", () => {
  // A machine loaded through Vite and inspected from plain Node would see two
  // copies of @mantaq/core, and no state would be recognized (initial null).
  test("loads through Vite and inspects in the same module graph", async () => {
    const result = await inspectFile(FACTORIES, { fuzz: { iterations: 100 } });
    expect(result.machines.map((machine) => [machine.id, machine.initial])).toEqual([
      ["door", "closed"],
      ["gate", "closed"],
      ["realDoor", "closed"],
    ]);
    const door = result.machines[0];
    expect(door?.edges.find((edge) => edge.event === "open")?.explanation?.status).toBe("analyzed");
  });
});

describe("htmlPage", () => {
  test("one file with the viewer and a valid document inlined", async () => {
    const { machines } = await inspectFile(FACTORIES, { fuzz: false });
    const page = await htmlPage(vizDocument(machines), "doors");
    expect(page).toContain("<title>doors</title>");
    expect(page).not.toMatch(/<script[^>]+src=/);
    const embedded = page.match(
      new RegExp(`<script type="application/json" id="${DOCUMENT_ELEMENT_ID}">([^<]*)</script>`),
    )?.[1];
    const parsed = parseViz(embedded ?? "");
    expect(Either.isRight(parsed)).toBe(true);
    expect(Either.getRight(parsed)?.machines).toHaveLength(3);
  });
});
