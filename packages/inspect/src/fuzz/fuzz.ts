import type { VizExpectation, VizFailedExpectation, VizFuzzError, VizStep } from "@mantaq/viz";
import { mutate } from "./mutate.ts";
import type { LiteralPool, MutationContext, Parent } from "./mutate.ts";
import { createRng } from "./rng.ts";
import { childEvents, eventCatalog, execute, mergeMissing, regionActors } from "./run.ts";
import type { FuzzTarget, MissingPayload, Trace } from "./run.ts";

export interface FuzzOptions {
  seed: number;
  iterations: number;
  /** Longest sequence the mutator will grow. Default 24. */
  maxLength?: number;
  literals?: LiteralPool;
  /** Loop context-changing steps (default true). False reproduces plain Phase 3 mutation. */
  repeat?: boolean;
  /**
   * Optional search guidance (Phase 5). Sees every run; returning true keeps
   * the run in the corpus as a stepping stone even without new coverage.
   */
  guide?: (trace: Trace) => boolean;
  /** Known-good sequences (e.g. example tests) the corpus starts from, before any mutation. */
  initial?: ReadonlyArray<ReadonlyArray<VizStep>>;
  /** Stop early once this returns true. Sees every run, like `guide` (e.g. `coverageGoal`). */
  done?: (trace: Trace) => boolean;
  /**
   * Wall-time budget. `now` is injected so the loop reads no clock itself:
   * the run sequence stays seeded, only where it stops depends on time.
   */
  deadline?: { ms: number; now: () => number };
}

/** Why fuzzing stopped: `done` returned true, the iteration cap, or the deadline. */
export type FuzzStop = "covered" | "iterations" | "time";

export interface CorpusEntry {
  steps: VizStep[];
  /** Features first reached by this entry. Empty for guide-only keeps. */
  discovered: string[];
  iteration: number;
}

export interface FuzzResult {
  seed: number;
  /** Iterations that ran: at most `options.iterations`. */
  iterations: number;
  stopped: FuzzStop;
  corpus: CorpusEntry[];
  /** Feature -> iteration that first reached it. */
  firstHit: Map<string, number>;
  errors: VizFuzzError[];
  /** In `FuzzTarget.expectations` order; empty when none were written or all held. */
  failedExpectations: VizFailedExpectation[];
  /** Every rule written, held or not, in `FuzzTarget.expectations` order. */
  expectations: VizExpectation[];
  /** Events sent without a payload whose fields the machine read, over every run. Sorted. */
  missingPayloads: MissingPayload[];
}

function covers(target: FuzzTarget, steps: ReadonlyArray<VizStep>, wanted: ReadonlyArray<string>) {
  const reached = new Set(execute(target, steps).features);
  return wanted.every((feature) => reached.has(feature));
}

/**
 * Greedy one-step deletion, last to first, while `wanted` stays covered;
 * passes repeat until one removes nothing, so the result is 1-minimal (one
 * pass is not: a removal can make an earlier-kept step removable). Deterministic.
 */
export function shrink(
  target: FuzzTarget,
  steps: ReadonlyArray<VizStep>,
  wanted: ReadonlyArray<string>,
): VizStep[] {
  let current = [...steps];
  let removed = true;
  while (removed) {
    removed = false;
    for (let at = current.length - 1; at >= 0; at -= 1) {
      const candidate = current.filter((_, index) => index !== at);
      if (covers(target, candidate, wanted)) {
        current = candidate;
        removed = true;
      }
    }
  }
  return current;
}

function mutationContext(target: FuzzTarget, options: FuzzOptions): MutationContext {
  const created = target.create();
  const root = created.actor;
  const catalog = eventCatalog(root);
  const regionEvents = regionActors(root).flatMap(({ path, actor }) => {
    const each = eventCatalog(actor);
    return [...each.inputs, ...each.internal]
      .sort()
      .map((event) => ({ event, actor: { region: path } }));
  });
  return {
    rng: createRng(options.seed),
    events: [
      ...[...catalog.inputs, ...catalog.internal].sort().map((event) => ({ event })),
      ...regionEvents,
    ],
    childEvents: childEvents(created.made),
    payloads: target.payloads ?? {},
    literals: options.literals ?? { numbers: [], strings: [] },
    maxLength: options.maxLength ?? 24,
    repeat: options.repeat ?? true,
  };
}

function collectErrors(target: FuzzTarget, corpus: ReadonlyArray<CorpusEntry>): VizFuzzError[] {
  const errors = new Map<string, VizFuzzError>();
  for (const entry of corpus) {
    for (const error of execute(target, entry.steps).errors) {
      const key = `${error.from}>${error.event}`;
      if (errors.has(key)) continue;
      const steps = shrink(target, entry.steps.slice(0, error.step + 1), [`error:${key}`]);
      errors.set(key, { from: error.from, event: error.event, message: error.message, steps });
    }
  }
  return [...errors.values()].sort((left, right) =>
    `${left.from}>${left.event}` < `${right.from}>${right.event}` ? -1 : 1,
  );
}

function checkExpectations(
  target: FuzzTarget,
  context: { kept: ReadonlyArray<CorpusEntry>; firstHit: ReadonlyMap<string, number> },
): { rule: VizExpectation; failed: VizFailedExpectation | null }[] {
  return (target.expectations ?? []).map((each) => {
    const { kind, state } = each;
    const match = each.text;
    if (kind === "mustSee") {
      const held = context.firstHit.has(each.feature);
      return {
        rule: { kind, state, match, held },
        failed: held ? null : { kind, state, match, steps: null },
      };
    }
    const entry = context.kept.find((candidate) => candidate.discovered.includes(each.feature));
    return {
      rule: { kind, state, match, held: entry === undefined },
      failed:
        entry === undefined
          ? null
          : { kind, state, match, steps: shrink(target, entry.steps, [each.feature]) },
    };
  });
}

/** Why to stop before running `iteration`, or null to run it. */
function stopper(options: FuzzOptions): (iteration: number, covered: boolean) => FuzzStop | null {
  const { deadline } = options;
  const started = deadline?.now() ?? 0;
  return (iteration, covered) => {
    if (covered) return "covered";
    if (iteration > options.iterations) return "iterations";
    if (deadline !== undefined && deadline.now() - started >= deadline.ms) return "time";
    return null;
  };
}

/**
 * Coverage-guided fuzzing. Each iteration mutates a corpus entry, runs it on a
 * fresh actor and keeps it if it reaches a feature (state, edge, stay, error)
 * no earlier run reached. Same target + options => identical result; with a
 * `deadline`, the same runs in the same order, cut off where time ran out.
 */
export function fuzz(target: FuzzTarget, options: FuzzOptions): FuzzResult {
  const context = mutationContext(target, options);
  const seen = new Set<string>();
  const firstHit = new Map<string, number>();
  const corpus: CorpusEntry[] = [];
  /** Parallel to `corpus`: which steps of each entry changed context, and their cycles. */
  const loops: Array<Pick<Parent, "contextSteps" | "loopStarts" | "children">> = [];

  const missing: MissingPayload[] = [];
  const progress = { covered: false };
  function consider(steps: VizStep[], iteration: number): void {
    const trace = execute(target, steps);
    missing.push(...trace.missingPayloads);
    if (options.done?.(trace) === true) progress.covered = true;
    const discovered = trace.features.filter((feature) => !seen.has(feature));
    const guided = options.guide ? options.guide(trace) : false;
    for (const feature of discovered) {
      seen.add(feature);
      firstHit.set(feature, iteration);
    }
    if (discovered.length > 0 || guided) {
      corpus.push({ steps, discovered, iteration });
      loops.push({
        contextSteps: trace.contextSteps,
        loopStarts: trace.loopStarts,
        children: trace.children,
      });
    }
  }

  consider([], 0);
  for (const steps of options.initial ?? []) consider([...steps], 0);
  const stopAt = stopper(options);
  let iteration = 1;
  let stopped = stopAt(iteration, progress.covered);
  while (stopped === null) {
    const at = context.rng.int(corpus.length);
    const parent = {
      steps: corpus[at]?.steps ?? [],
      contextSteps: loops[at]?.contextSteps ?? [],
      loopStarts: loops[at]?.loopStarts ?? [],
      children: loops[at]?.children ?? [],
    };
    consider(mutate(parent, context), iteration);
    iteration += 1;
    stopped = stopAt(iteration, progress.covered);
  }

  const kept = corpus
    .filter((entry) => entry.discovered.length > 0)
    .map((entry) => ({ ...entry, steps: shrink(target, entry.steps, entry.discovered) }));
  const checked = checkExpectations(target, { kept, firstHit });
  return {
    seed: options.seed,
    iterations: iteration - 1,
    stopped,
    corpus: kept,
    firstHit,
    errors: collectErrors(target, kept),
    failedExpectations: checked.flatMap((each) => (each.failed === null ? [] : [each.failed])),
    expectations: checked.map((each) => each.rule),
    missingPayloads: mergeMissing(missing),
  };
}
