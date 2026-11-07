import { routingWarnings, unhandledSends, VIZ_SCHEMA_VERSION } from "@mantaq/viz";
import type { VizDocument, VizJson, VizMachine, VizRun } from "@mantaq/viz";
import { analyzeModule, annotateWith } from "./ast/annotate.ts";
import type { ModuleAnalysis } from "./ast/annotate.ts";
import type { MachineExport } from "./ast/discover.ts";
import type { AnalysisSource } from "./ast/program.ts";
import { coverageGoal, unreached, withTestCoverage } from "./fuzz/coverage.ts";
import { fuzz } from "./fuzz/fuzz.ts";
import type { FuzzOptions, FuzzStop } from "./fuzz/fuzz.ts";
import { guidance } from "./fuzz/guided.ts";
import type { FuzzTarget } from "./fuzz/run.ts";
import { fuzzedMachine } from "./fuzz/to-viz.ts";
import { toVizMachine } from "./structure.ts";
import { DEFAULT_SEED } from "@mantaq/pbt";
import { Either } from "@mantaq/utils";
import { VirtualClock } from "@mantaq/core";
import type { AnyActor, Clock } from "@mantaq/core";
import { normalizeRun, readRuns } from "./runs.ts";
import type { RecordedRuns } from "./runs.ts";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const DEFAULT_ITERATIONS = 2000;

export interface FuzzSettings {
  seed?: number;
  /** Most runs to try. Default 2000; no cap when `timeLimitMs` is set alone. */
  iterations?: number;
  /**
   * Wall-time budget for one machine. With it, fuzzing also stops as soon as
   * every state and edge is covered. The runs stay seeded (same seed, same
   * sequence); only how many ran depends on the machine's speed, so leave it
   * out for a reproducible export.
   */
  timeLimitMs?: number;
}

/** The one wall-clock read in inspect: only a `timeLimitMs` budget uses it. */
const wallClock = (): number => performance.now();

const STOPPED: Record<FuzzStop, string> = {
  covered: "full coverage",
  iterations: "iteration cap",
  time: "time limit",
};

/** Fuzz options for the settings: an iteration count, or a time budget that ends on full coverage. */
function budget(
  settings: FuzzSettings | undefined,
  structure: VizMachine,
): Pick<FuzzOptions, "iterations" | "done" | "deadline"> {
  const limit = settings?.timeLimitMs;
  if (limit === undefined) return { iterations: settings?.iterations ?? DEFAULT_ITERATIONS };
  return {
    iterations: settings?.iterations ?? Number.POSITIVE_INFINITY,
    done: coverageGoal(structure),
    deadline: { ms: limit, now: wallClock },
  };
}

/** What fuzzing missed and how to get further, or nothing when it reached everything. */
function fuzzWarnings(
  machine: VizMachine,
  run: { stopped: FuzzStop; unsampled: string[] },
): string[] {
  const missed = unreached(machine);
  const iterations = machine.fuzz?.iterations ?? 0;
  const never =
    missed.length === 0
      ? []
      : [
          `fuzz never reached: ${missed.join(", ")} (ran ${iterations} iterations, stopped: ${STOPPED[run.stopped]}). Raise fuzz.timeLimitMs / iterations or add a named run to \`tests\`.`,
        ];
  const unsampled =
    run.unsampled.length === 0
      ? []
      : [
          `no source, so payload types are unknown: fuzz sends ${run.unsampled.join(", ")} without a payload. Pass \`source\` (samples from the event types) or \`payloads\`.`,
        ];
  return [...never, ...unsampled];
}

export interface InspectTarget {
  id: string;
  /** A fresh actor on every call. Fuzzing needs it to run on a VirtualClock. */
  create: () => AnyActor<unknown>;
  /** File with the `m.on` calls: edge explanations, and payload samples from the event types. */
  source?: AnalysisSource;
  /** Sample payloads per event; replace the ones read from types. */
  payloads?: Readonly<Record<string, ReadonlyArray<VizJson>>>;
  /** Named runs your tests take: "Coverage from: example tests", fuzz seeds, and the live page's Runs list. */
  tests?: ReadonlyArray<VizRun>;
  /** `false` = structure only. */
  fuzz?: false | FuzzSettings;
}

export interface Inspected {
  machine: VizMachine;
  /** Things worth fixing or knowing: unreachable routing, unhandled sends, why fuzzing was skipped. */
  warnings: string[];
}

function isVirtualClock(clock: Clock): clock is VirtualClock {
  return typeof Reflect.get(clock, "advance") === "function";
}

function warningsOf(machine: VizMachine): string[] {
  const routing = routingWarnings(machine).map((warning) => warning.message);
  const sends = machine.states.flatMap((state) =>
    unhandledSends(machine, state.id).map(
      ({ effect, event }) =>
        `effect ${effect} in ${state.id} sends ${event}, but ${state.id} has no handler for it`,
    ),
  );
  return [...routing, ...sends];
}

/** The target as the fuzzer drives it, or why it cannot run on a virtual clock. */
function runner(
  target: InspectTarget,
  payloads: Readonly<Record<string, ReadonlyArray<VizJson>>>,
): Either<string, FuzzTarget> {
  if (!isVirtualClock(target.create().clock)) {
    return Either.left("not fuzzed: the actor does not run on a VirtualClock");
  }
  return Either.right({
    id: target.id,
    create: () => {
      const actor = target.create();
      return { actor, clock: isVirtualClock(actor.clock) ? actor.clock : VirtualClock() };
    },
    payloads,
  });
}

function annotator(
  target: InspectTarget,
  analysis: Either<string, ModuleAnalysis> | null,
): (machine: VizMachine) => VizMachine {
  const { source } = target;
  if (analysis === null || source === undefined) return (machine) => machine;
  return (machine) => annotateWith(machine, { analysis, source });
}

/** Fuzz and test coverage on top of the structure, as far as the target allows. */
function driven(
  target: InspectTarget,
  context: { structure: VizMachine; run: Either<string, FuzzTarget> },
): { machine: VizMachine; notes: string[] } {
  const { structure, run } = context;
  if (Either.isLeft(run)) return { machine: structure, notes: [run[0]] };
  const settings = target.fuzz;
  const fuzzed = settings === false ? null : fuzzRun(run[1], { target, settings, structure });
  const base = fuzzed?.machine ?? structure;
  const machine =
    target.tests === undefined
      ? base
      : withTestCoverage(
          run[1],
          base,
          target.tests.map((each) => each.steps),
        );
  return { machine, notes: fuzzed?.warnings ?? [] };
}

function fuzzRun(
  runner: FuzzTarget,
  context: { target: InspectTarget; settings: FuzzSettings | undefined; structure: VizMachine },
): { machine: VizMachine; warnings: string[] } {
  const { target, settings, structure } = context;
  const result = fuzz(runner, {
    seed: settings?.seed ?? DEFAULT_SEED,
    ...budget(settings, structure),
    ...(target.tests === undefined ? {} : { initial: target.tests.map((each) => each.steps) }),
    ...guidance(structure),
  });
  const machine = fuzzedMachine(runner, result);
  const sampled = runner.payloads ?? {};
  const unsampled =
    target.source === undefined
      ? structure.events.map((event) => event.id).filter((id) => sampled[id] === undefined)
      : [];
  return { machine, warnings: fuzzWarnings(machine, { stopped: result.stopped, unsampled }) };
}

function inspectWith(
  target: InspectTarget,
  analysis: Either<string, ModuleAnalysis> | null,
): Inspected {
  const annotate = annotator(target, analysis);
  const inferred = Either.getRight(analysis ?? Either.left("none"))?.payloads ?? {};
  const structure = annotate(toVizMachine({ id: target.id, actor: target.create() }));
  const run = runner(target, { ...inferred, ...target.payloads });
  const { machine, notes } = driven(target, { structure, run });
  const quiet = target.fuzz === false && target.tests === undefined;
  const unanalyzed =
    analysis === null ? [] : [Either.getLeft(analysis)].filter((each) => each !== undefined);
  const annotated = annotate({ ...machine, runs: [...(target.tests ?? [])] });
  return {
    machine: annotated,
    warnings: [...unanalyzed, ...(quiet ? [] : notes), ...warningsOf(annotated)],
  };
}

/**
 * One machine in, one viz machine out: structure, edge explanations and
 * payloads from the source's types, fuzz coverage, test coverage. Each part
 * that cannot run is skipped with a warning, never guessed.
 */
export function inspect(target: InspectTarget): Inspected {
  return inspectWith(target, target.source === undefined ? null : analyzeModule(target.source));
}

/** Directory of the nearest package.json above `file`: locations are reported relative to it. */
export function projectRoot(file: string): string {
  let dir = dirname(file);
  while (!existsSync(join(dir, "package.json")) && dirname(dir) !== dir) dir = dirname(dir);
  return dir;
}

/** `createCheckoutActor` → `checkout`; other names are kept. */
export function machineId(exportName: string): string {
  const core = exportName.replace(/^create/, "").replace(/Actor$/, "");
  return core === "" ? exportName : core.charAt(0).toLowerCase() + core.slice(1);
}

function isActor(value: unknown): value is AnyActor<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    ["send", "snapshot", "inject"].every((key) => typeof Reflect.get(value, key) === "function")
  );
}

/** Call an export the way its type says, and take the actor out of what it returns. */
function factoryOf(found: MachineExport, value: unknown): (() => unknown) | null {
  if (found.call === "instance") return () => value;
  if (typeof value !== "function") return null;
  const argument =
    found.call === "clock"
      ? () => [VirtualClock()]
      : found.call === "options"
        ? () => [{ clock: VirtualClock() }]
        : () => [];
  return () => Reflect.apply(value, undefined, argument());
}

function actorFactory(found: MachineExport, value: unknown): (() => AnyActor<unknown>) | null {
  const factory = factoryOf(found, value);
  if (factory === null) return null;
  const unwrap = (result: unknown): unknown =>
    found.unwrap === "actor" && typeof result === "object" && result !== null
      ? Reflect.get(result, "actor")
      : result;
  const sample = unwrap(factory());
  if (!isActor(sample)) return null;
  return () => {
    const actor = unwrap(factory());
    return isActor(actor) ? actor : sample;
  };
}

/** The recorded runs of one machine that replay faithfully, and a warning for each that does not. */
function replayedRuns(
  id: string,
  create: () => AnyActor<unknown>,
  recorded: RecordedRuns,
): { runs: VizRun[]; warnings: string[] } {
  const found = recorded[id] ?? [];
  if (found.length === 0) return { runs: [], warnings: [] };
  const run = runner({ id, create }, {});
  if (Either.isLeft(run)) return { runs: [], warnings: [`runs not shown: ${run[0]}`] };
  const results = found.map((each) => ({ each, result: normalizeRun(run[1], each) }));
  return {
    runs: results.flatMap(({ each, result }) =>
      Either.isRight(result) ? [{ name: each.name, steps: result[1] }] : [],
    ),
    warnings: results.flatMap(({ each, result }) =>
      Either.isLeft(result) ? [`run "${each.name}" dropped: ${result[0]}`] : [],
    ),
  };
}

export interface ModuleOptions {
  /** Import the file and return its exports (e.g. Vite's `runnerImport`, `ssrLoadModule`). */
  load: (file: string) => Promise<Record<string, unknown>>;
  /** Locations are relative to this. Default: nearest package.json above the file. */
  root?: string;
  tsconfig?: string;
  fuzz?: false | FuzzSettings;
}

export interface InspectedModule {
  machines: VizMachine[];
  /** Prefixed with the machine id, or the file when it is about the file. */
  warnings: string[];
}

/**
 * Every machine a file exports, found from its types: actors, and functions
 * that build one (optionally taking a clock or `{ clock }`). When a file has
 * factories, plain actor exports are skipped: they are usually one of those
 * factories' results, and cannot be fuzzed.
 */
export async function inspectModule(
  file: string,
  options: ModuleOptions,
): Promise<InspectedModule> {
  const source: AnalysisSource = {
    file,
    root: options.root ?? projectRoot(file),
    ...(options.tsconfig === undefined ? {} : { tsconfig: options.tsconfig }),
  };
  const analysis = analyzeModule(source);
  if (Either.isLeft(analysis)) return { machines: [], warnings: [`${file}: ${analysis[0]}`] };
  const found = analysis[1].machines;
  const factories = found.filter((each) => each.call !== "instance");
  const chosen = factories.length > 0 ? factories : found;
  if (chosen.length === 0) {
    return { machines: [], warnings: [`${file}: no exported actor or actor factory found`] };
  }
  const exports = await options.load(file);
  const { runs: recorded, warnings: runWarnings } = readRuns(dirname(file));
  const results = chosen.map((each) => {
    const id = machineId(each.name);
    const create = actorFactory(each, exports[each.name]);
    if (create === null)
      return { machine: null, warnings: [`${id}: ${each.name} did not return an actor`] };
    const fuzzSettings: false | FuzzSettings =
      each.call === "instance" ? false : (options.fuzz ?? {});
    const replayed =
      each.call === "instance"
        ? {
            runs: [],
            warnings:
              (recorded[id] ?? []).length === 0
                ? []
                : ["runs not shown: exported as one actor, so they cannot be replayed safely"],
          }
        : replayedRuns(id, create, recorded);
    const inspected = inspectWith(
      {
        id,
        create,
        source,
        fuzz: fuzzSettings,
        ...(replayed.runs.length === 0 ? {} : { tests: replayed.runs }),
      },
      analysis,
    );
    const instance =
      each.call === "instance" ? ["not fuzzed: exported as one actor, not a factory"] : [];
    return {
      machine: inspected.machine,
      warnings: [...instance, ...replayed.warnings, ...inspected.warnings].map(
        (warning) => `${id}: ${warning}`,
      ),
    };
  });
  return {
    machines: results.flatMap((result) => (result.machine === null ? [] : [result.machine])),
    warnings: [
      ...runWarnings.map((warning) => `${file}: ${warning}`),
      ...results.flatMap((result) => result.warnings),
    ],
  };
}

/** Machines as a document, ready for `serializeViz`. */
export function vizDocument(machines: ReadonlyArray<VizMachine>): VizDocument {
  return { schemaVersion: VIZ_SCHEMA_VERSION, machines: [...machines] };
}
