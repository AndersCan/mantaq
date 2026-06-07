import type { Graph, Path, CoverageReport } from "./types.ts";

/**
 * Enumerate paths from initial to all reachable final states.
 * DFS with backtracking and cycle detection.
 */
export function explore(graph: Graph, options?: { maxDepth?: number; maxPaths?: number }): Path[] {
  const maxDepth = options?.maxDepth ?? 50;
  const maxPaths = options?.maxPaths ?? 1000;
  const results: Path[] = [];

  function walk(node: string, path: Path, visited: Set<string>): void {
    if (results.length >= maxPaths) return;

    const nodeData = graph.nodes.get(node);
    if (nodeData?.isFinal) {
      results.push({ states: [...path.states], events: [...path.events] });
      return;
    }

    if (path.states.length - 1 >= maxDepth) return;

    const edges = graph.edges.filter((e) => e.from === node && e.to !== "" && !e.isWildcard);

    if (edges.length === 0) {
      results.push({ states: [...path.states], events: [...path.events] });
      return;
    }

    for (const edge of edges) {
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      path.states.push(edge.to);
      path.events.push(edge.eventId);
      walk(edge.to, path, visited);
      path.states.pop();
      path.events.pop();
      visited.delete(edge.to);
      if (results.length >= maxPaths) return;
    }
  }

  const visited = new Set<string>([graph.initial]);
  walk(graph.initial, { states: [graph.initial], events: [] }, visited);
  return results;
}

/**
 * Generate minimal test sequences covering all states.
 * Greedy set-cover: keep adding paths that visit new states.
 */
export function testSequences(graph: Graph, options?: { maxDepth?: number }): Path[] {
  const paths = explore(graph, { maxDepth: options?.maxDepth });
  const covered = new Set<string>();
  const selected: Path[] = [];

  const sorted = [...paths].sort((a, b) => a.states.length - b.states.length);

  const allStates = new Set(graph.nodes.keys());

  while (covered.size < allStates.size) {
    let bestPath: Path | null = null;
    let bestNewCount = 0;

    for (const path of sorted) {
      if (selected.includes(path)) continue;
      const newStates = path.states.filter((s) => !covered.has(s));
      if (newStates.length > bestNewCount) {
        bestNewCount = newStates.length;
        bestPath = path;
      }
    }

    if (bestPath === null || bestNewCount === 0) break;

    selected.push(bestPath);
    for (const s of bestPath.states) covered.add(s);
  }

  return selected;
}

/** Calculate state and edge coverage percentages. */
export function coverageReport(
  graph: Graph,
  visitedStates: string[],
  visitedEdges: string[],
): CoverageReport {
  const statesTotal = new Set(graph.nodes.keys());
  const edgesTotal = new Set(graph.edges.map((e) => e.id));

  const statesVisited = new Set(visitedStates);
  const edgesVisited = new Set(visitedEdges);

  const unreachable: string[] = [];
  for (const id of statesTotal) {
    if (!statesVisited.has(id)) unreachable.push(id);
  }

  const deadEnds: string[] = [];
  for (const [id, node] of graph.nodes) {
    if (node.isFinal) continue;
    const hasOutgoing = graph.edges.some((e) => e.from === id && !e.isWildcard);
    if (!hasOutgoing && statesVisited.has(id)) deadEnds.push(id);
  }

  return {
    statesVisited,
    statesTotal,
    edgesVisited,
    edgesTotal,
    stateCoverage: statesTotal.size > 0 ? statesVisited.size / statesTotal.size : 0,
    edgeCoverage: edgesTotal.size > 0 ? edgesVisited.size / edgesTotal.size : 0,
    unreachableStates: unreachable,
    deadEndStates: deadEnds,
  };
}
