import type { ActorGraph } from "./types.ts";

type AdjacencyMap = Record<string, Array<{ target: string; label: string }>>;

function buildAdjacency(graph: ActorGraph): AdjacencyMap {
  const adj: AdjacencyMap = {};
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

type DfsWalkOptions = {
  onEnter?: (node: string, path: string[]) => boolean;
  onBackEdge?: (node: string, path: string[]) => void;
  backtrackVisited?: boolean;
};

function dfsWalk(adj: AdjacencyMap, startNodes: string[], options: DfsWalkOptions = {}): void {
  const visited: Record<string, boolean> = {};
  const inStack: Record<string, boolean> = {};
  const path: string[] = [];

  function dfs(node: string): void {
    if (inStack[node]) {
      options.onBackEdge?.(node, path);
      return;
    }
    if (visited[node]) return;
    visited[node] = true;
    inStack[node] = true;
    path.push(node);
    if (options.onEnter?.(node, path)) {
      path.pop();
      delete inStack[node];
      if (options.backtrackVisited) delete visited[node];
      return;
    }
    const neighbors = adj[node] || [];
    for (let i = 0; i < neighbors.length; i++) {
      dfs(neighbors[i].target);
    }
    path.pop();
    delete inStack[node];
    if (options.backtrackVisited) delete visited[node];
  }

  for (const start of startNodes) {
    dfs(start);
  }
}

function bfsWalk(
  adj: AdjacencyMap,
  start: string,
  visit: (node: string) => boolean,
): Record<string, boolean> {
  const visited: Record<string, boolean> = {};
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited[current]) continue;
    visited[current] = true;
    if (visit(current)) break;
    const neighbors = adj[current] || [];
    for (let i = 0; i < neighbors.length; i++) {
      const target = neighbors[i].target;
      if (!visited[target]) queue.push(target);
    }
  }
  return visited;
}

export function reachable(graph: ActorGraph, fromId: string, toId: string): boolean {
  const adj = buildAdjacency(graph);
  const visited = bfsWalk(adj, fromId, (node) => node === toId);
  return visited[toId] === true;
}

export function allPaths(graph: ActorGraph, fromId: string, toId: string): string[][] {
  const adj = buildAdjacency(graph);
  const results: string[][] = [];

  dfsWalk(adj, [fromId], {
    onEnter: (node, path) => {
      if (node === toId) {
        results.push(path.slice());
        return true;
      }
      return false;
    },
    backtrackVisited: true,
  });

  return results;
}

export function findCycles(graph: ActorGraph): string[][] {
  const adj = buildAdjacency(graph);
  const cycles: string[][] = [];

  dfsWalk(
    adj,
    graph.nodes.map((n) => n.id),
    {
      onBackEdge: (node, path) => {
        const cycleStart = path.indexOf(node);
        if (cycleStart !== -1) {
          cycles.push(path.slice(cycleStart).concat(node));
        }
      },
    },
  );

  return cycles;
}

export function unreachableNodes(graph: ActorGraph, fromId: string): string[] {
  const adj = buildAdjacency(graph);
  const visited = bfsWalk(adj, fromId, () => false);
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
