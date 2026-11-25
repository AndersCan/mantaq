import type { AnalysisSource } from "./ast/program.ts";
import type { ProgramStore } from "./ast/programs/program-store.ts";
import type { Machine } from "@mantaq/core";
import type { AnyExpectations, CheckedExpectation } from "./expectations.ts";
import type { FuzzOptions, FuzzStop, LostMessage } from "./fuzz/fuzz.ts";
import type { FuzzTarget, MissingPayload } from "./fuzz/run.ts";
import type { ModuleAnalysis } from "./ast/annotate.ts";
import type { RecordedRuns } from "./runs.ts";
import type { VizDocument, VizJson, VizMachine, VizRun } from "@mantaq/viz";
import { DEFAULT_SEED } from "@mantaq/pbt";
import { Either } from "@mantaq/utils";
import { VirtualClock } from "@mantaq/core";
import { analyzeModule, annotateWith } from "./ast/annotate.ts";
import { checkExpectations } from "./expectations.ts";
import { contextText } from "./fuzz/run.ts";
import { coverageGoal, unreached, withTestCoverage } from "./fuzz/coverage.ts";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fuzz } from "./fuzz/fuzz.ts";
import { fuzzedMachine } from "./fuzz/to-viz.ts";
import { guidance } from "./fuzz/guided.ts";
import { normalizeRun, readRuns, RUN_DROPPED } from "./runs.ts";
import { routingWarnings, unhandledSends, VIZ_SCHEMA_VERSION } from "@mantaq/viz";
import { mapWarnings, structureOf } from "./structure.ts";
import type { BuiltEmbedding, Embedding } from "./embeds/embedded-machines.ts";
import { createdOf, freshActor } from "./embeds/fresh-actor.ts";
import type { Created } from "./embeds/fresh-actor.ts";
import { isMachine } from "./embeds/is-machine.ts";
import type { StateEmbed } from "./embeds/state-embeds.ts";
import { withEmbedded } from "./embeds/embedded-machines.ts";

const DEFAULT_ITERATIONS = 2000;

export interface FuzzSettings {
  seed?: number;
  /** Most runs to try; fuzzing stops sooner once every state, edge and must-see is covered. Default 2000; no cap when `timeLimitMs` is set alone. */
  iterations?: number;
  /**
   * Wall-time budget for one machine. The runs stay seeded (same seed, same
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

/** Fuzz options for the settings: an iteration cap and/or a time budget, both ending on full coverage. */
function budget(
  settings: FuzzSettings | undefined,
  context: { structure: VizMachine; runner: FuzzTarget },
): Pick<FuzzOptions, "iterations" | "done" | "deadline"> {
  const limit = settings?.timeLimitMs;
  const must = (context.runner.expectations ?? [])
    .filter((each) => each.kind === "mustSee")
    .map((each) => each.feature);
  const done = coverageGoal(context.structure, must);
  if (limit === undefined) return { iterations: settings?.iterations ?? DEFAULT_ITERATIONS, done };
  return {
    iterations: settings?.iterations ?? Number.POSITIVE_INFINITY,
    done,
    deadline: { ms: limit, now: wallClock },
  };
}

/** What fuzzing missed and how to get further, or nothing when it reached everything. */
function fuzzWarnings(
  machine: VizMachine,
  run: { stopped: FuzzStop; missing: ReadonlyArray<MissingPayload> },
): string[] {
  const inPart = (id: string) => machine.actors.some((actor) => id.startsWith(`${actor}.`));
  const missed = unreached(machine).filter((name) => !inPart(name));
  const partEvents = new Set(
    machine.events.filter((each) => inPart(each.id)).map((each) => each.id),
  );
  const iterations = machine.fuzz?.iterations ?? 0;
  const never =
    missed.length === 0
      ? []
      : [
          `fuzz never reached: ${missed.join(", ")} (ran ${iterations} iterations, stopped: ${STOPPED[run.stopped]}). Raise fuzz.timeLimitMs / iterations or add a named run to \`tests\`.`,
        ];
  const unsampled = run.missing
    .filter(({ event }) => !partEvents.has(event))
    .map(
      ({ event, fields }) =>
        `fuzz sent ${event} without a payload and the machine read ${fields.join(", ")}. Pass \`source\` (samples from the event types) or \`payloads\` with a sample for ${event}.`,
    );
  return [...never, ...unsampled];
}

interface TargetOptions {
  /** File with the `m.on` calls: edge explanations, and payload samples from the event types. */
  source?: AnalysisSource;
  /** Sample payloads per event; replace the ones read from types. */
  payloads?: Readonly<Record<string, ReadonlyArray<VizJson>>>;
  /** Named runs your tests take: fuzz seeds, and `?run=` links on the live page. */
  tests?: ReadonlyArray<VizRun>;
  /** `false` = structure only. */
  fuzz?: false | FuzzSettings;
  /** Contexts that are a bug in a state (`neverSee`) or that some run must reach (`mustSee`). */
  expectations?: AnyExpectations;
}

/** A `machine(id, { create })` value, which inspect builds on its own VirtualClock. */
export type InspectTarget = TargetOptions & { machine: Machine };

export interface Inspected {
  machine: VizMachine;
  /** The machines its states embed, and the ones those embed, each inspected as if a file exported it. Put them in the same document. */
  embedded: VizMachine[];
  /** Things worth fixing or knowing: unreachable routing, unhandled sends, why fuzzing was skipped. */
  warnings: string[];
  /** Events fuzzing sent without a payload whose fields the machine read; empty when fuzzing is off. */
  missingPayloads: MissingPayload[];
  /** Messages one machine sent another that handles them in no state; empty when fuzzing is off. */
  lostMessages: LostMessage[];
}

/** The run that sends a lost message, named with the design check's own words. */
export function lostRunName(lost: Pick<LostMessage, "sender" | "event" | "receiver">): string {
  return `${lost.sender} sends ${lost.event} to ${lost.receiver}`;
}

/**
 * What a design check throws when fuzzing sent events without a payload that the
 * machine then read, or "" when there is none. Callers add their own text after a blank line.
 */
export function missingPayloadBlock(id: string, missing: ReadonlyArray<MissingPayload>): string {
  if (missing.length === 0) return "";
  const count = `${missing.length} event${missing.length === 1 ? "" : "s"}`;
  const lines = missing.map((each) => `  - ${each.event}: read ${each.fields.join(", ")}`);
  const keys = missing.map((each) => `${each.event}: [...]`).join(", ");
  return `${id}: fuzzing had no payload for ${count} the machine reads, so this check proves nothing yet:\n${lines.join("\n")}\nPass \`source\` (payloads from the event types) or \`payloads: { ${keys} }\` with a real payload for each case.`;
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

/** A fresh actor from the target, built on a VirtualClock of its own. */
function createdFrom(target: InspectTarget): Created {
  return createdOf(target.machine.create({ clock: VirtualClock() }));
}

const NOT_ON_GIVEN_CLOCK =
  "not fuzzed: create() built an actor on a clock it was not given, so fuzzing and the page cannot move its time. Pass the clock create() gets to Actor({ clock }).";

/** The machine as the fuzzer drives it: inspect's own clock goes in, and it is never read back from the actor. */
function machineRunner(machine: Machine): Either<string, FuzzTarget["create"]> {
  const create: FuzzTarget["create"] = () => {
    const clock = VirtualClock();
    const { actor, made } = createdOf(machine.create({ clock }));
    return { actor, clock, ...(made === undefined ? {} : { made }) };
  };
  const { actor, clock } = create();
  // An actor on the real clock sets no timer inspect must move; only a second virtual clock is out of reach.
  const elsewhere =
    actor.clock !== undefined &&
    typeof Reflect.get(actor.clock, "advance") === "function" &&
    actor.clock !== clock;
  return elsewhere ? Either.left(NOT_ON_GIVEN_CLOCK) : Either.right(create);
}

/** The target as the fuzzer drives it, or why it cannot run on a virtual clock. */
function runner(
  target: InspectTarget,
  payloads: Readonly<Record<string, ReadonlyArray<VizJson>>>,
  expectations: ReadonlyArray<CheckedExpectation>,
): Either<string, FuzzTarget> {
  const create = machineRunner(target.machine);
  if (Either.isLeft(create)) return create;
  return Either.right({
    id: target.machine.id,
    create: create[1],
    payloads,
    ...(expectations.length === 0 ? {} : { expectations }),
  });
}

/** What `inspectWith` reads besides the target: the analysis of its file and the payload samples from its types. */
interface InspectWithOptions {
  analysis?: Either<string, ModuleAnalysis>;
  fromTypes?: Readonly<Record<string, ReadonlyArray<VizJson>>>;
}

function annotator(
  target: InspectTarget,
  options: InspectWithOptions,
): (machine: VizMachine) => VizMachine {
  const { source } = target;
  const { analysis } = options;
  if (analysis === undefined || source === undefined) return (machine) => machine;
  return (machine) => annotateWith(machine, { analysis, source });
}

/** Fuzz and test coverage on top of the structure, as far as the target allows. */
function driven(
  target: InspectTarget,
  context: { structure: VizMachine; run: Either<string, FuzzTarget> },
): { machine: VizMachine; notes: string[]; missing: MissingPayload[]; lost: LostMessage[] } {
  const { structure, run } = context;
  if (Either.isLeft(run)) return { machine: structure, notes: [run[0]], missing: [], lost: [] };
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
  return {
    machine,
    notes: fuzzed?.warnings ?? [],
    missing: fuzzed?.missing ?? [],
    lost: fuzzed?.lost ?? [],
  };
}

/** Why written expectations are not checked, if they are not. */
function uncheckedExpectations(
  target: InspectTarget,
  context: {
    expected: { checked: ReadonlyArray<CheckedExpectation> };
    run: Either<string, FuzzTarget>;
  },
): string[] {
  if (context.expected.checked.length === 0) return [];
  if (target.fuzz === false) return ["expectations not checked: fuzzing is off"];
  if (Either.isLeft(context.run)) return [`expectations not checked: ${context.run[0]}`];
  const fresh = context.run[1].create().actor;
  return contextText(fresh) === null ? ["expectations not checked: the context is not JSON"] : [];
}

function fuzzRun(
  runner: FuzzTarget,
  context: { target: InspectTarget; settings: FuzzSettings | undefined; structure: VizMachine },
): { machine: VizMachine; warnings: string[]; missing: MissingPayload[]; lost: LostMessage[] } {
  const { target, settings, structure } = context;
  const result = fuzz(runner, {
    seed: settings?.seed ?? DEFAULT_SEED,
    ...budget(settings, { structure, runner }),
    ...(target.tests === undefined ? {} : { initial: target.tests.map((each) => each.steps) }),
    ...guidance(structure),
  });
  const machine = fuzzedMachine(runner, result);
  const { missingPayloads: missing } = result;
  return {
    machine,
    warnings: fuzzWarnings(machine, { stopped: result.stopped, missing }),
    missing,
    lost: result.lostMessages,
  };
}

/** One machine inspected on its own, with the embeds of its states for the walk to follow. */
interface OwnInspection extends Omit<Inspected, "embedded"> {
  embeds: ReadonlyArray<StateEmbed>;
}

function inspectWith(target: InspectTarget, options: InspectWithOptions = {}): OwnInspection {
  const { analysis } = options;
  const annotate = annotator(target, options);
  const inferred = {
    ...options.fromTypes,
    ...Either.getRight(analysis ?? Either.left("none"))?.payloads,
  };
  const created = createdFrom(target);
  const own = structureOf({ id: target.machine.id, ...created });
  const structure = annotate(own.machine);
  const expected = checkExpectations(
    target.expectations?.states,
    structure.states.filter((each) => each.region === null).map((each) => each.id),
  );
  const run = runner(target, { ...inferred, ...target.payloads }, expected.checked);
  const { machine, notes, missing, lost } = driven(target, { structure, run });
  const unchecked = uncheckedExpectations(target, { expected, run });
  const quiet = target.fuzz === false && target.tests === undefined;
  const unanalyzed =
    analysis === undefined ? [] : [Either.getLeft(analysis)].filter((each) => each !== undefined);
  const lostRuns = lost.map((each) => ({ name: lostRunName(each), steps: each.steps }));
  const annotated = annotate({ ...machine, runs: [...(target.tests ?? []), ...lostRuns] });
  return {
    machine: annotated,
    embeds: own.embeds,
    missingPayloads: missing,
    lostMessages: lost,
    warnings: [
      ...unanalyzed,
      ...mapWarnings(created.made),
      ...expected.warnings,
      ...unchecked,
      ...(quiet ? [] : notes),
      ...warningsOf(annotated),
    ],
  };
}

/**
 * One machine in, one viz machine out: structure, edge explanations and
 * payloads from the source's types, fuzz coverage, test coverage. Each part
 * that cannot run is skipped with a warning, never guessed.
 */
export function inspect(target: InspectTarget): Inspected {
  const { embeds, ...inspected } = inspectWith(
    target,
    target.source === undefined ? {} : { analysis: analyzeModule(target.source) },
  );
  const drawn = withEmbedded([{ machine: inspected.machine, embeds }], {
    build: (machine) => inspectEmbedded(machine, { fuzz: target.fuzz }),
  });
  return {
    ...inspected,
    machine: drawn.roots[0] ?? inspected.machine,
    embedded: drawn.embedded,
    warnings: [...inspected.warnings, ...drawn.warnings],
  };
}

interface EmbeddedSettings {
  fuzz: InspectTarget["fuzz"];
}

/** A machine an embed reached, inspected as if a file exported it, but without a source file to read. */
function inspectEmbedded(
  machine: Machine,
  options: EmbeddedSettings,
): Either<string, BuiltEmbedding> {
  const created = freshActor(machine);
  if (Either.isLeft(created)) return created;
  const target: InspectTarget = { machine };
  if (options.fuzz !== undefined) target.fuzz = options.fuzz;
  return Either.right(inspectWith(target));
}

/** The export that holds the expectations for machine `id`: any name, `machine` names the id, `states` is an object. */
function expectationsFor(
  exports: Readonly<Record<string, unknown>>,
  id: string,
): AnyExpectations | undefined {
  return Object.values(exports).find((value): value is AnyExpectations => {
    if (typeof value !== "object" || value === null) return false;
    const states: unknown = Reflect.get(value, "states");
    return Reflect.get(value, "machine") === id && typeof states === "object" && states !== null;
  });
}

/** Directory of the nearest package.json above `file`: locations are reported relative to it. */
export function projectRoot(file: string): string {
  let dir = dirname(file);
  while (!existsSync(join(dir, "package.json")) && dirname(dir) !== dir) dir = dirname(dir);
  return dir;
}

/** The recorded runs of one machine that replay faithfully, and a warning for each that does not. */
function replayedRuns(
  target: InspectTarget,
  recorded: RecordedRuns,
): { runs: VizRun[]; warnings: string[] } {
  const found = recorded[target.machine.id] ?? [];
  if (found.length === 0) return { runs: [], warnings: [] };
  const run = runner(target, {}, []);
  if (Either.isLeft(run)) return { runs: [], warnings: [`runs not shown: ${run[0]}`] };
  const results = found.map((each) => ({ each, result: normalizeRun(run[1], each) }));
  return {
    runs: results.flatMap(({ each, result }) =>
      Either.isRight(result) ? [{ name: each.name, steps: result[1] }] : [],
    ),
    warnings: results.flatMap(({ each, result }) =>
      Either.isLeft(result) ? [`run "${each.name}"${RUN_DROPPED}${result[0]}`] : [],
    ),
  };
}

export interface ModuleOptions {
  /** Import the file and return its exports (e.g. Vite's `runnerImport`, `ssrLoadModule`). */
  load: (file: string) => Promise<Record<string, unknown>>;
  /** Locations are relative to this. Default: nearest package.json above the file. */
  root?: string;
  /** @deprecated No mantaq caller sets this; removed in a later release. */
  tsconfig?: string;
  fuzz?: false | FuzzSettings;
  /** Programs shared by one build or dev server, so each file is type-checked once. */
  programs?: ProgramStore;
}

export interface InspectedModule {
  machines: VizMachine[];
  /** The machines the file's machines embed that it does not export, each inspected as if exported. A document of this file holds them too. */
  embedded: VizMachine[];
  /** Prefixed with the machine id, or the file when it is about the file. */
  warnings: string[];
}

/** Every `machine(id, { create })` a file exports, found from its types. Nothing else is read as a machine. */
export async function inspectModule(
  file: string,
  options: ModuleOptions,
): Promise<InspectedModule> {
  const source: AnalysisSource = {
    file,
    root: options.root ?? projectRoot(file),
    ...(options.tsconfig === undefined ? {} : { tsconfig: options.tsconfig }),
  };
  const analysis = analyzeModule(source, { programs: options.programs });
  if (Either.isLeft(analysis)) {
    return { machines: [], embedded: [], warnings: [`${file}: ${analysis[0]}`] };
  }
  const found = analysis[1].machines;
  if (found.length === 0) {
    return { machines: [], embedded: [], warnings: [`${file}: no exported machine(...) found`] };
  }
  const exports = await options.load(file);
  const { runs: recorded, warnings: runWarnings } = readRuns(dirname(file));
  const results = found.map((each) => {
    const id = each.id;
    const value = exports[each.name];
    if (!isMachine(value)) {
      return { machine: undefined, warnings: [`${id}: ${each.name} is not a machine(...) value`] };
    }
    const base: InspectTarget = { machine: value };
    const replayed = replayedRuns(base, recorded);
    const claimed = expectationsFor(exports, id);
    const inspected = inspectWith(
      {
        ...base,
        source,
        fuzz: options.fuzz ?? {},
        ...(claimed === undefined ? {} : { expectations: claimed }),
        ...(replayed.runs.length === 0 ? {} : { tests: replayed.runs }),
      },
      { analysis, fromTypes: each.samples },
    );
    const withContext: VizMachine = {
      ...inspected.machine,
      context: each.context,
      events: inspected.machine.events.map((event) => {
        const fields = each.fields[event.id];
        return event.payload === null && fields !== undefined
          ? { ...event, payload: fields }
          : event;
      }),
    };
    return {
      machine: withContext,
      embeds: inspected.embeds,
      warnings: [...replayed.warnings, ...inspected.warnings].map((warning) => `${id}: ${warning}`),
    };
  });
  const roots: Embedding[] = [];
  for (const result of results) {
    if (result.machine !== undefined) roots.push(result);
  }
  const settings: EmbeddedSettings = { fuzz: options.fuzz ?? {} };
  const drawn = withEmbedded(roots, { build: (machine) => inspectEmbedded(machine, settings) });
  return {
    machines: drawn.roots,
    embedded: drawn.embedded,
    warnings: [
      ...runWarnings.map((warning) => `${file}: ${warning}`),
      ...results.flatMap((result) => result.warnings),
      ...drawn.warnings,
    ],
  };
}

/** Machines as a document, ready for `serializeViz`. */
export function vizDocument(machines: ReadonlyArray<VizMachine>): VizDocument {
  return { schemaVersion: VIZ_SCHEMA_VERSION, machines: [...machines] };
}
