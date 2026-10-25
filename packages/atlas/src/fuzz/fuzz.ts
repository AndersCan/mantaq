import type { AtlasFuzzError, AtlasStep } from "../schema.ts";
import { mutate } from "./mutate.ts";
import type { LiteralPool, MutationContext } from "./mutate.ts";
import { createRng } from "./rng.ts";
import { eventCatalog, execute } from "./run.ts";
import type { FuzzTarget, Trace } from "./run.ts";

export interface FuzzOptions {
  seed: number;
  iterations: number;
  /** Longest sequence the mutator will grow. Default 24. */
  maxLength?: number;
  literals?: LiteralPool;
  /**
   * Optional search guidance (Phase 5). Lower is better; a child that lowers
   * the best score so far is kept even without new coverage.
   */
  fitness?: (trace: Trace) => number;
}

export interface CorpusEntry {
  steps: AtlasStep[];
  /** Features first reached by this entry. Empty for fitness-only keeps. */
  discovered: string[];
  iteration: number;
}

export interface FuzzResult {
  seed: number;
  iterations: number;
  corpus: CorpusEntry[];
  /** Feature -> iteration that first reached it. */
  firstHit: Map<string, number>;
  errors: AtlasFuzzError[];
}

function covers(
  target: FuzzTarget,
  steps: ReadonlyArray<AtlasStep>,
  wanted: ReadonlyArray<string>,
) {
  const reached = new Set(execute(target, steps).features);
  return wanted.every((feature) => reached.has(feature));
}

/** Greedy one-step deletion, last to first, while `wanted` stays covered. Deterministic. */
export function shrink(
  target: FuzzTarget,
  steps: ReadonlyArray<AtlasStep>,
  wanted: ReadonlyArray<string>,
): AtlasStep[] {
  let current = [...steps];
  for (let at = current.length - 1; at >= 0; at -= 1) {
    const candidate = current.filter((_, index) => index !== at);
    if (covers(target, candidate, wanted)) current = candidate;
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
  };
}

function collectErrors(target: FuzzTarget, corpus: ReadonlyArray<CorpusEntry>): AtlasFuzzError[] {
  const errors = new Map<string, AtlasFuzzError>();
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
  let best = Number.POSITIVE_INFINITY;

  function consider(steps: AtlasStep[], iteration: number): void {
    const trace = execute(target, steps);
    const discovered = trace.features.filter((feature) => !seen.has(feature));
    const score = options.fitness ? options.fitness(trace) : Number.POSITIVE_INFINITY;
    for (const feature of discovered) {
      seen.add(feature);
      firstHit.set(feature, iteration);
    }
    if (discovered.length > 0 || score < best) corpus.push({ steps, discovered, iteration });
    best = Math.min(best, score);
  }

  consider([], 0);
  for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
    const parent = context.rng.pick(corpus)?.steps ?? [];
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
