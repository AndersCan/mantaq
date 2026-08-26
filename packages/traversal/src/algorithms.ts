import type { ActorGraph } from "./types.ts";

type AdjacencyMap = Record<string, Array<{ target: string; label: string }>>;

function buildAdjacency(graph: ActorGraph): AdjacencyMap {
  const adjacency: AdjacencyMap = {};
  for (const node of graph.nodes) {
    adjacency[node.id] = [];
  }
  for (const edge of graph.edges) {
    if (adjacency[edge.source]) {
      adjacency[edge.source].push({ target: edge.target, label: edge.label });
    }
  }
  return adjacency;
}

function bfsWalk(
  adjacency: AdjacencyMap,
  walk: { start: string; visit: (nodeId: string) => boolean },
): Record<string, boolean> {
  const visited: Record<string, boolean> = {};
  const queue = [walk.start];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || visited[current]) continue;
    visited[current] = true;
    if (walk.visit(current)) break;
    for (const neighbor of adjacency[current] ?? []) {
      if (!visited[neighbor.target]) queue.push(neighbor.target);
    }
  }
  return visited;
}

export function reachable(graph: ActorGraph, endpoints: { fromId: string; toId: string }): boolean {
  const adjacency = buildAdjacency(graph);
  const visited = bfsWalk(adjacency, {
    start: endpoints.fromId,
    visit: (nodeId) => nodeId === endpoints.toId,
  });
  return visited[endpoints.toId] === true;
}

export function allPaths(
  graph: ActorGraph,
  endpoints: { fromId: string; toId: string },
): string[][] {
  const adjacency = buildAdjacency(graph);
  const results: string[][] = [];
  const visited: Record<string, boolean> = {};

  function dfs(cursor: { nodeId: string; path: string[] }): void {
    if (cursor.nodeId === endpoints.toId) {
      results.push(cursor.path.slice());
      return;
    }
    if (visited[cursor.nodeId]) return;
    visited[cursor.nodeId] = true;
    for (const neighbor of adjacency[cursor.nodeId] ?? []) {
      cursor.path.push(neighbor.target);
      dfs({ nodeId: neighbor.target, path: cursor.path });
      cursor.path.pop();
    }
    delete visited[cursor.nodeId];
  }

  dfs({ nodeId: endpoints.fromId, path: [endpoints.fromId] });
  return results;
}

export function findCycles(graph: ActorGraph): string[][] {
  const adjacency = buildAdjacency(graph);
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const visited: Record<string, boolean> = {};
  const inStack: Record<string, boolean> = {};
  const path: string[] = [];

  /**
   * A cycle ends with its start node (e.g. the list a, b, a). The body is
   * every element but the last. Rotate the body so it starts at the
   * lexicographically smallest id, giving every rotation of a cycle the same
   * canonical key.
   */
  function rotateToMin(cycleNodes: string[]): string {
    const body = cycleNodes.slice(0, -1);
    let minIndex = 0;
    let minValue = body[0] ?? "";
    for (const [index, candidate] of body.entries()) {
      if (candidate < minValue) {
        minValue = candidate;
        minIndex = index;
      }
    }
    return body.slice(minIndex).concat(body.slice(0, minIndex)).join(":");
  }

  function dfs(nodeId: string): void {
    if (inStack[nodeId]) {
      const cycleStart = path.indexOf(nodeId);
      if (cycleStart !== -1) {
        const cycle = path.slice(cycleStart).concat(nodeId);
        const key = rotateToMin(cycle);
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cycle);
        }
      }
      return;
    }
    if (visited[nodeId]) return;
    visited[nodeId] = true;
    inStack[nodeId] = true;
    path.push(nodeId);
    for (const neighbor of adjacency[nodeId] ?? []) {
      dfs(neighbor.target);
    }
    path.pop();
    delete inStack[nodeId];
    delete visited[nodeId];
  }

  for (const node of graph.nodes) {
    dfs(node.id);
  }
  return cycles;
}

export function unreachableNodes(graph: ActorGraph, options: { fromId: string }): string[] {
  const adjacency = buildAdjacency(graph);
  const visited = bfsWalk(adjacency, { start: options.fromId, visit: () => false });
  const result: string[] = [];
  for (const node of graph.nodes) {
    if (!visited[node.id]) result.push(node.id);
  }
  return result;
}

export function shortestPath(
  graph: ActorGraph,
  endpoints: { fromId: string; toId: string },
): string[] | undefined {
  const adjacency = buildAdjacency(graph);
  const visited: Record<string, boolean> = {};
  const queue: Array<{ node: string; path: string[] }> = [
    { node: endpoints.fromId, path: [endpoints.fromId] },
  ];
  while (queue.length > 0) {
    const candidate = queue.shift();
    if (candidate === undefined) break;
    if (candidate.node === endpoints.toId) return candidate.path;
    if (visited[candidate.node]) continue;
    visited[candidate.node] = true;
    for (const neighbor of adjacency[candidate.node] ?? []) {
      if (!visited[neighbor.target]) {
        queue.push({ node: neighbor.target, path: candidate.path.concat(neighbor.target) });
      }
    }
  }
  return undefined;
}
