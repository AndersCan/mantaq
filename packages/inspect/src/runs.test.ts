import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { VirtualClock } from "@mantaq/core";
import { Either } from "@mantaq/utils";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { EXAMPLE_ROOT } from "./examples.ts";
import { createTimedActor } from "./fixtures/timed.ts";
import { inspectModule } from "./inspect.ts";
import { normalizeRun, readRuns } from "./runs.ts";
import type { FuzzTarget } from "./fuzz/run.ts";

const FIXTURES = join(EXAMPLE_ROOT, "packages/inspect/src/fixtures");

const timed: FuzzTarget = {
  id: "timed",
  create: () => {
    const clock = VirtualClock();
    return { actor: createTimedActor(clock), clock };
  },
};

const start = { kind: "event" as const, event: "start", payload: {} };
const expired = { kind: "event" as const, event: "expired", payload: {} };
const advance = { kind: "advance" as const, ms: 800 };

describe("normalizeRun", () => {
  test("a timer's internal event is dropped: the advance reproduces it", () => {
    const result = normalizeRun(timed, {
      name: "t",
      end: "error",
      steps: [start, advance, expired],
    });
    expect(result).toEqual(Either.right([start, advance]));
  });

  test("an internal event the replay did not produce is kept", () => {
    const result = normalizeRun(timed, { name: "t", end: "error", steps: [start, expired] });
    expect(result).toEqual(Either.right([start, expired]));
  });

  test("a replay that ends elsewhere is left with the reason", () => {
    const result = normalizeRun(timed, { name: "t", end: "error", steps: [start] });
    expect(result[0]).toMatch(
      /^replays to waiting, the test ended in error\. The page builds the actor with only a VirtualClock/,
    );
  });
});

describe("readRuns", () => {
  test("merges the sidecars of a directory by machine id", () => {
    const { runs } = readRuns(FIXTURES);
    expect(runs["timed"]?.map((run) => run.name)).toEqual(["times out", "waits"]);
  });

  test("no __runs__ folder: nothing", () => {
    expect(readRuns(join(FIXTURES, "nowhere"))).toEqual({ runs: {}, warnings: [] });
  });
});

describe("inspectModule with recorded runs", () => {
  test("sidecar runs become machine.runs and fill `tested`", async () => {
    const file = join(FIXTURES, "timed.ts");
    const { machines, warnings } = await inspectModule(file, {
      load: (path) => import(path),
      fuzz: { iterations: 0 },
    });
    expect(warnings).toEqual([]);
    expect(machines[0]?.runs).toEqual([
      { name: "times out", steps: [start, advance] },
      { name: "waits", steps: [start] },
    ]);
    const edge = machines[0]?.edges.find((each) => each.event === "start");
    expect(edge?.tested).toEqual({ hits: 2 });
  });

  test("the same runs and seed give the same document", async () => {
    const options = { load: (path: string) => import(path), fuzz: { iterations: 50, seed: 7 } };
    const file = join(FIXTURES, "timed.ts");
    const first = await inspectModule(file, options);
    const second = await inspectModule(file, options);
    expect(second.machines).toEqual(first.machines);
  });
});

describe("recorded runs that cannot be trusted", () => {
  const load = (path: string) => import(path);

  test("an unknown event drops the run with a warning", async () => {
    const sidecar = JSON.stringify({
      retry: [
        {
          name: "stale",
          end: "idle",
          steps: [{ kind: "event", event: "nonexistent", payload: null }],
        },
      ],
    });
    const dir = mkdtempSync(join(tmpdir(), "runs-"));
    mkdirSync(join(dir, "__runs__"));
    writeFileSync(join(dir, "__runs__", "a.json"), sidecar);
    writeFileSync(
      join(dir, "retry.ts"),
      `export * from ${JSON.stringify(join(FIXTURES, "retry.ts"))};\n`,
    );
    const result = await inspectModule(join(dir, "retry.ts"), { load, fuzz: { iterations: 0 } });
    expect(result.warnings.join("\n")).toContain('run "stale" dropped');
  });

  test("a negative advance is malformed and warned about", () => {
    const dir = mkdtempSync(join(tmpdir(), "runs-"));
    mkdirSync(join(dir, "__runs__"));
    writeFileSync(
      join(dir, "__runs__", "a.json"),
      JSON.stringify({ m: [{ name: "x", end: "idle", steps: [{ kind: "advance", ms: -5 }] }] }),
    );
    const { runs, warnings } = readRuns(dir);
    expect(runs["m"]).toEqual([]);
    expect(warnings).toEqual(['__runs__/a.json: 1 malformed run(s) for "m" ignored']);
  });

  test("corrupt JSON is warned about", () => {
    const dir = mkdtempSync(join(tmpdir(), "runs-"));
    mkdirSync(join(dir, "__runs__"));
    writeFileSync(join(dir, "__runs__", "a.json"), "{nope");
    expect(readRuns(dir).warnings).toEqual(["__runs__/a.json: not a JSON object, ignored"]);
  });

  test("a run whose end differs is dropped with the replay warning", async () => {
    const file = join(FIXTURES, "timed.ts");
    const dir = mkdtempSync(join(tmpdir(), "runs-"));
    mkdirSync(join(dir, "__runs__"));
    writeFileSync(
      join(dir, "__runs__", "a.json"),
      JSON.stringify({ timed: [{ name: "wrong", end: "error", steps: [start] }] }),
    );
    writeFileSync(join(dir, "timed.ts"), `export * from ${JSON.stringify(file)};\n`);
    const result = await inspectModule(join(dir, "timed.ts"), { load, fuzz: { iterations: 0 } });
    expect(result.warnings).toContain(
      `timed: run "wrong" dropped: replays to waiting, the test ended in error. The page builds the actor with only a VirtualClock; a test that passes other options can end elsewhere. Build this test's actor with only the clock, or give the factory defaults that act like those options.`,
    );
  });

  test("an instance export is left untouched and its runs are not shown", async () => {
    const file = join(FIXTURES, "instance.ts");
    const dir = mkdtempSync(join(tmpdir(), "runs-"));
    mkdirSync(join(dir, "__runs__"));
    writeFileSync(
      join(dir, "__runs__", "a.json"),
      JSON.stringify({
        retry: [
          {
            name: "c",
            end: "connecting",
            steps: [{ kind: "event", event: "connect", payload: null }],
          },
        ],
      }),
    );
    writeFileSync(join(dir, "instance.ts"), `export * from ${JSON.stringify(file)};\n`);
    const exported = await import(file);
    const before = exported.retry.state.name;
    const result = await inspectModule(join(dir, "instance.ts"), { load });
    expect(exported.retry.state.name).toBe(before);
    expect(result.machines[0]?.runs ?? []).toEqual([]);
    expect(result.warnings.join("\n")).toContain("retry: runs not shown");
  });
});
