import type { AtlasJson, AtlasStep } from "../schema.ts";
import type { AnyActor, InternalEvent, VirtualClock } from "@mantaq/core";

/** A machine the fuzzer can drive: a fresh actor plus the virtual clock it runs on. */
export interface FuzzTarget {
  id: string;
  create(): { actor: AnyActor<unknown>; clock: VirtualClock };
  /**
   * Sample payloads per event type. Payload types are erased at runtime, so
   * the fuzzer only mutates shapes it was given. Events without samples are
   * sent without a payload.
   */
  payloads?: Readonly<Record<string, ReadonlyArray<AtlasJson>>>;
}

export interface Observation {
  from: string;
  event: string;
  to: string;
  transitioned: boolean;
  /** Payload the handler received (for branch-distance guidance). */
  payload: unknown;
}

export interface RunError {
  from: string;
  event: string;
  message: string;
  /** Index of the step that triggered it. */
  step: number;
}

export interface Trace {
  visited: string[];
  observations: Observation[];
  errors: RunError[];
  /**
   * Coverage features, sorted: `state:x`, `edge:a>e>b` (state changed or
   * re-entered), `stay:a>e` (handled, no change), `error:a>e` (handler threw).
   */
  features: string[];
}

const ERROR_STATE = "__error";

function eventTypes(options: unknown, key: "inputs" | "internal"): string[] {
  if (typeof options !== "object" || options === null) return [];
  const list: unknown = Reflect.get(options, key);
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const type: unknown = Reflect.get(entry, "type");
    return typeof type === "string" ? [type] : [];
  });
}

/** Declared inputs and internal events, each sorted. */
export function eventCatalog(actor: AnyActor<unknown>): { inputs: string[]; internal: string[] } {
  return {
    inputs: eventTypes(actor.options, "inputs").sort(),
    internal: eventTypes(actor.options, "internal").sort(),
  };
}

/** onAny handlers live under this key in the dispatch map (core builder). */
const ANY_KEY = "Any";

function handles(actor: AnyActor<unknown>, event: string): boolean {
  const transitions = actor.options?.transitions;
  return (
    transitions?.[actor.state.name]?.[event] !== undefined ||
    transitions?.[ANY_KEY]?.[event] !== undefined
  );
}

function toEvent(step: { event: string; payload: AtlasJson }): InternalEvent {
  return step.payload === null ? { type: step.event } : { type: step.event, payload: step.payload };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function featuresOf(trace: Omit<Trace, "features">): string[] {
  const features = new Set<string>();
  for (const state of trace.visited) features.add(`state:${state}`);
  for (const seen of trace.observations) {
    features.add(
      seen.transitioned
        ? `edge:${seen.from}>${seen.event}>${seen.to}`
        : `stay:${seen.from}>${seen.event}`,
    );
  }
  for (const error of trace.errors) features.add(`error:${error.from}>${error.event}`);
  return [...features].sort();
}

/**
 * Replay steps against a fresh actor. Synchronous and deterministic: effects
 * only run via the virtual clock, and nothing here reads wall time.
 */
export function execute(target: FuzzTarget, steps: ReadonlyArray<AtlasStep>): Trace {
  const { actor, clock } = target.create();
  const internal = new Set(eventCatalog(actor).internal);
  const visited = [actor.state.name];
  const observations: Observation[] = [];
  const errors: RunError[] = [];
  let index = 0;
  actor.on("transition", {
    fn: ({ event, from, to, transitioned }) => {
      observations.push({ from, event: event.type, to, transitioned, payload: event.payload });
      if (transitioned) visited.push(to);
    },
  });
  actor.on("error", {
    fn: (info) => {
      errors.push({
        from: info.state.name,
        event: info.event.type,
        message: messageOf(info.error),
        step: index,
      });
    },
  });
  for (const step of steps) {
    if (actor.state.name === ERROR_STATE) break;
    if (step.kind === "advance") clock.advance(step.ms);
    // A live effect only emits while its state is active, and core rejects an
    // internal event the current state cannot handle. Such a step is a no-op.
    else if (internal.has(step.event)) {
      if (handles(actor, step.event)) actor.inject(toEvent(step));
    } else actor.send(toEvent(step));
    index += 1;
  }
  actor.dispose();
  return { visited, observations, errors, features: featuresOf({ visited, observations, errors }) };
}
