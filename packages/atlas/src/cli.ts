/**
 * Atlas CLI.
 *
 *   node src/cli.ts export [outDir] [--iterations N] [--no-fuzz] [--no-ast]
 *
 * Writes one JSON per example machine plus `examples.json` (all of them),
 * which the viewer loads by default. Pipeline: probe structure, fuzz
 * (seeded from MANTAQ_SEED, default from @mantaq/pbt), annotate edges from
 * the handler source. Same seed => identical files.
 */
import type { AtlasMachine } from "./schema.ts";
import { toAtlasMachine } from "./atlas.ts";
import { annotateMachine } from "./ast/annotate.ts";
import { EXAMPLE_ROOT, exampleTargets } from "./examples.ts";
import type { Example } from "./examples.ts";
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

interface ExportOptions {
  outDir: string;
  seed: number;
  /** null = structure only, no fuzzing. */
  iterations: number | null;
  ast: boolean;
}

function exampleMachine(example: Example, options: ExportOptions): AtlasMachine {
  const machine =
    options.iterations === null
      ? toAtlasMachine({ id: example.id, actor: example.create().actor })
      : fuzzedMachine(
          example,
          fuzz(example, { seed: options.seed, iterations: options.iterations }),
        );
  return options.ast
    ? annotateMachine(machine, { file: example.source, root: EXAMPLE_ROOT })
    : machine;
}

function exportExamples(options: ExportOptions): void {
  mkdirSync(options.outDir, { recursive: true });
  const machines = exampleTargets().map((example) => exampleMachine(example, options));
  for (const machine of machines) {
    writeDocument(join(options.outDir, `${machine.id}.json`), [machine]);
  }
  writeDocument(join(options.outDir, "examples.json"), machines);
}

function main(): void {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      iterations: { type: "string" },
      "no-fuzz": { type: "boolean" },
      "no-ast": { type: "boolean" },
    },
  });
  const [command, outArg] = positionals;
  const seed = parseSeed(process.env[SEED_ENV]);
  const iterations = Number(values.iterations ?? DEFAULT_ITERATIONS);
  if (command !== "export" || !Number.isInteger(iterations) || iterations < 0) {
    process.stderr.write(
      "usage: node src/cli.ts export [outDir] [--iterations N] [--no-fuzz] [--no-ast]\n",
    );
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
    ast: values["no-ast"] !== true,
  });
}

main();
