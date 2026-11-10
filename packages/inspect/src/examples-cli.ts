/**
 * Repo-only CLI for the bundled example machines (users run `cli.ts`).
 *
 *   node src/examples-cli.ts compare [--seeds N] [--iterations N]
 *
 * Blind vs literal-seeded vs branch-distance fuzzing on every example, as a
 * Markdown report (seeds 1..N).
 */
import { toVizMachine } from "./structure.ts";
import { annotateMachine } from "./ast/annotate.ts";
import { EXAMPLE_ROOT, exampleTargets } from "./examples.ts";
import { compareArms, renderComparison } from "./fuzz/compare.ts";
import { parseArgs } from "node:util";

const DEFAULT_ITERATIONS = 2000;
const DEFAULT_COMPARE_SEEDS = 30;
const USAGE = ["usage: node src/examples-cli.ts compare [--seeds N] [--iterations N]", ""].join(
  "\n",
);

function compareExamples(options: { seeds: number; iterations: number }): void {
  const seeds = Array.from({ length: options.seeds }, (_, index) => index + 1);
  const checkpoints = [25, 50, 100, 250, 500, 1000, 2000].filter((at) => at < options.iterations);
  const rows = exampleTargets().map((example) => {
    const machine = annotateMachine(
      toVizMachine({ id: example.id, actor: example.create().actor }),
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

function main(): void {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      iterations: { type: "string" },
      seeds: { type: "string" },
    },
  });
  const [command] = positionals;
  const iterations = Number(values.iterations ?? DEFAULT_ITERATIONS);
  const seeds = Number(values.seeds ?? DEFAULT_COMPARE_SEEDS);
  const counts = [iterations, seeds].every((count) => Number.isInteger(count) && count >= 0);
  if (command !== "compare" || !counts) {
    process.stderr.write(USAGE);
    process.exitCode = 1;
    return;
  }
  compareExamples({ seeds, iterations });
}

main();
