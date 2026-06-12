import type { AnyActor } from "@mantaq/core";
import {
  buildGraph as buildGraphBase,
  collectActiveStates,
  INITIAL_NODE_ID,
} from "@mantaq/traversal";
import type {
  GraphNode as BaseGraphNode,
  GraphEdge as BaseGraphEdge,
  ActorGraph,
} from "@mantaq/traversal";

export { INITIAL_NODE_ID, collectActiveStates };
export type { ActorGraph };

export interface TransitionPayload {
  guard?: string;
  action?: string;
  meta?: Record<string, unknown>;
}

export interface GraphNode extends BaseGraphNode {}

export interface GraphEdge extends BaseGraphEdge {
  effectLabel?: string;
  timerMs?: number;
  payload?: TransitionPayload;
}

function buildEffectEdges(
  activeSet: Set<string>,
  pendingTimers?: Array<{ id: number; ms: number }>,
  effects?: Record<string, unknown[]>,
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  if (!pendingTimers || pendingTimers.length === 0) return edges;

  const effectStates = new Set<string>();
  if (effects) {
    for (const [stateName, fns] of Object.entries(effects)) {
      if (Array.isArray(fns) && fns.length > 0) {
        effectStates.add(stateName);
      }
    }
  }

  for (const activeId of activeSet) {
    const stateName = activeId.split(".").pop() ?? "";
    if (!effectStates.has(stateName)) continue;

    const displayName = stateName.charAt(0).toUpperCase() + stateName.slice(1);

    for (const timer of pendingTimers) {
      edges.push({
        id: `${activeId}-effect-${timer.id}`,
        source: activeId,
        target: activeId,
        label: `EFFECT_${timer.id}`,
        isActive: true,
        isInternal: true,
        effectLabel: `${displayName} Effect ${timer.id}`,
        timerMs: timer.ms,
      });
    }
  }

  return edges;
}

export function buildGraph(actor: AnyActor, internalIds?: Set<string>): ActorGraph {
  if (!actor) {
    return { nodes: [], edges: [] };
  }
  try {
    const base = buildGraphBase(actor, { internalIds });

    let pendingTimers: Array<{ id: number; ms: number }> | undefined;
    const clock = actor.clock as {
      pendingTimers?: () => Array<{ id: number; deadline: number; ms: number }>;
    };
    if (typeof clock.pendingTimers === "function") {
      pendingTimers = clock.pendingTimers().map((t) => ({ id: t.id, ms: t.ms }));
    }

    const effects = (actor.options as Record<string, unknown> | undefined)?.effects as
      | Record<string, unknown[]>
      | undefined;

    const activeSet = new Set<string>();
    for (const n of base.nodes) {
      if (n.isActive) activeSet.add(n.id);
    }

    const effectEdges = buildEffectEdges(activeSet, pendingTimers, effects);

    const filteredEdges = base.edges.filter(
      (e) => !(e.isInternal && e.source === e.target && e.label.startsWith("effect:")),
    );

    return {
      nodes: base.nodes,
      edges: [...filteredEdges, ...effectEdges] as GraphEdge[],
    };
  } catch (e) {
    console.error("[mantaq/viz] buildGraph failed:", e);
    return { nodes: [], edges: [] };
  }
}
