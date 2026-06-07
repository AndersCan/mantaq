import type { Graph, GraphEdge, Path } from "./types.ts";

export function isValidEdge(e: { to: string; isWildcard: boolean }): boolean {
  return e.to !== "" && !e.isWildcard;
}

function outgoingEdges(graph: Graph, nodeId: string): GraphEdge[] {
  return graph.edges.filter((e) => e.from === nodeId && isValidEdge(e));
}

/** BFS shortest path from start to target. */
export function bfs(graph: Graph, from: string, to: string): Path | null {
  if (from === to) return { states: [from], events: [] };

  const visited = new Set<string>();
  const queue: Array<{ node: string; path: Path }> = [
    { node: from, path: { states: [from], events: [] } },
  ];
  visited.add(from);
  let index = 0;

  while (index < queue.length) {
    const { node, path } = queue[index++];
    const edges = outgoingEdges(graph, node);

    for (const edge of edges) {
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);

      const newPath: Path = {
        states: [...path.states, edge.to],
        events: [...path.events, edge.eventId],
      };

      if (edge.to === to) return newPath;
      queue.push({ node: edge.to, path: newPath });
    }
  }

  return null;
}

/** DFS finding all paths from start to target with optional depth limit. */
export function dfs(graph: Graph, from: string, to: string, maxDepth?: number): Path[] {
  const results: Path[] = [];

  function walk(node: string, path: Path, visited: Set<string>, depth: number): void {
    if (node === to) {
      results.push({ states: [...path.states], events: [...path.events] });
      return;
    }

    if (maxDepth !== undefined && depth >= maxDepth) return;

    const edges = outgoingEdges(graph, node);

    for (const edge of edges) {
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      path.states.push(edge.to);
      path.events.push(edge.eventId);
      walk(edge.to, path, visited, depth + 1);
      path.states.pop();
      path.events.pop();
      visited.delete(edge.to);
    }
  }

  const visited = new Set<string>([from]);
  walk(from, { states: [from], events: [] }, visited, 0);
  return results;
}

/** Check if target is reachable from source. */
export function reachable(graph: Graph, from: string, to: string): boolean {
  return bfs(graph, from, to) !== null;
}

/** Alias for BFS. */
export function shortestPath(graph: Graph, from: string, to: string): Path | null {
  return bfs(graph, from, to);
}

/** Find all paths with optional depth limit. */
export function allPaths(graph: Graph, from: string, to: string, maxDepth?: number): Path[] {
  return dfs(graph, from, to, maxDepth);
}

function reachableNodes(graph: Graph, from: string): Set<string> {
  const visited = new Set<string>();
  const queue = [from];
  visited.add(from);
  let index = 0;

  while (index < queue.length) {
    const node = queue[index++];
    const edges = outgoingEdges(graph, node);

    for (const edge of edges) {
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      queue.push(edge.to);
    }
  }

  return visited;
}

/** States not reachable from graph's initial state. */
export function unreachableStates(graph: Graph): string[] {
  const visited = reachableNodes(graph, graph.initial);
  return [...graph.nodes.keys()].filter((id) => !visited.has(id));
}

/** States with no outgoing edges that aren't final. */
export function deadEndStates(graph: Graph): string[] {
  return [...graph.nodes.values()]
    .filter((node) => {
      if (node.isFinal) return false;
      return !graph.edges.some((e) => e.from === node.id && !e.isWildcard);
    })
    .map((node) => node.id);
}

/** Direct successor states from a given state. */
export function statesFrom(graph: Graph, stateName: string): string[] {
  return outgoingEdges(graph, stateName).map((e) => e.to);
}

/** Events available from a given state. */
export function eventsFrom(graph: Graph, stateName: string): string[] {
  return [...new Set(outgoingEdges(graph, stateName).map((e) => e.eventId))];
}
