import { toAtlasMachine } from "../atlas.ts";
import type { AtlasEdge, AtlasEvent, AtlasMachine } from "../schema.ts";
import { edgeHits, stateVisits } from "./coverage.ts";
import type { FuzzResult } from "./fuzz.ts";
import { eventCatalog, execute } from "./run.ts";
import type { FuzzTarget, Observation, Trace } from "./run.ts";

function observedKey(seen: Observation): string {
  return seen.transitioned ? `${seen.from}>${seen.event}>${seen.to}` : `${seen.from}>${seen.event}`;
}

function fuzzEdge(seen: Observation): AtlasEdge {
  const kind = seen.transitioned ? "transition" : "stay";
  return {
    id: `fuzz:${seen.from}-${seen.event}-${kind === "stay" ? "stay" : seen.to}`,
    from: seen.from,
    event: seen.event,
    to: seen.to,
    kind,
    origin: "fuzz",
    emits: [],
    contexts: [],
    explanation: null,
    coverage: null,
    tested: null,
  };
}

/**
 * Edges the fuzzer observed that probing did not produce as determined edges:
 * concrete targets of undetermined handlers, payload-dependent branches, and
 * `stay` (handled, no state change).
 */
function discoveredEdges(machine: AtlasMachine, traces: ReadonlyArray<Trace>): AtlasEdge[] {
  const probed = new Set(
    machine.edges.flatMap((edge) =>
      edge.to === null || edge.kind !== "transition"
        ? []
        : [`${edge.from}>${edge.event}>${edge.to}`],
    ),
  );
  const found = new Map<string, Observation>();
  for (const seen of traces.flatMap((trace) => trace.observations)) {
    const key = observedKey(seen);
    if (seen.transitioned && probed.has(key)) continue;
    if (!found.has(key)) found.set(key, seen);
  }
  return [...found.values()].map(fuzzEdge);
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
