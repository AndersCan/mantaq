/**
 * Atlas CLI. `node src/cli.ts export [outDir]` writes one JSON per example
 * machine plus `examples.json` (all of them), which the viewer loads by default.
 */
import { toAtlas } from "./atlas.ts";
import { exampleInputs } from "./examples.ts";
import { serializeAtlas } from "./serialize.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const DEFAULT_OUT = resolve(import.meta.dirname, "..", "public", "atlas");

function writeDocument(path: string, contents: string): void {
  writeFileSync(path, contents);
  process.stdout.write(`wrote ${path}\n`);
}

function exportExamples(outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  for (const input of exampleInputs()) {
    writeDocument(join(outDir, `${input.id}.json`), serializeAtlas(toAtlas([input])));
  }
  writeDocument(join(outDir, "examples.json"), serializeAtlas(toAtlas(exampleInputs())));
}

const [command, outArg] = process.argv.slice(2);
if (command === "export") {
  exportExamples(outArg === undefined ? DEFAULT_OUT : resolve(outArg));
} else {
  process.stderr.write("usage: node src/cli.ts export [outDir]\n");
  process.exitCode = 1;
}
