import { expect, test } from "vite-plus/test";
import {
  clockWorkload,
  contextGuardWorkload,
  dispatchWorkload,
  regionWorkload,
  transitionWorkload,
} from "./workloads.ts";

const FRAME_60_MS = 1000 / 60;
const FRAME_120_MS = 1000 / 120;
// Relative slack vs the committed baseline. Wide on purpose: baselines come
// from a dev machine and CI hardware differs. Catches order-of-magnitude
// regressions (accidental O(n), alloc storms), not 5% drifts.
const MAX_SLOWDOWN = Number(process.env["MANTAQ_BENCH_DELTA"] ?? 2);
// Measure-only mode (bench-vs-main.sh): write results here, assert nothing; the
// script compares best-of-N across alternating base/PR processes.
const OUT_DIR = process.env["MANTAQ_BENCH_OUT"];
const WRITE_BASELINE = process.env["MANTAQ_BENCH_WRITE_BASELINE"] === "1";

const WORKLOADS = [
  { name: "dispatch", make: dispatchWorkload },
  { name: "transition", make: transitionWorkload },
  { name: "context-guard", make: contextGuardWorkload },
  { name: "region-fan-out", make: regionWorkload },
  { name: "virtual-clock-timer", make: clockWorkload },
];

for (const workload of WORKLOADS) {
  test(`${workload.name} stays within baseline`, async ({ bench }) => {
    const baselinePath = `perf/${workload.name}.json`;
    const writeResult = OUT_DIR
      ? `${OUT_DIR}/${workload.name}.json`
      : WRITE_BASELINE
        ? baselinePath
        : `.vitest/bench/${workload.name}.json`;
    const current = bench(workload.name, { writeResult }, workload.make());
    if (WRITE_BASELINE || OUT_DIR) {
      await current.run();
      return;
    }
    const baseline = bench.from(`${workload.name} (baseline)`, baselinePath);
    const results = await bench.compare(current, baseline);
    const meanMs = results.get(workload.name).latency.mean;
    console.log(
      `${workload.name}: ${(meanMs * 1e6).toFixed(0)}ns/op, ` +
        `${Math.floor(FRAME_60_MS / meanMs)} events/60fps frame, ` +
        `${Math.floor(FRAME_120_MS / meanMs)} events/120fps frame`,
    );
    expect(results.get(workload.name)).not.toBeSlowerThan(
      results.get(`${workload.name} (baseline)`),
      { delta: MAX_SLOWDOWN },
    );
  });
}
