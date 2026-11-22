import type { ActorGraph, GraphEdge, GraphNode } from "../types.ts";
import { INITIAL_NODE_ID, isAnyNode } from "../graph-ids.ts";

/** One event sent during a walk: the state it is sent in and the state its edge leads to. */
export interface WalkStep {
  edgeId: string;
  from: string;
  event: string;
  to: string;
}

export interface CoveringWalks {
  /** Each walk starts from a fresh actor; together they take every reachable sendable edge. */
  walks: WalkStep[][];
  /** Ids of sendable edges no walk can take from the initial state. */
  unreachable: string[];
}

/** The edges an outside sender can take: root-level, with a declared target, not internal. */
export function sendableEdges(graph: ActorGraph): GraphEdge[] {
  const sendable: GraphEdge[] = [];
  for (const edge of graph.edges) {
    const isRootLevel = edge.source !== INITIAL_NODE_ID && !edge.source.includes(".");
    const isOutsideSend = edge.isInternal !== true && edge.isUndetermined !== true;
    if (isRootLevel && isOutsideSend) sendable.push(edge);
  }
  return sendable;
}

interface StateMovesOptions {
  sendable: GraphEdge[];
}

/** A state's own edges first, then the any-state edges for events it has no handler for. */
function stateMoves(node: GraphNode, options: StateMovesOptions): WalkStep[] {
  const moves: WalkStep[] = [];
  const handled = new Set<string>();
  for (const edge of options.sendable) {
    if (edge.source !== node.id) continue;
    handled.add(edge.label);
    moves.push({ edgeId: edge.id, from: node.id, event: edge.label, to: edge.target });
  }
  if (node.isFinal) return moves;
  for (const edge of options.sendable) {
    const isUnhandledAny = isAnyNode(edge.source) && !handled.has(edge.label);
    if (!isUnhandledAny) continue;
    const target = isAnyNode(edge.target) ? node.id : edge.target;
    moves.push({ edgeId: edge.id, from: node.id, event: edge.label, to: target });
  }
  return moves;
}

function movesByState(graph: ActorGraph): Map<string, WalkStep[]> {
  const sendable = sendableEdges(graph);
  const moves = new Map<string, WalkStep[]>();
  for (const node of graph.nodes) {
    const isMarker = node.isInitial === true || node.isAny === true;
    if (isMarker || node.id.includes(".")) continue;
    moves.set(node.id, stateMoves(node, { sendable }));
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

/** Walks from the initial state that together take every sendable edge at least once. */
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
