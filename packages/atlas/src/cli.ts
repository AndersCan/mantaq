/**
 * Atlas CLI.
 *
 *   node src/cli.ts export [outDir] [--iterations N] [--no-fuzz] [--no-ast]
 *   node src/cli.ts compare [--seeds N] [--iterations N]
 *
 * export: one JSON per example machine plus `examples.json` (all of them),
 * which the viewer loads by default. Pipeline: probe structure, annotate
 * edges from handler source (AST), fuzz guided by the AST's literals and
 * comparisons (seeded from MANTAQ_SEED, default from @mantaq/pbt), annotate
 * fuzz-found edges, then replay the transcribed example tests for `tested`
 * coverage. Same seed => identical files.
 *
 * compare: blind vs literal-seeded vs branch-distance fuzzing on every
 * example, as a Markdown report (seeds 1..N).
 */
import type { AtlasMachine } from "./schema.ts";
import { toAtlasMachine } from "./atlas.ts";
import { annotateMachine } from "./ast/annotate.ts";
import { EXAMPLE_ROOT, exampleTargets, handWrittenBaselines } from "./examples.ts";
import type { Example } from "./examples.ts";
import { compareArms, renderComparison } from "./fuzz/compare.ts";
import { withTestCoverage } from "./fuzz/coverage.ts";
import { fuzz } from "./fuzz/fuzz.ts";
import { guidance } from "./fuzz/guided.ts";
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
const DEFAULT_COMPARE_SEEDS = 30;
const USAGE = [
  "usage: node src/cli.ts export [outDir] [--iterations N] [--no-fuzz] [--no-ast]",
  "       node src/cli.ts compare [--seeds N] [--iterations N]",
  "",
].join("\n");

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

function annotate(machine: AtlasMachine, example: Example, options: ExportOptions): AtlasMachine {
  return options.ast
    ? annotateMachine(machine, { file: example.source, root: EXAMPLE_ROOT })
    : machine;
}

function exampleMachine(example: Example, options: ExportOptions): AtlasMachine {
  const plain = toAtlasMachine({ id: example.id, actor: example.create().actor });
  const structure = annotate(plain, example, options);
  const machine =
    options.iterations === null
      ? structure
      : fuzzedMachine(
          example,
          fuzz(example, {
            seed: options.seed,
            iterations: options.iterations,
            ...(options.ast ? guidance(structure) : {}),
          }),
        );
  const tests = handWrittenBaselines()[example.id] ?? [];
  return annotate(withTestCoverage(example, machine, tests), example, options);
}

function compareExamples(options: { seeds: number; iterations: number }): void {
  const seeds = Array.from({ length: options.seeds }, (_, index) => index + 1);
  const checkpoints = [25, 50, 100, 250, 500, 1000, 2000].filter((at) => at < options.iterations);
  const rows = exampleTargets().map((example) => {
    const machine = annotateMachine(
      toAtlasMachine({ id: example.id, actor: example.create().actor }),
      {
        file: example.source,
        root: EXAMPLE_ROOT,
      },
    );
    return compareArms(example, {
      machine,
      seeds,
      checkpoints: [...checkpoints, options.iterations],
    });
  });
  process.stdout.write(renderComparison(rows));
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
      seeds: { type: "string" },
      "no-fuzz": { type: "boolean" },
      "no-ast": { type: "boolean" },
    },
  });
  const [command, outArg] = positionals;
  const seed = parseSeed(process.env[SEED_ENV]);
  const iterations = Number(values.iterations ?? DEFAULT_ITERATIONS);
  const seeds = Number(values.seeds ?? DEFAULT_COMPARE_SEEDS);
  const counts = [iterations, seeds].every((count) => Number.isInteger(count) && count >= 0);
  if ((command !== "export" && command !== "compare") || !counts) {
    process.stderr.write(USAGE);
    process.exitCode = 1;
    return;
  }
  if (command === "compare") {
    compareExamples({ seeds, iterations });
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
