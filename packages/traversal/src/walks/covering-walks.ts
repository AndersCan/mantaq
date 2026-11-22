import type { ActorGraph, GraphEdge, GraphNode } from "../types.ts";
import { INITIAL_NODE_ID, isAnyNode } from "../graph-ids.ts";

/** One planned event of a walk: the state it happens in and the state its edge leads to. */
export interface WalkStep {
  edgeId: string;
  from: string;
  event: string;
  /** The planned target. The handler picks the real one, so a runner compares it with the actual state. */
  to: string;
  /** `outside`: the runner sends the event. `machine`: the machine raises it itself and the runner waits. */
  sender: "outside" | "machine";
}

export interface CoveringWalks {
  /** Each walk starts from a fresh actor; together they take every reachable sendable edge. */
  walks: WalkStep[][];
  /** Ids of sendable edges no walk can take from the initial state. */
  unreachable: string[];
}

function isRootEvent(edge: GraphEdge): boolean {
  const isRootLevel = edge.source !== INITIAL_NODE_ID && !edge.source.includes(".");
  return isRootLevel && edge.isUndetermined !== true && edge.effects === undefined;
}

/** The edges an outside sender can take: root-level, with a declared target, not internal. */
export function sendableEdges(graph: ActorGraph): GraphEdge[] {
  const sendable: GraphEdge[] = [];
  for (const edge of graph.edges) {
    if (isRootEvent(edge) && edge.isInternal !== true) sendable.push(edge);
  }
  return sendable;
}

interface StepRoute {
  from: string;
  to: string;
}

function toStep(edge: GraphEdge, route: StepRoute): WalkStep {
  const sender = edge.isInternal === true ? "machine" : "outside";
  return { edgeId: edge.id, from: route.from, event: edge.label, to: route.to, sender };
}

interface AnyTargetOptions {
  anyEdges: GraphEdge[];
}

/** Where the any-state handler for `event` moves the machine, when it moves it at all. */
function anyTarget(event: string, options: AnyTargetOptions): string | undefined {
  for (const edge of options.anyEdges) {
    if (edge.label === event && !isAnyNode(edge.target)) return edge.target;
  }
  return undefined;
}

interface StateMovesOptions {
  edges: GraphEdge[];
}

/**
 * A state's own edges, then the any-state edges. An own handler that moves the
 * machine keeps the any-state handler from moving it; one that stays does not.
 */
function stateMoves(node: GraphNode, options: StateMovesOptions): WalkStep[] {
  const moves: WalkStep[] = [];
  const moved = new Set<string>();
  const anyEdges = node.isFinal ? [] : options.edges.filter((edge) => isAnyNode(edge.source));
  for (const edge of options.edges) {
    if (edge.source !== node.id) continue;
    let target = edge.target;
    if (edge.isStay === true) target = anyTarget(edge.label, { anyEdges }) ?? node.id;
    else moved.add(edge.label);
    moves.push(toStep(edge, { from: node.id, to: target }));
  }
  for (const edge of anyEdges) {
    if (moved.has(edge.label)) continue;
    const target = isAnyNode(edge.target) ? node.id : edge.target;
    moves.push(toStep(edge, { from: node.id, to: target }));
  }
  return moves;
}

function movesByState(graph: ActorGraph): Map<string, WalkStep[]> {
  const edges = graph.edges.filter(isRootEvent);
  const moves = new Map<string, WalkStep[]>();
  for (const node of graph.nodes) {
    const isMarker = node.isInitial === true || node.isAny === true;
    if (isMarker || node.id.includes(".")) continue;
    moves.set(node.id, stateMoves(node, { edges }));
  }
  return moves;
}

interface Search {
  moves: Map<string, WalkStep[]>;
  remaining: Set<string>;
}

/** The shortest run of steps from `start` that ends on an edge no walk has taken yet. */
function stepsToUncovered(start: string, search: Search): WalkStep[] | undefined {
  const visited = new Set([start]);
  const queue = [{ state: start, path: new Array<WalkStep>() }];
  for (const reached of queue) {
    for (const step of search.moves.get(reached.state) ?? []) {
      const path = [...reached.path, step];
      if (search.remaining.has(step.edgeId)) return path;
      if (visited.has(step.to)) continue;
      visited.add(step.to);
      queue.push({ state: step.to, path });
    }
  }
  return undefined;
}

function planWalk(start: string, search: Search): WalkStep[] {
  const walk: WalkStep[] = [];
  let current = start;
  let path = stepsToUncovered(current, search);
  while (path !== undefined) {
    for (const step of path) {
      walk.push(step);
      search.remaining.delete(step.edgeId);
      current = step.to;
    }
    path = stepsToUncovered(current, search);
  }
  return walk;
}

function initialState(graph: ActorGraph): string | undefined {
  for (const edge of graph.edges) {
    if (edge.source === INITIAL_NODE_ID) return edge.target;
  }
  return undefined;
}

/**
 * Walks from the initial state that together take every sendable edge at least
 * once. Events the machine raises itself are followed, not counted.
 */
export function coveringWalks(graph: ActorGraph): CoveringWalks {
  const remaining = new Set<string>();
  for (const edge of sendableEdges(graph)) remaining.add(edge.id);
  const walks: WalkStep[][] = [];
  const start = initialState(graph);
  if (start === undefined) return { walks, unreachable: [...remaining] };

  const search: Search = { moves: movesByState(graph), remaining };
  let walk = planWalk(start, search);
  while (walk.length > 0) {
    walks.push(walk);
    walk = planWalk(start, search);
  }
  return { walks, unreachable: [...remaining] };
}
