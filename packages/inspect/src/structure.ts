import { VIZ_SCHEMA_VERSION, coveredByAny, isAnyState } from "@mantaq/viz";
import type {
  VizCoverage,
  VizDocument,
  VizEdge,
  VizEvent,
  VizMachine,
  VizState,
} from "@mantaq/viz";
import type { AnyActor } from "@mantaq/core";
import { actorMapsOf } from "./maps.ts";
import type { ActorMapLike } from "./maps.ts";
import { Either } from "@mantaq/utils";
import { eventTypes, isActor, regionActors } from "./fuzz/run.ts";
import {
  INITIAL_NODE_ID,
  buildGraph,
  parseInitialName,
  parseInternalEventIds,
  type GraphEdge,
  type GraphNode,
  type History,
} from "@mantaq/traversal";

export interface VizInput {
  id: string;
  /**
   * Fresh actor to probe for structure. Handlers that read live actor state
   * see this actor's current state, so pass one that has not been driven.
   */
  actor: AnyActor<unknown>;
  /** What the factory returned when it was `{ actor, ...maps }`; its actor maps are drawn as one child each. */
  made?: unknown;
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

function hits(count: number | undefined): VizCoverage {
  return { hits: count ?? 0 };
}

function toState(
  node: GraphNode,
  context: {
    visits: Map<string, number> | undefined;
    initialIds: ReadonlySet<string>;
    effects: ReadonlyArray<GraphEdge>;
  },
): VizState {
  const { visits } = context;
  return {
    id: node.id,
    label: node.label,
    region: regionOf(node.id),
    initial: context.initialIds.has(node.id),
    final: node.isFinal,
    effects: context.effects.find((edge) => edge.source === node.id)?.effects ?? [],
    coverage: visits ? hits(visits.get(node.id)) : null,
    tested: null,
    doc: null,
  };
}

function edgeKind(edge: GraphEdge): VizEdge["kind"] {
  if (edge.source === INITIAL_NODE_ID) return "initial";
  if (edge.isStay === true) return "stay";
  return edge.isInternal === true && edge.label.startsWith("effect:") ? "effect" : "transition";
}

function emitsOf(edge: GraphEdge): string[] {
  const action = edge.payload?.action;
  const match = action?.match(/^emit\((.*)\)$/);
  return match?.[1] ? match[1].split(", ").sort() : [];
}

/** Count of recorded transitions matching an edge by source, event and (if determined) target. */
function edgeHits(edge: GraphEdge, transitions: Map<string, Map<string, number>>): number {
  if (isAnyState(edge.source)) {
    let total = 0;
    for (const [key, byTarget] of transitions) {
      const [from = "", event] = key.split("\u0000");
      if (event !== edge.label || !coveredByAny(edge.source, from)) continue;
      total += isAnyHit(edge, byTarget);
    }
    return total;
  }
  const byTarget = transitions.get(`${edge.source}\u0000${edge.label}`);
  if (!byTarget) return 0;
  if (edge.isUndetermined === true) {
    return [...byTarget.values()].reduce((sum, count) => sum + count, 0);
  }
  return byTarget.get(edge.target) ?? 0;
}

/** Hits of an `onAny` edge from one source: its target, or every outcome when undetermined. */
function isAnyHit(edge: GraphEdge, byTarget: Map<string, number>): number {
  if (edge.isUndetermined === true) return [...byTarget.values()].reduce((sum, n) => sum + n, 0);
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
): VizEdge {
  const kind = edgeKind(edge);
  return {
    id: edge.id,
    from: edge.source,
    event: kind === "initial" ? "" : edge.label,
    to: edge.isUndetermined === true ? null : edge.target,
    kind,
    origin: edge.isDeclared === true ? "declared" : "probe",
    emits: emitsOf(edge),
    contexts: [...new Set(edge.contexts)].sort(),
    explanation: null,
    doc: null,
    coverage: transitions && kind === "transition" ? hits(edgeHits(edge, transitions)) : null,
    tested: null,
  };
}

interface MapChild {
  name: string;
  graph: ReturnType<typeof buildGraph>;
  initial: string | undefined;
  internal: Set<string>;
  inputs: string[];
}

/** What one map's probe child looks like, or why it cannot be drawn. */
function probeChild(name: string, map: ActorMapLike): Either<string, MapChild> {
  const probed = Either.from(() => {
    map.spawn("example");
    return map.get("example");
  });
  const cleanup = () => Either.from(() => map.kill("example"));
  if (Either.isLeft(probed)) {
    cleanup();
    return Either.left(
      `actor map ${name}: could not start a child to draw it: ${probed[0] instanceof Error ? probed[0].message : String(probed[0])}`,
    );
  }
  const child = probed[1];
  if (!isActor(child)) {
    cleanup();
    return Either.left(
      `actor map ${name}: its children are not mantaq actors, so they are not drawn`,
    );
  }
  const graph = buildGraph(child);
  const found: MapChild = {
    name,
    graph,
    initial: parseInitialName(child.options),
    internal: parseInternalEventIds(child.options),
    inputs: eventTypes(child.options, "inputs"),
  };
  cleanup();
  return Either.right(found);
}

/** Why an actor map in `made` is not drawn, or what to update. */
export function mapWarnings(made: unknown): string[] {
  const found = actorMapsOf(made);
  return [
    ...Object.entries(found.maps).flatMap(([name, map]) => {
      const probed = probeChild(name, map);
      return Either.isLeft(probed) ? [probed[0]] : [];
    }),
    ...found.old.map(
      (name) =>
        `${name} looks like an actor map from an older @mantaq/sugar (no get): update @mantaq/sugar to draw its children`,
    ),
  ];
}

/** The child's graph under `<name>.`: ids prefixed, no initial edge. */
function prefixedGraph(child: MapChild): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const at = (id: string): string => `${child.name}.${id}`;
  return {
    nodes: child.graph.nodes
      .filter((node) => node.id !== INITIAL_NODE_ID)
      .map((node) => ({ ...node, id: at(node.id) })),
    edges: child.graph.edges
      .filter((edge) => edge.source !== INITIAL_NODE_ID)
      .map((edge) => ({
        ...edge,
        id: at(edge.id),
        source: at(edge.source),
        target: at(edge.target),
      })),
  };
}

/** One machine; `toViz` is this plus sorting into a document. */
export function toVizMachine(input: VizInput): VizMachine {
  const own = buildGraph(input.actor, { sampleContexts: input.sampleContexts });
  const children = Object.entries(actorMapsOf(input.made).maps).flatMap(([name, map]) => {
    const probed = probeChild(name, map);
    return Either.isRight(probed) ? [probed[1]] : [];
  });
  const drawn = children.map(prefixedGraph);
  const graph = {
    nodes: [...own.nodes, ...drawn.flatMap((each) => each.nodes)],
    edges: [...own.edges, ...drawn.flatMap((each) => each.edges)],
  };
  const regionActorList = regionActors(input.actor);
  const internalIds = new Set([
    ...parseInternalEventIds(input.actor.options),
    ...regionActorList.flatMap((each) => [...parseInternalEventIds(each.actor.options)]),
    ...children.flatMap((each) => [...each.internal]),
  ]);
  const initialEdge = graph.edges.find((edge) => edge.source === INITIAL_NODE_ID);
  const initial = initialEdge?.target ?? null;
  const initialIds = new Set([
    ...(initial === null ? [] : [initial]),
    ...regionActorList.flatMap((each) => {
      const name = parseInitialName(each.actor.options);
      return name === undefined ? [] : [`${each.path}.${name}`];
    }),
    ...children.flatMap((each) =>
      each.initial === undefined ? [] : [`${each.name}.${each.initial}`],
    ),
  ]);
  const mapNames = new Set(children.map((each) => each.name));
  const inMap = (id: string): boolean => mapNames.has(regionOf(id) ?? "");

  const visits = input.history
    ? countBy(input.history.stateVisits().map((visit) => visit.stateName))
    : undefined;
  const transitions = input.history ? indexTransitions(input.history) : undefined;

  const effectEdges = graph.edges.filter((edge) => edgeKind(edge) === "effect");
  const states = graph.nodes
    .filter((node) => node.id !== INITIAL_NODE_ID && node.isAny !== true)
    .map((node) => toState(node, { visits, initialIds, effects: effectEdges }))
    .map((state) => (inMap(state.id) ? { ...state, coverage: null, tested: null } : state))
    .sort(byId);
  const edges = graph.edges
    .map((edge) => toEdge(edge, transitions))
    .map((edge) => (inMap(edge.from) ? { ...edge, coverage: null, tested: null } : edge))
    .sort(byId);
  const declaredInputs = [
    ...eventTypes(input.actor.options, "inputs"),
    ...children.flatMap((each) => each.inputs),
  ];
  const events: VizEvent[] = [
    ...new Set([
      ...edges.map((edge) => edge.event).filter(Boolean),
      ...declaredInputs,
      ...internalIds,
    ]),
  ]
    .filter((eventId) => !eventId.startsWith("effect:"))
    .sort()
    .map((eventId) => ({
      id: eventId,
      internal: internalIds.has(eventId),
      doc: null,
      payload: null,
    }));
  const regions = [
    ...new Set([...states.flatMap((state) => (state.region ? [state.region] : [])), ...mapNames]),
  ].sort();

  const outputs = eventTypes(input.actor.options, "outputs").sort();
  return {
    id: input.id,
    initial,
    regions,
    maps: [...mapNames].sort(),
    states,
    events,
    outputs,
    context: null,
    edges,
    fuzz: null,
    runs: [],
  };
}

export function toViz(inputs: ReadonlyArray<VizInput>): VizDocument {
  return {
    schemaVersion: VIZ_SCHEMA_VERSION,
    machines: inputs.map(toVizMachine).sort(byId),
  };
}
