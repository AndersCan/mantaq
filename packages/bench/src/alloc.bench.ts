import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import {
  clockWorkload,
  contextGuardWorkload,
  dispatchWorkload,
  regionWorkload,
  transitionWorkload,
} from "./workloads.ts";

// Heap bytes allocated per operation. Unlike wall time this is near-deterministic
// (same Node major, no GC during the window thanks to the large semi-space in
// vite.config.ts), so it can carry a tight limit and catch the usual accidental
// regressions: extra spreads, copies, closures, wrapper objects.
const OPS = 5000;
const ROUNDS = 15;
const WARMUP_OPS = 300_000;
const MAX_GROWTH = Number(process.env["MANTAQ_BENCH_ALLOC_GROWTH"] ?? 0.1);
const WRITE_BASELINE = process.env["MANTAQ_BENCH_WRITE_BASELINE"] === "1";
const OUT_DIR = process.env["MANTAQ_BENCH_OUT"];
const BASELINE_FILE = "perf/alloc.json";

const WORKLOADS = {
  dispatch: dispatchWorkload,
  transition: transitionWorkload,
  "context-guard": contextGuardWorkload,
  "region-fan-out": regionWorkload,
  "virtual-clock-timer": clockWorkload,
};

function bytesPerOp(run: () => void): number {
  for (let i = 0; i < WARMUP_OPS; i++) run();
  const samples: number[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    globalThis.gc?.();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < OPS; i++) run();
    samples.push(Math.round((process.memoryUsage().heapUsed - before) / OPS));
  }
  // min, not median: JIT/compiler noise only ever adds bytes, never removes them.
  return Math.min(...samples);
}

test("allocation per operation stays within baseline", () => {
  expect(typeof globalThis.gc, "run with --expose-gc (set in vite.config.ts)").toBe("function");
  const current: Record<string, number> = {};
  for (const [name, make] of Object.entries(WORKLOADS)) current[name] = bytesPerOp(make());
  console.log(`bytes/op: ${JSON.stringify(current)}`);
  if (OUT_DIR) mkdirSync(OUT_DIR, { recursive: true });
  if (WRITE_BASELINE || OUT_DIR) {
    writeFileSync(
      OUT_DIR ? `${OUT_DIR}/alloc.json` : BASELINE_FILE,
      `${JSON.stringify(current, null, 2)}\n`,
    );
    return;
  }
  const baseline: Record<string, number> = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
  for (const [name, bytes] of Object.entries(current)) {
    const allowed = (baseline[name] ?? 0) * (1 + MAX_GROWTH);
    expect(
      bytes,
      `${name} allocates ${bytes}B/op, baseline ${baseline[name]}B/op`,
    ).toBeLessThanOrEqual(allowed);
  }
});
