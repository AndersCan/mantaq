import { VIZ_SCHEMA_VERSION } from "@mantaq/viz";
import type { VizDocument, VizEdge, VizEvent, VizMachine, VizState } from "@mantaq/viz";
import type { AnyActor } from "@mantaq/core";
import { actorMapsOf } from "./maps.ts";
import type { ActorMapLike } from "./maps.ts";
import { Either } from "@mantaq/utils";
import { eventTypes, isActor, otherActorsOf, regionActors } from "./fuzz/run.ts";
import {
  INITIAL_NODE_ID,
  buildGraph,
  parseInitialName,
  parseInternalEventIds,
  type GraphEdge,
  type GraphNode,
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
}

function byId<T extends { id: string }>(left: T, right: T): number {
  if (left.id < right.id) return -1;
  return left.id > right.id ? 1 : 0;
}

function regionOf(nodeId: string): string | null {
  const cut = nodeId.lastIndexOf(".");
  return cut === -1 ? null : nodeId.slice(0, cut);
}

function toState(
  node: GraphNode,
  context: {
    initialIds: ReadonlySet<string>;
    effects: ReadonlyArray<GraphEdge>;
  },
): VizState {
  return {
    id: node.id,
    label: node.label,
    region: regionOf(node.id),
    initial: context.initialIds.has(node.id),
    final: node.isFinal,
    effects: context.effects.find((edge) => edge.source === node.id)?.effects ?? [],
    coverage: null,
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

function toEdge(edge: GraphEdge): VizEdge {
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
    coverage: null,
    tested: null,
  };
}

interface MapChild {
  name: string;
  graph: ReturnType<typeof buildGraph>;
  initial: string | undefined;
  internal: Set<string>;
  inputs: string[];
  outputs: string[];
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
  const found = partOf(name, child);
  cleanup();
  return Either.right(found);
}

/** What one actor looks like as a part drawn under its name. */
function partOf(name: string, actor: AnyActor<unknown>): MapChild {
  return {
    name,
    graph: buildGraph(actor),
    initial: parseInitialName(actor.options),
    internal: parseInternalEventIds(actor.options),
    inputs: eventTypes(actor.options, "inputs"),
    outputs: eventTypes(actor.options, "outputs"),
  };
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
  const own = buildGraph(input.actor);
  const children = Object.entries(actorMapsOf(input.made).maps).flatMap(([name, map]) => {
    const probed = probeChild(name, map);
    return Either.isRight(probed) ? [probed[1]] : [];
  });
  const otherActors = Object.entries(otherActorsOf(input.made, input.actor)).map(([name, part]) =>
    partOf(name, part),
  );
  const drawn = [...children, ...otherActors].map(prefixedGraph);
  const graph = {
    nodes: [...own.nodes, ...drawn.flatMap((each) => each.nodes)],
    edges: [...own.edges, ...drawn.flatMap((each) => each.edges)],
  };
  const regionActorList = regionActors(input.actor);
  const internalIds = new Set([
    ...parseInternalEventIds(input.actor.options),
    ...regionActorList.flatMap((each) => [...parseInternalEventIds(each.actor.options)]),
    ...[...children, ...otherActors].flatMap((each) => [...each.internal]),
  ]);
  const initialEdge = graph.edges.find((edge) => edge.source === INITIAL_NODE_ID);
  const initial = initialEdge?.target ?? null;
  const initialIds = new Set([
    ...(initial === null ? [] : [initial]),
    ...regionActorList.flatMap((each) => {
      const name = parseInitialName(each.actor.options);
      return name === undefined ? [] : [`${each.path}.${name}`];
    }),
    ...[...children, ...otherActors].flatMap((each) =>
      each.initial === undefined ? [] : [`${each.name}.${each.initial}`],
    ),
  ]);
  const mapNames = new Set(children.map((each) => each.name));
  const actorNames = new Set(otherActors.map((each) => each.name));
  const inMap = (id: string): boolean => mapNames.has(regionOf(id) ?? "");

  const effectEdges = graph.edges.filter((edge) => edgeKind(edge) === "effect");
  const states = graph.nodes
    .filter((node) => node.id !== INITIAL_NODE_ID && node.isAny !== true)
    .map((node) => toState(node, { initialIds, effects: effectEdges }))
    .map((state) => (inMap(state.id) ? { ...state, coverage: null, tested: null } : state))
    .sort(byId);
  const edges = graph.edges
    .map((edge) => toEdge(edge))
    .map((edge) => (inMap(edge.from) ? { ...edge, coverage: null, tested: null } : edge))
    .sort(byId);
  const declaredInputs = [
    ...eventTypes(input.actor.options, "inputs"),
    ...[...children, ...otherActors].flatMap((each) => each.inputs),
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
  const partOutputs = Object.fromEntries(
    [
      ...regionActorList.map((each) => [each.path, eventTypes(each.actor.options, "outputs")]),
      ...[...children, ...otherActors].map((each) => [each.name, each.outputs]),
    ]
      .filter(([, list]) => list.length > 0)
      .map(([name, list]) => [name, [...list].sort()]),
  );
  return {
    id: input.id,
    initial,
    regions,
    maps: [...mapNames].sort(),
    actors: [...actorNames].sort(),
    states,
    events,
    outputs,
    partOutputs,
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
