/**
 * layout — deterministic flat dagre layout over a VizGraph.
 *
 * Determinism contract:
 * - constant node sizes (no DOM reads),
 * - nodes and edges inserted in sorted-id order (dagre output depends on
 *   insertion order — unsorted = unstable layout),
 * - sync, one call, no `Math.random`, no wall clock.
 *
 * Cycles are handled internally by dagre's greedy acyclicer — no hand-rolled
 * topological sort, so the v1 infinite-loop bug class is structurally
 * impossible. Sanity invariants (finite positions, no overlap, in-bounds,
 * valid edge endpoints) are property-tested in Phase 1.
 */

import { Graph, layout } from "@dagrejs/dagre";
import type { VizGraph } from "./graph-model.ts";
import { Either } from "@mantaq/utils";

export type LayoutDirection = "LR" | "TB";

/** Fixed node width used by default layouts — adapter must match (no overlap). */
export const DEFAULT_NODE_WIDTH = 180;
/** Fixed node height used by default layouts — adapter must match. */
export const DEFAULT_NODE_HEIGHT = 48;

export interface LayoutOptions {
  /** Rank direction. Default `LR`. */
  direction?: LayoutDirection;
  /** Fixed node width in px. Default 180. */
  nodeWidth?: number;
  /** Fixed node height in px. Default 48. */
  nodeHeight?: number;
  /** Horizontal gap between nodes in px. Default 40. */
  nodeSep?: number;
  /** Rank gap in px. Default 60. */
  rankSep?: number;
  /** Graph margin in px. Default 24. */
  margin?: number;
}

export interface VizPosition {
  x: number;
  y: number;
}

export type LayoutResult =
  | {
      status: "ok";
      /** Node center positions, keyed by node id. */
      positions: Map<string, VizPosition>;
      width: number;
      height: number;
      direction: LayoutDirection;
    }
  | { status: "error"; reason: "no-nodes" | "layout-failed"; message: string };

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Sorted unique `(source, target)` pairs keep dagre insertion order stable. */
function sortedEdgePairs(graph: VizGraph): Array<[string, string]> {
  const pairs = new Set<string>();
  for (const edge of graph.edges) {
    pairs.add(`${edge.source}\u0000${edge.target}`);
  }
  return [...pairs].sort().map((pair) => pair.split("\u0000") as [string, string]);
}

export function layoutGraph(graph: VizGraph, options: LayoutOptions = {}): LayoutResult {
  const {
    direction = "LR",
    nodeWidth = DEFAULT_NODE_WIDTH,
    nodeHeight = DEFAULT_NODE_HEIGHT,
    nodeSep = 40,
    rankSep = 60,
    margin = 24,
  } = options;

  if (graph.nodes.length === 0) {
    return { status: "error", reason: "no-nodes", message: "cannot lay out an empty graph" };
  }

  return Either.match(
    Either.from((): LayoutResult => {
      const g = new Graph();
      g.setGraph({
        rankdir: direction,
        nodesep: nodeSep,
        ranksep: rankSep,
        marginx: margin,
        marginy: margin,
      });
      g.setDefaultEdgeLabel(() => ({}));

      const nodeIds = graph.nodes.map((n) => n.id).sort();
      for (const id of nodeIds) {
        g.setNode(id, { width: nodeWidth, height: nodeHeight });
      }
      for (const [source, target] of sortedEdgePairs(graph)) {
        g.setEdge(source, target);
      }

      layout(g);

      const positions = new Map<string, VizPosition>();
      for (const id of nodeIds) {
        const n = g.node(id);
        positions.set(id, { x: n.x, y: n.y });
      }
      const size = g.graph();
      return {
        status: "ok" as const,
        positions,
        width: size.width ?? 0,
        height: size.height ?? 0,
        direction,
      };
    }),
    (error) => ({
      status: "error",
      reason: "layout-failed",
      message: toMessage(error),
    }),
    (result) => result,
  );
}
