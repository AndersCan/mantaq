import type { AtlasJson, AtlasStep } from "../schema.ts";
import type { Rng } from "./rng.ts";

/** Extra values to try at payload leaves (Phase 5 literal seeding). Empty = blind mutation. */
export interface LiteralPool {
  numbers: number[];
  strings: string[];
}

export interface MutationContext {
  rng: Rng;
  /** Every event type the machine declares, sorted. */
  events: ReadonlyArray<string>;
  payloads: Readonly<Record<string, ReadonlyArray<AtlasJson>>>;
  literals: LiteralPool;
  maxLength: number;
}

const ADVANCES = [1, 10, 100, 500, 1000, 5000];

function isObject(value: AtlasJson): value is { [key: string]: AtlasJson } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function freshEvent(context: MutationContext): AtlasStep {
  const event = context.rng.pick(context.events) ?? "";
  const samples = context.payloads[event] ?? [];
  const payload = context.rng.pick(samples) ?? null;
  return { kind: "event", event, payload };
}

function freshStep(context: MutationContext): AtlasStep {
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
function mutateJson(value: AtlasJson, context: MutationContext): AtlasJson {
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

function replaceAt(steps: AtlasStep[], at: number, step: AtlasStep): AtlasStep[] {
  return steps.map((current, index) => (index === at ? step : current));
}

function mutatePayload(steps: AtlasStep[], context: MutationContext): AtlasStep[] {
  const withPayload = steps.flatMap((step, index) =>
    step.kind === "event" && step.payload !== null ? [index] : [],
  );
  const at = context.rng.pick(withPayload);
  const step = at === undefined ? undefined : steps[at];
  if (at === undefined || step?.kind !== "event") return steps;
  return replaceAt(steps, at, { ...step, payload: mutateJson(step.payload, context) });
}

function insert(steps: AtlasStep[], context: MutationContext): AtlasStep[] {
  if (steps.length >= context.maxLength) return steps;
  // Appending is favoured: most new behaviour lives past the current frontier.
  const at = context.rng.chance(0.6) ? steps.length : context.rng.int(steps.length + 1);
  return [...steps.slice(0, at), freshStep(context), ...steps.slice(at)];
}

function remove(steps: AtlasStep[], context: MutationContext): AtlasStep[] {
  if (steps.length === 0) return steps;
  const at = context.rng.int(steps.length);
  return steps.filter((_, index) => index !== at);
}

function swap(steps: AtlasStep[], context: MutationContext): AtlasStep[] {
  if (steps.length < 2) return steps;
  const at = context.rng.int(steps.length - 1);
  const left = steps[at];
  const right = steps[at + 1];
  if (left === undefined || right === undefined) return steps;
  return replaceAt(replaceAt(steps, at, right), at + 1, left);
}

function advance(steps: AtlasStep[], context: MutationContext): AtlasStep[] {
  if (steps.length >= context.maxLength) return steps;
  const at = context.rng.int(steps.length + 1);
  const ms = context.rng.pick(ADVANCES) ?? 1;
  return [...steps.slice(0, at), { kind: "advance", ms }, ...steps.slice(at)];
}

const OPERATORS = [insert, insert, insert, remove, swap, mutatePayload, mutatePayload, advance];

/** Apply 1-3 random operators: insert, delete, swap, payload tweak, time advance. */
export function mutate(steps: ReadonlyArray<AtlasStep>, context: MutationContext): AtlasStep[] {
  let child = [...steps];
  const rounds = 1 + context.rng.int(3);
  for (let round = 0; round < rounds; round += 1) {
    const operator = context.rng.pick(OPERATORS) ?? insert;
    child = operator(child, context);
  }
  return child;
}
