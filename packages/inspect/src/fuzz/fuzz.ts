import type { VizFuzzError, VizStep } from "@mantaq/viz";
import { mutate } from "./mutate.ts";
import type { LiteralPool, MutationContext, Parent } from "./mutate.ts";
import { createRng } from "./rng.ts";
import { eventCatalog, execute } from "./run.ts";
import type { FuzzTarget, Trace } from "./run.ts";

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
}

export interface CorpusEntry {
  steps: VizStep[];
  /** Features first reached by this entry. Empty for guide-only keeps. */
  discovered: string[];
  iteration: number;
}

export interface FuzzResult {
  seed: number;
  iterations: number;
  corpus: CorpusEntry[];
  /** Feature -> iteration that first reached it. */
  firstHit: Map<string, number>;
  errors: VizFuzzError[];
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
  const catalog = eventCatalog(target.create().actor);
  return {
    rng: createRng(options.seed),
    events: [...catalog.inputs, ...catalog.internal].sort(),
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

/**
 * Coverage-guided fuzzing. Each iteration mutates a corpus entry, runs it on a
 * fresh actor and keeps it if it reaches a feature (state, edge, stay, error)
 * no earlier run reached. Same target + options => identical result.
 */
export function fuzz(target: FuzzTarget, options: FuzzOptions): FuzzResult {
  const context = mutationContext(target, options);
  const seen = new Set<string>();
  const firstHit = new Map<string, number>();
  const corpus: CorpusEntry[] = [];
  /** Parallel to `corpus`: which steps of each entry changed context, and their cycles. */
  const loops: Array<Pick<Parent, "contextSteps" | "loopStarts">> = [];

  function consider(steps: VizStep[], iteration: number): void {
    const trace = execute(target, steps);
    const discovered = trace.features.filter((feature) => !seen.has(feature));
    const guided = options.guide ? options.guide(trace) : false;
    for (const feature of discovered) {
      seen.add(feature);
      firstHit.set(feature, iteration);
    }
    if (discovered.length > 0 || guided) {
      corpus.push({ steps, discovered, iteration });
      loops.push({ contextSteps: trace.contextSteps, loopStarts: trace.loopStarts });
    }
  }

  consider([], 0);
  for (const steps of options.initial ?? []) consider([...steps], 0);
  for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
    const at = context.rng.int(corpus.length);
    const parent = {
      steps: corpus[at]?.steps ?? [],
      contextSteps: loops[at]?.contextSteps ?? [],
      loopStarts: loops[at]?.loopStarts ?? [],
    };
    consider(mutate(parent, context), iteration);
  }

  const kept = corpus
    .filter((entry) => entry.discovered.length > 0)
    .map((entry) => ({ ...entry, steps: shrink(target, entry.steps, entry.discovered) }));
  return {
    seed: options.seed,
    iterations: options.iterations,
    corpus: kept,
    firstHit,
    errors: collectErrors(target, kept),
  };
}
