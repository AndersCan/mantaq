import type { VizActorRef, VizJson, VizStep } from "@mantaq/viz";
import type { AnyActor, InternalEvent, VirtualClock } from "@mantaq/core";
import { Either } from "@mantaq/utils";
import { actorMapsOf } from "../maps.ts";
import type { ActorMapLike } from "../maps.ts";
import { matches } from "../expectations.ts";
import type { CheckedExpectation } from "../expectations.ts";

/** A machine the fuzzer can drive: a fresh actor plus the virtual clock it runs on. */
export interface FuzzTarget {
  id: string;
  create(): { actor: AnyActor<unknown>; clock: VirtualClock; made?: unknown };
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
  /** Events sent without a payload whose fields the machine then read, sorted by event. */
  missingPayloads: MissingPayload[];
  /** The map children the run started, in start order; a key started twice appears twice. */
  children: SeenChild[];
}

/** A map child a run started, with the steps it was alive for. */
export interface SeenChild {
  map: string;
  key: string;
  /** Index of the step that started it; -1 when it existed before the first step. */
  from: number;
  /** Index of the step after which it was gone; null while it is alive at the end. */
  until: number | null;
}

/** An event fuzzing sent without a payload, and the payload fields the machine read from it. */
export interface MissingPayload {
  event: string;
  /** Sorted. */
  fields: string[];
}

export function isActor(value: unknown): value is AnyActor<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    ["send", "snapshot", "inject"].every((key) => typeof Reflect.get(value, key) === "function")
  );
}

const ERROR_STATE = "__error";
/** Event name of an error thrown while the clock advanced (a timer callback). */
const ADVANCE = "advance";

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

/**
 * The events each actor-map child handles, found by starting a probe child:
 * maps sorted by name, each map's inputs then internal events sorted. A map
 * whose probe child fails gives none. The probe maps are disposed.
 */
export function childEvents(made: unknown): Array<{ map: string; event: string }> {
  const { maps } = actorMapsOf(made);
  return Object.entries(maps).flatMap(([map, each]) => {
    const found = Either.from(() => {
      each.spawn("example");
      const child = each.get("example");
      each.kill("example");
      if (!isActor(child)) return [];
      const catalog = eventCatalog(child);
      return [...catalog.inputs, ...catalog.internal].sort();
    });
    Either.from(() => each.dispose());
    return Either.isLeft(found) ? [] : found[1].map((event) => ({ map, event }));
  });
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

function toEvent(
  step: { event: string; payload: VizJson },
  empty?: (event: string) => object,
): InternalEvent {
  if (step.payload !== null) return { type: step.event, payload: step.payload };
  return empty === undefined
    ? { type: step.event }
    : { type: step.event, payload: empty(step.event) };
}

/** Keys a serializer probes on any value; not a read of a payload field. */
const NOT_A_FIELD = new Set(["toJSON"]);

/** Same event merged, fields and events sorted. */
export function mergeMissing(lists: ReadonlyArray<MissingPayload>): MissingPayload[] {
  const merged = new Map<string, Set<string>>();
  for (const { event, fields } of lists) {
    const set = merged.get(event) ?? new Set<string>();
    for (const field of fields) set.add(field);
    merged.set(event, set);
  }
  return [...merged]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([event, fields]) => ({ event, fields: [...fields].sort() }));
}

/**
 * An empty payload that notes the field names read from it, until `missing()` is read: later reads are not part of the trace.
 * It answers like `{}`: a read gives undefined, `in` gives false.
 */
function recordingPayloads(): {
  make: (event: string) => object;
  isMade: (value: unknown) => boolean;
  missing: () => MissingPayload[];
} {
  const read = new Map<string, Set<string>>();
  const made = new WeakSet<object>();
  const note = (event: string, key: string | symbol): void => {
    if (typeof key !== "string" || NOT_A_FIELD.has(key)) return;
    const fields = read.get(event) ?? new Set<string>();
    fields.add(key);
    read.set(event, fields);
  };
  return {
    make: (event) => {
      const proxy = new Proxy(
        {},
        {
          get: (target, key, receiver) => {
            note(event, key);
            return Reflect.get(target, key, receiver);
          },
          has: (target, key) => {
            note(event, key);
            return Reflect.has(target, key);
          },
        },
      );
      made.add(proxy);
      return proxy;
    },
    isMade: (value) => typeof value === "object" && value !== null && made.has(value),
    missing: () =>
      mergeMissing([...read].map(([event, fields]) => ({ event, fields: [...fields] }))),
  };
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

/** Every region actor under `actor`, nested ones included, with its dotted path, sorted by path. */
export function regionActors(
  actor: AnyActor<unknown>,
  prefix = "",
): Array<{ path: string; actor: AnyActor<unknown> }> {
  const found = Object.entries(actor.regions).flatMap(([name, region]) => {
    const path = `${prefix}${name}`;
    return [{ path, actor: region }, ...regionActors(region, `${path}.`)];
  });
  return found.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

/** The actor a step goes to; undefined when the step names a region or child that does not exist. */
export function targetOf(
  root: AnyActor<unknown>,
  ref: VizActorRef | undefined,
  maps: Readonly<Record<string, ActorMapLike>> = {},
): AnyActor<unknown> | undefined {
  if (ref === undefined) return root;
  if ("region" in ref) return regionActors(root).find((each) => each.path === ref.region)?.actor;
  const child = maps[ref.map]?.get(ref.key);
  return isActor(child) ? child : undefined;
}

const catalogs = new WeakMap<object, ReadonlySet<string>>();

function internalOf(actor: AnyActor<unknown>): ReadonlySet<string> {
  const cached = catalogs.get(actor);
  if (cached !== undefined) return cached;
  const found = new Set(eventCatalog(actor).internal);
  catalogs.set(actor, found);
  return found;
}

/** The one step function: the fuzzer and the live driver both apply steps through it. */
export function applyStep(
  root: AnyActor<unknown>,
  context: {
    step: VizStep;
    clock: VirtualClock;
    internal: ReadonlySet<string>;
    maps?: Readonly<Record<string, ActorMapLike>>;
    /** The payload for an event step that has none. Default: none. */
    emptyPayload?: (event: string) => object;
  },
): void {
  const { step } = context;
  if (step.kind === "advance") return context.clock.advance(step.ms);
  const actor = targetOf(root, step.actor, context.maps);
  if (actor === undefined) return;
  const internal = actor === root ? context.internal : internalOf(actor);
  // A live effect only emits while its state is active, and core rejects an
  // internal event the current state cannot handle. Such a step is a no-op.
  if (internal.has(step.event)) {
    if (handles(actor, step.event)) actor.inject(toEvent(step, context.emptyPayload));
  } else actor.send(toEvent(step, context.emptyPayload));
}

type Sinks = {
  visited: string[];
  observations: Observation[];
  errors: RunError[];
  plain: (payload: unknown) => unknown;
};

/** Record one region or child actor's moves and errors under its dotted path. */
function recordActor(
  child: AnyActor<unknown>,
  path: string,
  context: { root: AnyActor<unknown>; at: () => number; sinks: Sinks },
): void {
  const { root, at, sinks } = context;
  child.on("transition", {
    fn: ({ event, from, to, transitioned, effects }) => {
      sinks.observations.push({
        from: `${path}.${from}`,
        event: event.type,
        to: `${path}.${to}`,
        transitioned,
        effects,
        step: at(),
        payload: sinks.plain(event.payload),
        context: parsed(contextText(root)),
      });
      if (transitioned) sinks.visited.push(`${path}.${to}`);
    },
  });
  child.on("error", {
    fn: (info) => {
      sinks.errors.push({
        from: `${path}.${info.state.name}`,
        event: info.event.type,
        message: messageOf(info.error),
        step: at(),
      });
    },
  });
}

/**
 * Record every map child as it starts: its start state, moves and errors under
 * the map's name. `scan` after each step also finds children a map that cannot
 * be wrapped started, and marks the ones that are gone.
 */
function recordChildren(context: {
  root: AnyActor<unknown>;
  maps: Readonly<Record<string, ActorMapLike>>;
  at: () => number;
  sinks: Sinks;
}): { children: SeenChild[]; scan: () => void } {
  const { root, maps, at, sinks } = context;
  let running = false;
  const children: SeenChild[] = [];
  const watched = new Set<object>();
  const alive = new Map<SeenChild, object>();
  const watch = (name: string, key: string): void => {
    const child = maps[name]?.get(key);
    if (!isActor(child) || watched.has(child)) return;
    watched.add(child);
    sinks.visited.push(`${name}.${child.state.name}`);
    recordActor(child, name, { root, at, sinks });
    if (typeof key === "string") {
      const seen: SeenChild = { map: name, key, from: running ? at() : -1, until: null };
      children.push(seen);
      alive.set(seen, child);
    }
  };
  for (const [name, map] of Object.entries(maps)) {
    const spawn = map.spawn.bind(map);
    const ensure = map.ensure.bind(map);
    // A frozen map cannot be wrapped: the scan after each step still sees its children.
    Either.from(() => {
      map.spawn = (key) => {
        spawn(key);
        watch(name, key);
      };
      map.ensure = (key) => {
        ensure(key);
        watch(name, key);
      };
    });
    for (const key of map.keys()) watch(name, key);
  }
  running = true;
  const scan = (): void => {
    for (const [name, map] of Object.entries(maps)) {
      for (const key of map.keys()) watch(name, key);
    }
    for (const [seen, child] of alive) {
      if (maps[seen.map]?.get(seen.key) !== child) {
        seen.until = at();
        alive.delete(seen);
      }
    }
  };
  return { children, scan };
}

/**
 * Replay steps against a fresh actor. Synchronous and deterministic: effects
 * only run via the virtual clock, and nothing here reads wall time.
 */
export function execute(target: FuzzTarget, steps: ReadonlyArray<VizStep>): Trace {
  const { actor, clock, made } = target.create();
  const maps = actorMapsOf(made).maps;
  const internal = new Set(eventCatalog(actor).internal);
  const visited = [actor.state.name];
  const regions = regionActors(actor);
  for (const region of regions) visited.push(`${region.path}.${region.actor.state.name}`);
  const recording = recordingPayloads();
  /** What the handler got, as plain data: a recording payload is `{}`. */
  const plain = (payload: unknown): unknown => (recording.isMade(payload) ? {} : payload);
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
  const sinks = { visited, observations, errors, plain };
  const at = (): number => index;
  const recorder = recordChildren({
    root: actor,
    maps,
    at,
    sinks,
  });
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
        payload: plain(event.payload),
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
  for (const { path, actor: region } of regions)
    recordActor(region, path, { root: actor, at, sinks });
  for (const step of steps) {
    if (actor.state.name === ERROR_STATE) break;
    const before = contextText(actor);
    statesBefore.push(actor.state.name);
    // Core reports handler and effect-body throws via "error"; a throw from
    // user code the step runs outside them (a timer callback under
    // `clock.advance`) ends this run as an error, not the whole fuzz.
    const applied = Either.from(() => {
      applyStep(actor, { step, clock, internal, maps, emptyPayload: recording.make });
      return true;
    });
    if (Either.isLeft(applied)) {
      errors.push({
        from: actor.state.name,
        event: step.kind === "advance" ? ADVANCE : step.event,
        message: messageOf(applied[0]),
        step: index,
      });
      break;
    }
    recorder.scan();
    if (contextText(actor) !== before) {
      contextSteps.push(index);
      // A state not seen before this step has no cycle: loop the step alone.
      const start = statesBefore.lastIndexOf(actor.state.name);
      loopStarts.push(start === -1 ? index : start);
    }
    index += 1;
  }
  for (const map of Object.values(maps)) map.dispose();
  actor.dispose();
  const features = [...new Set([...featuresOf({ visited, observations, errors }), ...hits])].sort();
  const missingPayloads = recording.missing();
  return {
    visited,
    observations,
    errors,
    contextSteps,
    loopStarts,
    features,
    missingPayloads,
    children: recorder.children,
  };
}
