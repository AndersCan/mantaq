import { toAtlasMachine } from "../atlas.ts";
import { ANY_STATE, coveredByAny } from "../schema.ts";
import type { AtlasEdge, AtlasEvent, AtlasMachine } from "../schema.ts";
import { edgeHits, stateVisits } from "./coverage.ts";
import type { FuzzResult } from "./fuzz.ts";
import { eventCatalog, execute } from "./run.ts";
import type { FuzzTarget, Observation, Trace } from "./run.ts";

function observedKey(seen: Observation, from: string): string {
  return seen.transitioned ? `${from}>${seen.event}>${seen.to}` : `${from}>${seen.event}`;
}

/**
 * Source to draw an observation from: its state when that state registers the
 * event, else the `*` source when an `onAny` handler does. One `*` edge beats
 * the same stay repeated on every state.
 */
function anySourceOf(machine: AtlasMachine, seen: Observation): string | undefined {
  return machine.edges.find(
    (edge) => edge.event === seen.event && coveredByAny(edge.from, seen.from),
  )?.from;
}

function sourceOf(machine: AtlasMachine, seen: Observation): string {
  const own = machine.edges.some((edge) => edge.from === seen.from && edge.event === seen.event);
  return own ? seen.from : (anySourceOf(machine, seen) ?? seen.from);
}

function fuzzEdge(seen: Observation, from: string): AtlasEdge {
  const kind = seen.transitioned ? "transition" : "stay";
  const to = kind === "stay" && from.endsWith(ANY_STATE) ? from : seen.to;
  return {
    id: `fuzz:${from}-${seen.event}-${kind === "stay" ? "stay" : seen.to}`,
    from,
    event: seen.event,
    to,
    kind,
    origin: "fuzz",
    emits: [],
    contexts: [],
    explanation: null,
    coverage: null,
    tested: null,
  };
}

function knownKey(edge: AtlasEdge): string | null {
  if (edge.kind === "stay") return `${edge.from}>${edge.event}`;
  return edge.to === null || edge.kind !== "transition"
    ? null
    : `${edge.from}>${edge.event}>${edge.to}`;
}

/**
 * Edges the fuzzer observed that the structure lacks: concrete targets of
 * undetermined handlers, and `stay` from handlers that declare targets but may
 * also return none. A transition outside `to` would land here too.
 */
function discoveredEdges(machine: AtlasMachine, traces: ReadonlyArray<Trace>): AtlasEdge[] {
  const known = new Set(machine.edges.flatMap((edge) => knownKey(edge) ?? []));
  const found = new Map<string, AtlasEdge>();
  for (const seen of traces.flatMap((trace) => trace.observations)) {
    const from = sourceOf(machine, seen);
    const key = observedKey(seen, from);
    const sources = [seen.from, anySourceOf(machine, seen)].flatMap((each) => each ?? []);
    if (sources.some((each) => known.has(observedKey(seen, each)))) continue;
    if (!found.has(key)) found.set(key, fuzzEdge(seen, from));
  }
  return [...found.values()];
}

function byId<T extends { id: string }>(left: T, right: T): number {
  if (left.id < right.id) return -1;
  return left.id > right.id ? 1 : 0;
}

/**
 * Atlas machine with fuzz results written in: coverage from replaying the
 * shrunk corpus, newly discovered edges (origin `fuzz`), and the corpus itself.
 */
export function fuzzedMachine(target: FuzzTarget, result: FuzzResult): AtlasMachine {
  const traces = result.corpus.map((entry) => execute(target, entry.steps));
  const fresh = target.create().actor;
  const internal = new Set(eventCatalog(fresh).internal);
  const base = toAtlasMachine({ id: target.id, actor: fresh });
  const added = discoveredEdges(base, traces);
  const known = new Set(base.events.map((event) => event.id));
  const events: AtlasEvent[] = [
    ...base.events,
    ...[...new Set(added.map((edge) => edge.event))]
      .filter((id) => !known.has(id))
      .map((id) => ({ id, internal: internal.has(id), payloadType: null })),
  ].sort(byId);
  return {
    ...base,
    events,
    states: base.states.map((state) => ({
      ...state,
      coverage: { hits: stateVisits(state.id, traces) },
    })),
    edges: [...base.edges, ...added].sort(byId).map((edge) => {
      const hits = edgeHits(edge, traces);
      return { ...edge, coverage: hits === null ? null : { hits } };
    }),
    fuzz: {
      seed: result.seed,
      iterations: result.iterations,
      corpus: result.corpus.map((entry) => ({ steps: entry.steps, discovered: entry.discovered })),
      errors: result.errors,
    },
  };
}
