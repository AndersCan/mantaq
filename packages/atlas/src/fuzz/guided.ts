import type { AtlasComparison, AtlasMachine } from "../schema.ts";
import type { FuzzOptions } from "./fuzz.ts";
import type { LiteralPool } from "./mutate.ts";
import type { Trace } from "./run.ts";

/** A payload or context comparison in a specific handler, from the AST explanation. */
interface Probe {
  /** null = onAny handler, applies in every state. */
  state: string | null;
  event: string;
  comparison: AtlasComparison;
}

/**
 * Literal seeding: every literal the handlers compare against, plus its
 * neighbours (`L - 1`, `L + 1`) so boundary sides are both reachable.
 */
export function literalPool(machine: AtlasMachine): LiteralPool {
  const numbers = new Set<number>();
  const strings = new Set<string>();
  for (const edge of machine.edges) {
    if (edge.explanation?.status !== "analyzed") continue;
    for (const literal of edge.explanation.literals) {
      if (typeof literal === "string") strings.add(literal);
      else for (const near of [literal - 1, literal, literal + 1]) numbers.add(near);
    }
  }
  return {
    numbers: [...numbers].sort((left, right) => left - right),
    strings: [...strings].sort(),
  };
}

function probesOf(machine: AtlasMachine): Probe[] {
  const seen = new Set<string>();
  const probes: Probe[] = [];
  for (const edge of machine.edges) {
    const explanation = edge.explanation;
    if (explanation?.status !== "analyzed") continue;
    const state = explanation.registration === "onAny" ? null : edge.from;
    for (const comparison of explanation.comparisons) {
      const key = `${state}>${edge.event}>${JSON.stringify(comparison)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      probes.push({ state, event: edge.event, comparison });
    }
  }
  return probes;
}

function valueAt(payload: unknown, path: string): unknown {
  let current = payload;
  for (const key of path.split(".").filter(Boolean)) {
    if (typeof current !== "object" || current === null) return undefined;
    current = Reflect.get(current, key);
  }
  return current;
}

function stringDistance(left: string, right: string): number {
  let distance = Math.abs(left.length - right.length);
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) distance += 1;
  }
  return distance;
}

function numericDistance(operator: AtlasComparison["operator"], gap: number): [number, number] {
  const distances: Record<AtlasComparison["operator"], [whenTrue: number, whenFalse: number]> = {
    "<": [Math.max(0, gap + 1), Math.max(0, -gap)],
    "<=": [Math.max(0, gap), Math.max(0, 1 - gap)],
    ">": [Math.max(0, 1 - gap), Math.max(0, gap)],
    ">=": [Math.max(0, -gap), Math.max(0, gap + 1)],
    "===": [Math.abs(gap), gap === 0 ? 1 : 0],
    "==": [Math.abs(gap), gap === 0 ? 1 : 0],
    "!==": [gap === 0 ? 1 : 0, Math.abs(gap)],
    "!=": [gap === 0 ? 1 : 0, Math.abs(gap)],
  };
  return distances[operator];
}

const EQUALITY = new Set<AtlasComparison["operator"]>(["===", "=="]);
const INEQUALITY = new Set<AtlasComparison["operator"]>(["!==", "!="]);

/**
 * Branch distance (Korel/Tracey): how far `value` is from making the
 * comparison `outcome`. 0 = that side is taken. Undefined when incomparable.
 */
export function branchDistance(
  comparison: AtlasComparison,
  context: { value: unknown; outcome: boolean },
): number | undefined {
  const { value, outcome } = context;
  const { literal, operator } = comparison;
  if (typeof value === "number" && typeof literal === "number") {
    const [whenTrue, whenFalse] = numericDistance(operator, value - literal);
    return outcome ? whenTrue : whenFalse;
  }
  if (typeof value !== "string" || typeof literal !== "string") return undefined;
  if (!EQUALITY.has(operator) && !INEQUALITY.has(operator)) return undefined;
  const distance = stringDistance(value, literal);
  const equalWanted = EQUALITY.has(operator) === outcome;
  if (equalWanted) return distance;
  return distance === 0 ? 1 : 0;
}

function applies(probe: Probe, observation: { from: string; event: string }): boolean {
  return (
    probe.event === observation.event && (probe.state === null || probe.state === observation.from)
  );
}

/**
 * Stateful guide for `fuzz({ guide })`. For every comparison outcome not yet
 * reached it remembers the smallest distance seen; a run that gets closer is
 * kept as a stepping stone. Reached outcomes stop counting.
 */
export function branchDistanceGuide(machine: AtlasMachine): (trace: Trace) => boolean {
  const probes = probesOf(machine);
  const best = new Map<string, number>();
  return (trace) => {
    let improved = false;
    for (const observation of trace.observations) {
      probes.forEach((probe, index) => {
        if (!applies(probe, observation)) return;
        const source =
          probe.comparison.source === "payload" ? observation.payload : observation.context;
        const value = valueAt(source, probe.comparison.path);
        for (const outcome of [true, false]) {
          const key = `${index}:${outcome}`;
          const distance = branchDistance(probe.comparison, { value, outcome });
          const previous = best.get(key) ?? Number.POSITIVE_INFINITY;
          if (distance === undefined || previous === 0 || distance >= previous) continue;
          best.set(key, distance);
          improved = true;
        }
      });
    }
    return improved;
  };
}

/** Phase 5 search options for an AST-annotated machine: literal seeding + branch distance. */
export function guidance(machine: AtlasMachine): Pick<FuzzOptions, "literals" | "guide"> {
  return { literals: literalPool(machine), guide: branchDistanceGuide(machine) };
}
