import type { GraphNode, GraphEdge } from "./graph.ts";

export interface LayoutOptions {
  direction?: "TB" | "LR";
  nodeWidth?: number;
  nodeHeight?: number;
  horizontalSpacing?: number;
  verticalSpacing?: number;
}

function resolveOptions(opts?: LayoutOptions): Required<LayoutOptions> {
  return {
    direction: opts?.direction ?? "TB",
    nodeWidth: opts?.nodeWidth ?? 160,
    nodeHeight: opts?.nodeHeight ?? 60,
    horizontalSpacing: opts?.horizontalSpacing ?? 220,
    verticalSpacing: opts?.verticalSpacing ?? 120,
  };
}

export function computeNodePositions(
  nodes: GraphNode[],
  edges: GraphEdge[],
  opts?: LayoutOptions,
): Map<string, { x: number; y: number }> {
  const options = resolveOptions(opts);
  const positions = new Map<string, { x: number; y: number }>();

  if (nodes.length === 0) return positions;

  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const n of nodes) {
    adjacency.set(n.id, []);
    if (!inDegree.has(n.id)) inDegree.set(n.id, 0);
  }

  for (const e of edges) {
    const children = adjacency.get(e.source);
    if (children) {
      children.push(e.target);
    }
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }

  const levels = new Map<string, number>();
  const queue: string[] = [];

  for (const [id, deg] of inDegree) {
    if (deg === 0) {
      levels.set(id, 0);
      queue.push(id);
    }
  }

  if (queue.length === 0) {
    for (const [id] of inDegree) {
      levels.set(id, 0);
      queue.push(id);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLevel = levels.get(current)!;
    const children = adjacency.get(current) ?? [];
    for (const child of children) {
      const nextLevel = currentLevel + 1;
      if (!levels.has(child) || levels.get(child)! < nextLevel) {
        levels.set(child, nextLevel);
        queue.push(child);
      }
    }
  }

  for (const n of nodes) {
    if (!levels.has(n.id)) {
      levels.set(n.id, 0);
    }
  }

  const levelBuckets = new Map<number, string[]>();
  for (const n of nodes) {
    const level = levels.get(n.id)!;
    if (!levelBuckets.has(level)) levelBuckets.set(level, []);
    levelBuckets.get(level)!.push(n.id);
  }

  const isTB = options.direction === "TB";
  const { horizontalSpacing, verticalSpacing } = options;

  for (const [level, ids] of levelBuckets) {
    ids.forEach((id, index) => {
      const x = isTB ? index * horizontalSpacing : level * horizontalSpacing;
      const y = isTB ? level * verticalSpacing : index * verticalSpacing;
      positions.set(id, { x, y });
    });
  }

  return positions;
}
