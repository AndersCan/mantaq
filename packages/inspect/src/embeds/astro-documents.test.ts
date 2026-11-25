import { describe, expect, test } from "vite-plus/test";
import { astroMachines } from "../astro.ts";
import { Either } from "@mantaq/utils";
import { join } from "node:path";
import { parseViz } from "@mantaq/viz";

const DOCUMENTS = "\0virtual:mantaq/documents";

/** The per-file documents the Astro plugin serves, by file. */
async function documentsOf(files: string[]): Promise<Record<string, { text: string }>> {
  const plugin = astroMachines({ root: import.meta.dirname, files, fuzz: false });
  const context = {
    warn: () => undefined,
    error: (message: string) => {
      throw new Error(message);
    },
  };
  const load: unknown = Reflect.get(plugin, "load");
  if (typeof load !== "function") return {};
  const source: unknown = await Reflect.apply(load, context, [DOCUMENTS]);
  const line = String(source)
    .split("\n")
    .find((each) => each.startsWith("export const documents = "));
  return JSON.parse((line ?? "{}").replace("export const documents = ", "").replace(/;$/, ""));
}

describe("Astro documents with embedded machines", () => {
  test("the document of a file holds the machine its states embed and validates", async () => {
    const file = join(import.meta.dirname, "..", "fixtures", "embedded", "delivery.ts");
    const documents = await documentsOf([file]);
    const parsed = parseViz(documents[file]?.text ?? "");
    expect({
      issues: Either.getLeft(parsed) ?? [],
      machines: (Either.getRight(parsed)?.machines ?? []).map((machine) => machine.id),
    }).toEqual({ issues: [], machines: ["delivery", "scan"] });
  }, 60_000);
});
