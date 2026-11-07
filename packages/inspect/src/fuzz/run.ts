import type { VizJson, VizStep } from "@mantaq/viz";
import type { AnyActor, InternalEvent, VirtualClock } from "@mantaq/core";
import { Either } from "@mantaq/utils";
import { matches } from "../expectations.ts";
import type { CheckedExpectation } from "../expectations.ts";

/** A machine the fuzzer can drive: a fresh actor plus the virtual clock it runs on. */
export interface FuzzTarget {
  id: string;
  create(): { actor: AnyActor<unknown>; clock: VirtualClock };
  /**
   * Sample payloads per event type. Payload types are erased at runtime, so
   * the fuzzer only mutates shapes it was given. Events without samples are
   * sent without a payload.
   */
  payloads?: Readonly<Record<string, ReadonlyArray<VizJson>>>;
  /** Contexts the machine file marks; each hit becomes a coverage feature. */
  expectations?: ReadonlyArray<CheckedExpectation>;
}

export interface Observation {
  from: string;
  event: string;
  to: string;
  transitioned: boolean;
  /** Names of the effects that ran on entry into `to`. */
  effects: string[];
  /** Index of the step that caused it. */
  step: number;
  /** Payload the handler received (for branch-distance guidance). */
  payload: unknown;
  /** JSON copy of the actor context right after the handler ran; null if not JSON. */
  context: unknown;
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
  /** Indices of steps after which the actor context differed: loop candidates. */
  contextSteps: number[];
  /**
   * Parallel to `contextSteps`: where the cycle ending at that step starts.
   * The last step from which the actor was in the state the step ended in, so
   * repeating `steps[start..step]` returns to the same state each time.
   */
  loopStarts: number[];
  /**
   * Coverage features, sorted: `state:x`, `edge:a>e>b` (state changed or
   * re-entered), `stay:a>e` (handled, no change), `error:a>e` (handler threw).
   */
  features: string[];
}

const ERROR_STATE = "__error";

export function eventTypes(options: unknown, key: "inputs" | "internal" | "outputs"): string[] {
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

function toEvent(step: { event: string; payload: VizJson }): InternalEvent {
  return step.payload === null ? { type: step.event } : { type: step.event, payload: step.payload };
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function featuresOf(trace: Pick<Trace, "visited" | "observations" | "errors">): string[] {
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

/** JSON text of the context, or null when it is not serializable (functions, cycles). */
export function contextText(actor: AnyActor<unknown>): string | null {
  const text = Either.from(() => JSON.stringify(actor.context ?? null));
  return Either.isRight(text) ? text[1] : null;
}

export function parsed(text: string | null): unknown {
  return text === null ? null : JSON.parse(text);
}

/** The one step function: the fuzzer and the live driver both apply steps through it. */
export function applyStep(
  actor: AnyActor<unknown>,
  context: { step: VizStep; clock: VirtualClock; internal: ReadonlySet<string> },
): void {
  const { step } = context;
  if (step.kind === "advance") context.clock.advance(step.ms);
  // A live effect only emits while its state is active, and core rejects an
  // internal event the current state cannot handle. Such a step is a no-op.
  else if (context.internal.has(step.event)) {
    if (handles(actor, step.event)) actor.inject(toEvent(step));
  } else actor.send(toEvent(step));
}

/**
 * Replay steps against a fresh actor. Synchronous and deterministic: effects
 * only run via the virtual clock, and nothing here reads wall time.
 */
export function execute(target: FuzzTarget, steps: ReadonlyArray<VizStep>): Trace {
  const { actor, clock } = target.create();
  const internal = new Set(eventCatalog(actor).internal);
  const visited = [actor.state.name];
  const observations: Observation[] = [];
  const errors: RunError[] = [];
  const contextSteps: number[] = [];
  const loopStarts: number[] = [];
  const expected = target.expectations ?? [];
  const hits = new Set<string>();
  const seeing = (state: string, context: unknown): void => {
    for (const each of expected) {
      if (each.state === state && matches(each.pattern, context)) hits.add(each.feature);
    }
  };
  if (expected.length > 0) seeing(actor.state.name, parsed(contextText(actor)));
  /** The actor's state before each step. */
  const statesBefore: string[] = [];
  let index = 0;
  actor.on("transition", {
    fn: ({ event, from, to, transitioned, effects }) => {
      const context = parsed(contextText(actor));
      observations.push({
        from,
        event: event.type,
        to,
        transitioned,
        effects,
        step: index,
        payload: event.payload,
        context,
      });
      if (transitioned) visited.push(to);
      if (expected.length > 0) seeing(transitioned ? to : from, context);
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
    const before = contextText(actor);
    statesBefore.push(actor.state.name);
    applyStep(actor, { step, clock, internal });
    if (contextText(actor) !== before) {
      contextSteps.push(index);
      // A state not seen before this step has no cycle: loop the step alone.
      const start = statesBefore.lastIndexOf(actor.state.name);
      loopStarts.push(start === -1 ? index : start);
    }
    index += 1;
  }
  actor.dispose();
  const features = [...new Set([...featuresOf({ visited, observations, errors }), ...hits])].sort();
  return { visited, observations, errors, contextSteps, loopStarts, features };
}
