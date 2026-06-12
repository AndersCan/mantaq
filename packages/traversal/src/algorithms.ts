import type { ActorGraph } from "./types.ts";

function buildAdjacency(
  graph: ActorGraph,
): Record<string, Array<{ target: string; label: string }>> {
  const adj: Record<string, Array<{ target: string; label: string }>> = {};
  for (const node of graph.nodes) {
    adj[node.id] = [];
  }
  for (const edge of graph.edges) {
    if (adj[edge.source]) {
      adj[edge.source].push({ target: edge.target, label: edge.label });
    }
  }
  return adj;
}

export function reachable(graph: ActorGraph, fromId: string, toId: string): boolean {
  const adj = buildAdjacency(graph);
  const visited: Record<string, boolean> = {};
  const queue = [fromId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === toId) return true;
    if (visited[current]) continue;
    visited[current] = true;
    const neighbors = adj[current] || [];
    for (let i = 0; i < neighbors.length; i++) {
      const target = neighbors[i].target;
      if (!visited[target]) queue.push(target);
    }
  }
  return false;
}

export function allPaths(graph: ActorGraph, fromId: string, toId: string): string[][] {
  const adj = buildAdjacency(graph);
  const results: string[][] = [];
  const visited: Record<string, boolean> = {};

  function dfs(current: string, path: string[]): void {
    if (current === toId) {
      results.push(path.slice());
      return;
    }
    if (visited[current]) return;
    visited[current] = true;
    const neighbors = adj[current] || [];
    for (let i = 0; i < neighbors.length; i++) {
      path.push(neighbors[i].target);
      dfs(neighbors[i].target, path);
      path.pop();
    }
    delete visited[current];
  }

  dfs(fromId, [fromId]);
  return results;
}

export function findCycles(graph: ActorGraph): string[][] {
  const adj = buildAdjacency(graph);
  const cycles: string[][] = [];
  const visited: Record<string, boolean> = {};
  const inStack: Record<string, boolean> = {};
  const path: string[] = [];

  function dfs(node: string): void {
    if (inStack[node]) {
      const cycleStart = path.indexOf(node);
      if (cycleStart !== -1) {
        cycles.push(path.slice(cycleStart).concat(node));
      }
      return;
    }
    if (visited[node]) return;
    visited[node] = true;
    inStack[node] = true;
    path.push(node);
    const neighbors = adj[node] || [];
    for (let i = 0; i < neighbors.length; i++) {
      dfs(neighbors[i].target);
    }
    path.pop();
    delete inStack[node];
  }

  for (const node of graph.nodes) {
    dfs(node.id);
  }
  return cycles;
}

export function unreachableNodes(graph: ActorGraph, fromId: string): string[] {
  const adj = buildAdjacency(graph);
  const visited: Record<string, boolean> = {};
  const queue = [fromId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited[current]) continue;
    visited[current] = true;
    const neighbors = adj[current] || [];
    for (let i = 0; i < neighbors.length; i++) {
      const target = neighbors[i].target;
      if (!visited[target]) queue.push(target);
    }
  }
  const result: string[] = [];
  for (const node of graph.nodes) {
    if (!visited[node.id]) result.push(node.id);
  }
  return result;
}

export function shortestPath(graph: ActorGraph, fromId: string, toId: string): string[] | null {
  const adj = buildAdjacency(graph);
  const visited: Record<string, boolean> = {};
  const queue: Array<{ node: string; path: string[] }> = [{ node: fromId, path: [fromId] }];
  while (queue.length > 0) {
    const { node: current, path } = queue.shift()!;
    if (current === toId) return path;
    if (visited[current]) continue;
    visited[current] = true;
    const neighbors = adj[current] || [];
    for (let i = 0; i < neighbors.length; i++) {
      const target = neighbors[i].target;
      if (!visited[target]) {
        queue.push({ node: target, path: path.concat(target) });
      }
    }
  }
  return null;
}
