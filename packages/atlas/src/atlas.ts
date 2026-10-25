import { ATLAS_SCHEMA_VERSION } from "./schema.ts";
import type {
  AtlasCoverage,
  AtlasDocument,
  AtlasEdge,
  AtlasEvent,
  AtlasMachine,
  AtlasState,
} from "./schema.ts";
import type { AnyActor } from "@mantaq/core";
import {
  INITIAL_NODE_ID,
  buildGraph,
  parseInternalEventIds,
  type GraphEdge,
  type GraphNode,
  type History,
} from "@mantaq/traversal";

export interface AtlasInput {
  id: string;
  /**
   * Fresh actor to probe for structure. Handlers that read live actor state
   * see this actor's current state, so pass one that has not been driven.
   */
  actor: AnyActor<unknown>;
  /** History from `instrument(actor)`; omit for a structure-only document. */
  history?: History;
  sampleContexts?: Record<string, Record<string, unknown>>;
}

function byId<T extends { id: string }>(left: T, right: T): number {
  if (left.id < right.id) return -1;
  return left.id > right.id ? 1 : 0;
}

function regionOf(nodeId: string): string | null {
  const cut = nodeId.lastIndexOf(".");
  return cut === -1 ? null : nodeId.slice(0, cut);
}

function countBy(keys: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

function hits(count: number | undefined): AtlasCoverage {
  return { hits: count ?? 0 };
}

function toState(
  node: GraphNode,
  visits: Map<string, number> | undefined,
  initialId: string | null,
): AtlasState {
  return {
    id: node.id,
    label: node.label,
    region: regionOf(node.id),
    initial: node.id === initialId,
    final: node.isFinal,
    coverage: visits ? hits(visits.get(node.id)) : null,
  };
}

function edgeKind(edge: GraphEdge): AtlasEdge["kind"] {
  if (edge.source === INITIAL_NODE_ID) return "initial";
  return edge.isInternal === true && edge.label.startsWith("effect:") ? "effect" : "transition";
}

function emitsOf(edge: GraphEdge): string[] {
  const action = edge.payload?.action;
  const match = action?.match(/^emit\((.*)\)$/);
  return match?.[1] ? match[1].split(", ").sort() : [];
}

/** Count of recorded transitions matching an edge by source, event and (if determined) target. */
function edgeHits(edge: GraphEdge, transitions: Map<string, Map<string, number>>): number {
  const byTarget = transitions.get(`${edge.source}\u0000${edge.label}`);
  if (!byTarget) return 0;
  if (edge.isUndetermined === true) {
    return [...byTarget.values()].reduce((sum, count) => sum + count, 0);
  }
  return byTarget.get(edge.target) ?? 0;
}

function indexTransitions(history: History): Map<string, Map<string, number>> {
  const index = new Map<string, Map<string, number>>();
  for (const record of history.transitions()) {
    const key = `${record.from}\u0000${record.event}`;
    const byTarget = index.get(key) ?? new Map<string, number>();
    const target = record.to ?? "";
    byTarget.set(target, (byTarget.get(target) ?? 0) + 1);
    index.set(key, byTarget);
  }
  return index;
}

function toEdge(
  edge: GraphEdge,
  transitions: Map<string, Map<string, number>> | undefined,
): AtlasEdge {
  const kind = edgeKind(edge);
  return {
    id: edge.id,
    from: edge.source,
    event: kind === "initial" ? "" : edge.label,
    to: edge.isUndetermined === true ? null : edge.target,
    kind,
    origin: "probe",
    emits: emitsOf(edge),
    contexts: [...new Set(edge.contexts)].sort(),
    explanation: null,
    coverage: transitions && kind === "transition" ? hits(edgeHits(edge, transitions)) : null,
  };
}

/** One machine; `toAtlas` is this plus sorting into a document. */
export function toAtlasMachine(input: AtlasInput): AtlasMachine {
  const graph = buildGraph(input.actor, { sampleContexts: input.sampleContexts });
  const internalIds = parseInternalEventIds(input.actor.options);
  const initialEdge = graph.edges.find((edge) => edge.source === INITIAL_NODE_ID);
  const initial = initialEdge?.target ?? null;

  const visits = input.history
    ? countBy(input.history.stateVisits().map((visit) => visit.stateName))
    : undefined;
  const transitions = input.history ? indexTransitions(input.history) : undefined;

  const states = graph.nodes
    .filter((node) => node.id !== INITIAL_NODE_ID)
    .map((node) => toState(node, visits, initial))
    .sort(byId);
  const edges = graph.edges.map((edge) => toEdge(edge, transitions)).sort(byId);
  const events: AtlasEvent[] = [...new Set(edges.map((edge) => edge.event).filter(Boolean))]
    .filter((eventId) => !eventId.startsWith("effect:"))
    .sort()
    .map((eventId) => ({ id: eventId, internal: internalIds.has(eventId), payloadType: null }));
  const regions = [
    ...new Set(states.flatMap((state) => (state.region ? [state.region] : []))),
  ].sort();

  return { id: input.id, initial, regions, states, events, edges, fuzz: null };
}

export function toAtlas(inputs: ReadonlyArray<AtlasInput>): AtlasDocument {
  return {
    schemaVersion: ATLAS_SCHEMA_VERSION,
    machines: inputs.map(toAtlasMachine).sort(byId),
  };
}
