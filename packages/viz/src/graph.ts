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
  isEffectTriggered?: boolean;
  payload?: TransitionPayload;
}

export function buildGraph(
  actor: AnyActor,
  internalIds?: Set<string>,
  sampleContexts?: Record<string, Record<string, unknown>>,
): ActorGraph {
  if (!actor) {
    return { nodes: [], edges: [] };
  }
  try {
    const base = buildGraphBase(actor, { internalIds, sampleContexts });

    const pendingTimers = (
      actor.clock as {
        pendingTimers?: () => Array<{
          id: number;
          deadline: number;
          ms: number;
          eventName?: string;
        }>;
      }
    ).pendingTimers?.();

    const effectTriggered = new Set<string>();
    if (pendingTimers) {
      for (const n of base.nodes) {
        if (!n.isActive) continue;
        for (const t of pendingTimers) {
          if (t.eventName) effectTriggered.add(`${n.id}.${t.eventName}`);
        }
      }
    }

    const filteredEdges = base.edges
      .filter((e) => !(e.isInternal && e.source === e.target && e.label.startsWith("effect:")))
      .map((e) => {
        if (effectTriggered.has(`${e.source}.${e.label}`)) {
          return { ...e, isEffectTriggered: true };
        }
        return e;
      });

    return {
      nodes: base.nodes,
      edges: filteredEdges as GraphEdge[],
    };
  } catch (e) {
    console.error("[mantaq/viz] buildGraph failed:", e);
    return { nodes: [], edges: [] };
  }
}
