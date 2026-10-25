/**
 * Atlas CLI.
 *
 *   node src/cli.ts export [outDir] [--iterations N] [--no-fuzz]
 *
 * Writes one JSON per example machine plus `examples.json` (all of them),
 * which the viewer loads by default. Fuzzing is seeded from MANTAQ_SEED
 * (default from @mantaq/pbt), so the same seed writes identical files.
 */
import type { AtlasMachine } from "./schema.ts";
import { toAtlas } from "./atlas.ts";
import { exampleTargets } from "./examples.ts";
import { fuzz } from "./fuzz/fuzz.ts";
import { fuzzedMachine } from "./fuzz/to-atlas.ts";
import { ATLAS_SCHEMA_VERSION } from "./schema.ts";
import { serializeAtlas } from "./serialize.ts";
import { SEED_ENV, parseSeed } from "@mantaq/pbt";
import { Either } from "@mantaq/utils";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const DEFAULT_OUT = resolve(import.meta.dirname, "..", "public", "atlas");
const DEFAULT_ITERATIONS = 2000;

function writeDocument(path: string, machines: AtlasMachine[]): void {
  writeFileSync(path, serializeAtlas({ schemaVersion: ATLAS_SCHEMA_VERSION, machines }));
  process.stdout.write(`wrote ${path}\n`);
}

function exportExamples(options: {
  outDir: string;
  seed: number;
  iterations: number | null;
}): void {
  mkdirSync(options.outDir, { recursive: true });
  const machines = exampleTargets().map((target) => {
    if (options.iterations === null) {
      return toAtlas([{ id: target.id, actor: target.create().actor }]).machines[0];
    }
    const result = fuzz(target, { seed: options.seed, iterations: options.iterations });
    return fuzzedMachine(target, result);
  });
  for (const machine of machines) {
    if (machine) writeDocument(join(options.outDir, `${machine.id}.json`), [machine]);
  }
  writeDocument(
    join(options.outDir, "examples.json"),
    machines.flatMap((machine) => (machine ? [machine] : [])),
  );
}

function main(): void {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { iterations: { type: "string" }, "no-fuzz": { type: "boolean" } },
  });
  const [command, outArg] = positionals;
  const seed = parseSeed(process.env[SEED_ENV]);
  const iterations = Number(values.iterations ?? DEFAULT_ITERATIONS);
  if (command !== "export" || !Number.isInteger(iterations) || iterations < 0) {
    process.stderr.write("usage: node src/cli.ts export [outDir] [--iterations N] [--no-fuzz]\n");
    process.exitCode = 1;
    return;
  }
  if (Either.isLeft(seed)) {
    process.stderr.write(`${seed[0].message}\n`);
    process.exitCode = 1;
    return;
  }
  exportExamples({
    outDir: outArg === undefined ? DEFAULT_OUT : resolve(outArg),
    seed: seed[1],
    iterations: values["no-fuzz"] === true ? null : iterations,
  });
}

main();
