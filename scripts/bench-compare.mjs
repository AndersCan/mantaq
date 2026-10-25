#!/usr/bin/env node
/**
 * Compare benchmark results of the PR against its base (see bench-vs-main.sh).
 *
 * Input dir layout: <dir>/{base,pr}/<round>/<workload>.json (vitest bench results)
 * and alloc.json ({workload: bytesPerOp}). Takes the best (minimum) value across
 * rounds per side, then fails if the PR is worse than base by more than the limit.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MAX_SLOWDOWN = Number(process.env.MANTAQ_BENCH_DELTA ?? 0.25);
const MAX_ALLOC_GROWTH = Number(process.env.MANTAQ_BENCH_ALLOC_GROWTH ?? 0.1);

const [dir, baseRef = "base"] = process.argv.slice(2);

function readSide(side) {
  const timing = {};
  const alloc = {};
  for (const round of readdirSync(join(dir, side))) {
    for (const file of readdirSync(join(dir, side, round))) {
      const data = JSON.parse(readFileSync(join(dir, side, round, file), "utf8"));
      const name = file.replace(/\.json$/, "");
      if (name === "alloc") {
        for (const [workload, bytes] of Object.entries(data)) {
          alloc[workload] = Math.min(alloc[workload] ?? Infinity, bytes);
        }
      } else {
        timing[name] = Math.min(timing[name] ?? Infinity, data.latency.mean);
      }
    }
  }
  return { timing, alloc };
}

const base = readSide("base");
const pr = readSide("pr");
const failures = [];

for (const [name, baseMs] of Object.entries(base.timing)) {
  const ratio = pr.timing[name] / baseMs - 1;
  const line = `${name.padEnd(22)} ${(baseMs * 1e6).toFixed(0).padStart(6)}ns -> ${(pr.timing[name] * 1e6).toFixed(0).padStart(6)}ns  ${(ratio * 100).toFixed(1).padStart(6)}%`;
  console.log(line);
  if (ratio > MAX_SLOWDOWN)
    failures.push(
      `${name} is ${(ratio * 100).toFixed(1)}% slower than ${baseRef} (limit ${MAX_SLOWDOWN * 100}%)`,
    );
}
for (const [name, baseBytes] of Object.entries(base.alloc)) {
  const ratio = pr.alloc[name] / baseBytes - 1;
  console.log(
    `${name.padEnd(22)} ${String(baseBytes).padStart(6)}B  -> ${String(pr.alloc[name]).padStart(6)}B   ${(ratio * 100).toFixed(1).padStart(6)}%`,
  );
  if (ratio > MAX_ALLOC_GROWTH)
    failures.push(
      `${name} allocates ${(ratio * 100).toFixed(1)}% more than ${baseRef} (limit ${MAX_ALLOC_GROWTH * 100}%)`,
    );
}

if (failures.length > 0) {
  console.error(`\nperf regression vs ${baseRef}:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`\nno perf regression vs ${baseRef}`);
