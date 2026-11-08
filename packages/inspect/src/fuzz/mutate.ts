import type { VizActorRef, VizJson, VizStep } from "@mantaq/viz";
import type { Rng } from "./rng.ts";

/** Extra values to try at payload leaves (Phase 5 literal seeding). Empty = blind mutation. */
export interface LiteralPool {
  numbers: number[];
  strings: string[];
}

export interface MutationContext {
  rng: Rng;
  /** Every event the machine declares, root events first, then each region's; `actor` is omitted for the root. */
  events: ReadonlyArray<{ event: string; actor?: VizActorRef }>;
  payloads: Readonly<Record<string, ReadonlyArray<VizJson>>>;
  literals: LiteralPool;
  maxLength: number;
  /** Allow the repeat (loop) operator. On by default; off only for comparisons. */
  repeat: boolean;
}

/** A corpus entry as the mutator sees it: steps plus which of them changed context. */
export interface Parent {
  steps: ReadonlyArray<VizStep>;
  contextSteps: ReadonlyArray<number>;
  /** Parallel to `contextSteps`: where the cycle ending at that step starts. */
  loopStarts: ReadonlyArray<number>;
}

const REPEAT_COUNTS = [2, 3, 5, 8, 13];
const MAX_REPEAT = 64;

const ADVANCES = [1, 10, 100, 500, 1000, 5000];

function isObject(value: VizJson): value is { [key: string]: VizJson } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function freshEvent(context: MutationContext): VizStep {
  const picked = context.rng.pick(context.events);
  const event = picked?.event ?? "";
  const samples = context.payloads[event] ?? [];
  const payload = context.rng.pick(samples) ?? null;
  return picked?.actor === undefined
    ? { kind: "event", event, payload }
    : { kind: "event", event, payload, actor: picked.actor };
}

function freshStep(context: MutationContext): VizStep {
  if (context.rng.chance(0.1)) return { kind: "advance", ms: context.rng.pick(ADVANCES) ?? 1 };
  return freshEvent(context);
}

function mutateNumber(value: number, context: MutationContext): number {
  const { rng, literals } = context;
  if (literals.numbers.length > 0 && rng.chance(0.5)) return rng.pick(literals.numbers) ?? value;
  const options = [
    0,
    -1,
    1,
    value + 1,
    value - 1,
    value * 2,
    Math.trunc(value / 2),
    rng.int(2001) - 1000,
  ];
  return options[rng.int(options.length)] ?? value;
}

function mutateString(value: string, context: MutationContext): string {
  const { rng, literals } = context;
  if (literals.strings.length > 0 && rng.chance(0.5)) return rng.pick(literals.strings) ?? value;
  const options = ["", "x", `${value}x`, value.slice(1), value.toUpperCase()];
  return options[rng.int(options.length)] ?? value;
}

/**
 * Replace one leaf somewhere inside a JSON value, keeping its JSON type. Keys
 * are never dropped: payloads stay shaped like the samples, so a handler that
 * throws is a real finding, not a type violation the compiler already rejects.
 */
function mutateJson(value: VizJson, context: MutationContext): VizJson {
  if (typeof value === "number") return mutateNumber(value, context);
  if (typeof value === "string") return mutateString(value, context);
  if (typeof value === "boolean") return !value;
  if (Array.isArray(value)) {
    if (value.length === 0) return value;
    const at = context.rng.int(value.length);
    return value.map((item, index) => (index === at ? mutateJson(item, context) : item));
  }
  if (!isObject(value)) return value;
  const keys = Object.keys(value).sort();
  const key = context.rng.pick(keys);
  if (key === undefined) return value;
  return { ...value, [key]: mutateJson(value[key] ?? null, context) };
}

function replaceAt(steps: VizStep[], at: number, step: VizStep): VizStep[] {
  return steps.map((current, index) => (index === at ? step : current));
}

function mutatePayload(steps: VizStep[], context: MutationContext): VizStep[] {
  const withPayload = steps.flatMap((step, index) =>
    step.kind === "event" && step.payload !== null ? [index] : [],
  );
  const at = context.rng.pick(withPayload);
  const step = at === undefined ? undefined : steps[at];
  if (at === undefined || step?.kind !== "event") return steps;
  return replaceAt(steps, at, { ...step, payload: mutateJson(step.payload, context) });
}

function insert(steps: VizStep[], context: MutationContext): VizStep[] {
  if (steps.length >= context.maxLength) return steps;
  // Appending is favoured: most new behaviour lives past the current frontier.
  const at = context.rng.chance(0.6) ? steps.length : context.rng.int(steps.length + 1);
  return [...steps.slice(0, at), freshStep(context), ...steps.slice(at)];
}

function remove(steps: VizStep[], context: MutationContext): VizStep[] {
  if (steps.length === 0) return steps;
  const at = context.rng.int(steps.length);
  return steps.filter((_, index) => index !== at);
}

function swap(steps: VizStep[], context: MutationContext): VizStep[] {
  if (steps.length < 2) return steps;
  const at = context.rng.int(steps.length - 1);
  const left = steps[at];
  const right = steps[at + 1];
  if (left === undefined || right === undefined) return steps;
  return replaceAt(replaceAt(steps, at, right), at + 1, left);
}

function advance(steps: VizStep[], context: MutationContext): VizStep[] {
  if (steps.length >= context.maxLength) return steps;
  const at = context.rng.int(steps.length + 1);
  const ms = context.rng.pick(ADVANCES) ?? 1;
  return [...steps.slice(0, at), { kind: "advance", ms }, ...steps.slice(at)];
}

const OPERATORS = [insert, insert, insert, remove, swap, mutatePayload, mutatePayload, advance];

/** Loop lengths to try: small counts plus any integer literal a handler compares against. */
function repeatCounts(context: MutationContext): number[] {
  const fromLiterals = context.literals.numbers.filter(
    (value) => Number.isInteger(value) && value >= 2 && value <= MAX_REPEAT,
  );
  return [...REPEAT_COUNTS, ...fromLiterals];
}

/**
 * Loop a step that changed the actor's context (a counter, an accumulating
 * list): `if (retries > 10)` needs the same event many times, and repeating
 * a step that changes nothing would only add noise. The loop body is the
 * whole cycle ending at that step, back to the state it returns to: a
 * counter bumped by `submit, rejected` needs the pair again, not `rejected`
 * alone. Inserts `count` copies of the body after it.
 */
function repeat(parent: Parent, context: MutationContext): VizStep[] {
  const at = context.rng.pick(parent.contextSteps);
  if (at === undefined || parent.steps[at] === undefined) return [...parent.steps];
  const start = parent.loopStarts[parent.contextSteps.indexOf(at)] ?? at;
  const body = parent.steps.slice(Math.min(start, at), at + 1);
  const room = Math.floor((context.maxLength * 4 - parent.steps.length) / body.length);
  const count = Math.min(context.rng.pick(repeatCounts(context)) ?? 2, room);
  if (count <= 0) return [...parent.steps];
  const copies = Array.from({ length: count }, () => body).flat();
  return [...parent.steps.slice(0, at + 1), ...copies, ...parent.steps.slice(at + 1)];
}

/**
 * Apply 1-3 random operators: insert, delete, swap, payload tweak, time
 * advance. Sometimes first loops a context-changing step of the parent.
 */
export function mutate(parent: Parent, context: MutationContext): VizStep[] {
  const loop = context.repeat && parent.contextSteps.length > 0 && context.rng.chance(0.2);
  let child = loop ? repeat(parent, context) : [...parent.steps];
  const rounds = (loop ? 0 : 1) + context.rng.int(3);
  for (let round = 0; round < rounds; round += 1) {
    const operator = context.rng.pick(OPERATORS) ?? insert;
    child = operator(child, context);
  }
  return child;
}
