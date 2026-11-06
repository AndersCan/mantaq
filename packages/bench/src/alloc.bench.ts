import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PerformanceObserver } from "node:perf_hooks";
import { expect, test } from "vite-plus/test";
import {
  clockWorkload,
  contextGuardWorkload,
  dispatchWorkload,
  regionWorkload,
  transitionWorkload,
} from "./workloads.ts";

// Heap bytes allocated per operation. Unlike wall time this is near-deterministic
// (same Node major) so it can carry a tight limit and catch the usual accidental
// regressions: extra spreads, copies, closures, wrapper objects.
// heapUsed deltas are only valid when no GC ran inside the window: a scavenge frees
// part of what the loop allocated and deflates the reading (workloads that make more
// garbage then look cheaper). vite.config.ts pins the semi-space so a round fits in
// new space, and a round that still observes a gc entry is discarded and re-run.
const OPS = 5000;
const ROUNDS = 15;
const MAX_ATTEMPTS = ROUNDS * 4;
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

const gcEntries: number[] = [];
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) gcEntries.push(entry.startTime);
}).observe({ entryTypes: ["gc"] });

// gc entries are delivered on the event loop, so let it turn (timer, not setImmediate: delivery lags one tick) before reading them.
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

async function bytesPerOp(run: () => void): Promise<number> {
  for (let i = 0; i < WARMUP_OPS; i++) run();
  const samples: number[] = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS && samples.length < ROUNDS; attempt++) {
    globalThis.gc?.();
    await settle();
    const seen = gcEntries.length;
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < OPS; i++) run();
    const after = process.memoryUsage().heapUsed;
    await settle();
    if (gcEntries.length !== seen) continue;
    samples.push(Math.round((after - before) / OPS));
  }
  if (samples.length < ROUNDS) {
    throw new Error(`only ${samples.length}/${ROUNDS} gc-free rounds in ${MAX_ATTEMPTS} attempts`);
  }
  // min, not median: JIT/compiler noise only ever adds bytes, never removes them.
  return Math.min(...samples);
}

test("allocation per operation stays within baseline", async () => {
  expect(typeof globalThis.gc, "run with --expose-gc (set in vite.config.ts)").toBe("function");
  const current: Record<string, number> = {};
  for (const [name, make] of Object.entries(WORKLOADS)) current[name] = await bytesPerOp(make());
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
