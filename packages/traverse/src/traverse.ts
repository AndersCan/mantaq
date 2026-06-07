import type { Graph, Path } from "./types.ts";

/** BFS shortest path from start to target. */
export function bfs(graph: Graph, start: string, target: string): Path | null {
  if (start === target) return { states: [start], events: [] };

  const visited = new Set<string>();
  const queue: Array<{ node: string; path: Path }> = [
    { node: start, path: { states: [start], events: [] } },
  ];
  visited.add(start);

  while (queue.length > 0) {
    const { node, path } = queue.shift()!;
    const edges = graph.edges.filter((e) => e.from === node && e.to !== "" && !e.isWildcard);

    for (const edge of edges) {
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);

      const newPath: Path = {
        states: [...path.states, edge.to],
        events: [...path.events, edge.eventId],
      };

      if (edge.to === target) return newPath;
      queue.push({ node: edge.to, path: newPath });
    }
  }

  return null;
}

/** DFS finding all paths from start to target with cycle detection. */
export function dfs(graph: Graph, start: string, target: string): Path[] {
  const results: Path[] = [];

  function walk(node: string, path: Path, visited: Set<string>): void {
    if (node === target) {
      results.push({ states: [...path.states], events: [...path.events] });
      return;
    }

    const edges = graph.edges.filter((e) => e.from === node && e.to !== "" && !e.isWildcard);

    for (const edge of edges) {
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      path.states.push(edge.to);
      path.events.push(edge.eventId);
      walk(edge.to, path, visited);
      path.states.pop();
      path.events.pop();
      visited.delete(edge.to);
    }
  }

  const visited = new Set<string>([start]);
  walk(start, { states: [start], events: [] }, visited);
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
  const results: Path[] = [];

  function walk(node: string, path: Path, visited: Set<string>, depth: number): void {
    if (node === to) {
      results.push({ states: [...path.states], events: [...path.events] });
      return;
    }

    if (maxDepth !== undefined && depth >= maxDepth) return;

    const edges = graph.edges.filter((e) => e.from === node && e.to !== "" && !e.isWildcard);

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

/** States not reachable from graph's initial state. */
export function unreachableStates(graph: Graph): string[] {
  const visited = new Set<string>();
  const queue = [graph.initial];
  visited.add(graph.initial);

  while (queue.length > 0) {
    const node = queue.shift()!;
    const edges = graph.edges.filter((e) => e.from === node && e.to !== "" && !e.isWildcard);

    for (const edge of edges) {
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      queue.push(edge.to);
    }
  }

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
  return graph.edges
    .filter((e) => e.from === stateName && e.to !== "" && !e.isWildcard)
    .map((e) => e.to);
}

/** Events available from a given state. */
export function eventsFrom(graph: Graph, stateName: string): string[] {
  return [
    ...new Set(
      graph.edges
        .filter((e) => e.from === stateName && e.to !== "" && !e.isWildcard)
        .map((e) => e.eventId),
    ),
  ];
}
