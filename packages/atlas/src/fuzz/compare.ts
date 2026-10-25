import type { AtlasMachine } from "../schema.ts";
import { fuzz } from "./fuzz.ts";
import type { FuzzOptions, FuzzResult } from "./fuzz.ts";
import { branchDistanceGuide, guidance, literalPool } from "./guided.ts";
import type { FuzzTarget } from "./run.ts";

/**
 * no-loop: Phase 3 mutation only. blind: + looping context-changing steps.
 * literals: + AST literal seeding. distance: + branch-distance guide only.
 * guided: literals + distance (what atlas:export uses).
 */
type Arm = "no-loop" | "blind" | "literals" | "distance" | "guided";

const ARMS: ReadonlyArray<Arm> = ["no-loop", "blind", "literals", "distance", "guided"];

interface ArmSummary {
  arm: Arm;
  /** Mean and sample stddev of handler-outcome features (edge / stay / error) by each checkpoint. */
  branchesAt: Array<{ mean: number; sd: number }>;
  /** Mean wall time per run; reported, not used for decisions (not deterministic). */
  millisPerRun: number;
  /** Mean of all features (incl. states) at the last checkpoint. */
  featuresAtEnd: number;
  /** Per feature: median first-hit iteration over seeds; null = not reached in most seeds. */
  firstHit: Map<string, number | null>;
}

export interface ComparisonRow {
  id: string;
  checkpoints: number[];
  seeds: number[];
  arms: ArmSummary[];
}

function options(
  arm: Arm,
  context: { machine: AtlasMachine; seed: number; iterations: number },
): FuzzOptions {
  const base = { seed: context.seed, iterations: context.iterations };
  if (arm === "no-loop") return { ...base, repeat: false };
  if (arm === "blind") return base;
  if (arm === "distance") return { ...base, guide: branchDistanceGuide(context.machine) };
  if (arm === "literals") return { ...base, literals: literalPool(context.machine) };
  return { ...base, ...guidance(context.machine) };
}

function isBranch(feature: string): boolean {
  return !feature.startsWith("state:");
}

function median(values: ReadonlyArray<number>): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

function mean(values: ReadonlyArray<number>): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function spread(values: ReadonlyArray<number>): { mean: number; sd: number } {
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / Math.max(1, values.length - 1);
  return { mean: average, sd: Math.sqrt(variance) };
}

function summarize(
  arm: Arm,
  run: { results: ReadonlyArray<FuzzResult>; millis: number },
  checkpoints: ReadonlyArray<number>,
): ArmSummary {
  const { results } = run;
  const branchesAt = checkpoints.map((checkpoint) =>
    spread(
      results.map(
        (result) =>
          [...result.firstHit].filter(([feature, at]) => isBranch(feature) && at <= checkpoint)
            .length,
      ),
    ),
  );
  const features = new Set(results.flatMap((result) => [...result.firstHit.keys()]));
  const firstHit = new Map<string, number | null>();
  for (const feature of [...features].sort()) {
    const hits = results.flatMap((result) => {
      const at = result.firstHit.get(feature);
      return at === undefined ? [] : [at];
    });
    firstHit.set(feature, hits.length * 2 > results.length ? median(hits) : null);
  }
  return {
    arm,
    branchesAt,
    millisPerRun: run.millis / Math.max(1, results.length),
    featuresAtEnd: mean(results.map((result) => result.firstHit.size)),
    firstHit,
  };
}

/**
 * Run every arm over `seeds` on one machine. `machine` must carry AST
 * explanations: the literal and guided arms read their comparisons.
 */
export function compareArms(
  target: FuzzTarget,
  context: {
    machine: AtlasMachine;
    seeds: ReadonlyArray<number>;
    checkpoints: ReadonlyArray<number>;
  },
): ComparisonRow {
  const iterations = Math.max(...context.checkpoints);
  const arms = ARMS.map((arm) => {
    const started = performance.now();
    const results = context.seeds.map((seed) =>
      fuzz(target, options(arm, { machine: context.machine, seed, iterations })),
    );
    return summarize(arm, { results, millis: performance.now() - started }, context.checkpoints);
  });
  return { id: target.id, checkpoints: [...context.checkpoints], seeds: [...context.seeds], arms };
}

function cell(value: number | null): string {
  return value === null ? "—" : String(value);
}

/** Features whose median first hit differs between arms: where guidance mattered. */
function contested(row: ComparisonRow): string[] {
  const features = new Set(row.arms.flatMap((arm) => [...arm.firstHit.keys()]));
  return [...features].sort().filter((feature) => {
    const hits = row.arms.map((arm) => arm.firstHit.get(feature) ?? null);
    return new Set(hits).size > 1 && hits.some((hit) => hit === null || hit > 20);
  });
}

export function renderComparison(rows: ReadonlyArray<ComparisonRow>): string {
  const lines: string[] = [];
  for (const row of rows) {
    lines.push(`### ${row.id}`, "");
    lines.push(`Handler outcomes reached (mean of ${row.seeds.length} seeds) by iteration:`, "");
    lines.push(`| arm | ${row.checkpoints.join(" | ")} | all features at end | ms/run |`);
    lines.push(`|---|${row.checkpoints.map(() => "---:").join("|")}|---:|---:|`);
    for (const arm of row.arms) {
      const cells = arm.branchesAt.map(
        (value) => `${value.mean.toFixed(1)} ±${value.sd.toFixed(1)}`,
      );
      lines.push(
        `| ${arm.arm} | ${cells.join(" | ")} | ${arm.featuresAtEnd.toFixed(1)} | ${Math.round(arm.millisPerRun)} |`,
      );
    }
    const hard = contested(row);
    lines.push("");
    if (hard.length === 0) {
      lines.push("No feature's median first-hit iteration differs meaningfully between arms.", "");
      continue;
    }
    lines.push("Median iteration of first hit (— = reached in at most half the seeds):", "");
    lines.push(`| feature | ${row.arms.map((arm) => arm.arm).join(" | ")} |`);
    lines.push(`|---|${row.arms.map(() => "---:").join("|")}|`);
    for (const feature of hard) {
      lines.push(
        `| \`${feature}\` | ${row.arms.map((arm) => cell(arm.firstHit.get(feature) ?? null)).join(" | ")} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
