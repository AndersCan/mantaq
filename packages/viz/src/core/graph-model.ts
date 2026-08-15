/**
 * graph-model — normalized, render-ready graph derived from
 * `@mantaq/traversal`'s `ActorGraph` + the live actor.
 *
 * The graph is a function of live state: `buildGraph` executes handlers with
 * the live actor, so the caller must rebuild when the active path changes
 * (edges that resolve differently are true *right now*; undetermined edges
 * are sample-time facts, never silently wrong).
 *
 * Sanctioned untrusted-value boundary: a throwing `buildGraph` (it rethrows
 * handler errors) becomes a typed `VizResult` error the UI renders.
 */

import type { AnyActor, Snapshot } from "@mantaq/core";
import { buildGraph, INITIAL_NODE_ID } from "@mantaq/traversal";
import type { ActorGraph, GraphEdge, GraphNode } from "@mantaq/traversal";
import { Either } from "@mantaq/utils";

export type VizNodeKind = "state" | "initial" | "region-group";

/** Effect badge attached to a state node. */
export interface VizEffect {
  /** `effect:<stateName>` — matches the traversal self-loop label. */
  label: string;
  /** Number of effect functions on that state. */
  count: number;
}

export interface VizNode {
  /** Traversal dot-path, as-is (e.g. `connected.health.healthy`). */
  id: string;
  label: string;
  kind: VizNodeKind;
  isActive: boolean;
  isFinal: boolean;
  isInitial: boolean;
  /** Effect badges, deduped by `effect:<state>` label. */
  effects: VizEffect[];
  /** Top-level region prefix, `""` for the root. */
  groupId: string;
  /** Dot-path of the containing region, `""` for the root. */
  parentPath: string;
  /** Payload of the active state this node represents (from the live snapshot). */
  payload?: unknown;
}

export type VizEdgeKind = "transition" | "effect" | "undetermined" | "initial";

export interface VizEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  kind: VizEdgeKind;
  isActive: boolean;
  isInternal: boolean;
  /** Named sample contexts the edge was observed under. */
  contexts?: string[];
  /** `emit(...)` action annotation from the transition handler. */
  action?: string;
}

/** Region container. Root group id is `""`. */
export interface VizGroup {
  /** Region dot-path (`network`, `outer.inner`), `""` for root. */
  id: string;
  label: string;
  parentPath: string;
}

export interface VizGraph {
  nodes: VizNode[];
  edges: VizEdge[];
  groups: VizGroup[];
}

export type VizErrorReason = "missing-actor" | "handler-threw" | "empty-graph";

export type VizResult =
  | { status: "ok"; graph: VizGraph }
  | { status: "error"; reason: VizErrorReason; message: string };

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function groupOf(id: string): string {
  const dot = id.indexOf(".");
  return dot === -1 ? "" : id.slice(0, dot);
}

function parentOf(id: string): string {
  const dot = id.lastIndexOf(".");
  return dot === -1 ? "" : id.slice(0, dot);
}

/** Walk the snapshot tree collecting each state's payload, keyed by node id. */
function collectPayloads(snapshot: Snapshot): Map<string, unknown> {
  const map = new Map<string, unknown>();
  const walk = (snap: Snapshot, prefix: string): void => {
    const name = snap.path[snap.path.length - 1];
    if (name) map.set(prefix ? `${prefix}.${name}` : name, snap.payload);
    for (const [regionName, regionSnap] of Object.entries(snap.regions)) {
      walk(regionSnap, prefix ? `${prefix}.${regionName}` : regionName);
    }
  };
  walk(snapshot, "");
  return map;
}

/**
 * Walk `actor.regions` recursively counting effect functions per state.
 * Traversal emits one `effect:<state>` self-loop per state-with-effects per
 * actor; root `options.effects` does not cover region children, so counts
 * come from this recursive walk. Attribution is by node id (dot-prefixed for
 * region children); label collisions between same-named states in different
 * regions are harmless.
 */
function collectEffectCounts(actor: AnyActor): Map<string, VizEffect[]> {
  const map = new Map<string, VizEffect[]>();
  const walk = (a: AnyActor, prefix: string): void => {
    const effects = a.options?.effects;
    if (effects) {
      for (const [stateName, fns] of Object.entries(effects)) {
        if (!Array.isArray(fns) || fns.length === 0) continue;
        const id = prefix ? `${prefix}.${stateName}` : stateName;
        map.set(id, [{ label: `effect:${stateName}`, count: fns.length }]);
      }
    }
    for (const [regionName, child] of Object.entries(a.regions)) {
      walk(child, prefix ? `${prefix}.${regionName}` : regionName);
    }
  };
  walk(actor, "");
  return map;
}

/** Recursively collect region groups (`outer.inner` dot-paths). Root is `""`. */
function collectGroups(actor: AnyActor): VizGroup[] {
  const groups: VizGroup[] = [{ id: "", label: "", parentPath: "" }];
  const walk = (a: AnyActor, prefix: string): void => {
    for (const [regionName, child] of Object.entries(a.regions)) {
      const id = prefix ? `${prefix}.${regionName}` : regionName;
      groups.push({ id, label: regionName, parentPath: prefix });
      walk(child, id);
    }
  };
  walk(actor, "");
  return groups;
}

function toVizNode(
  node: GraphNode,
  effects: Map<string, VizEffect[]>,
  payloads: Map<string, unknown>,
): VizNode {
  const isInitial = node.isInitial ?? false;
  return {
    id: node.id,
    label: node.label,
    kind: isInitial ? "initial" : "state",
    isActive: node.isActive,
    isFinal: node.isFinal,
    isInitial,
    effects: effects.get(node.id) ?? [],
    groupId: groupOf(node.id),
    parentPath: parentOf(node.id),
    payload: payloads.get(node.id),
  };
}

/**
 * Normalize traversal edges into VizEdges:
 * - effect self-loops become `effect` kind (badges, not rendered edges),
 * - initial-edge from the synthetic initial node becomes `initial`,
 * - undetermined edges get `target = source` — a guard-rejected transition
 *   stays in its state. No synthetic target nodes ever exist. The flag is
 *   preserved so a genuine self-loop (`{state: same}`) and a guard-reject
 *   (`{}`) stay distinguishable.
 */
function toVizEdge(edge: GraphEdge): VizEdge {
  const isEffect = edge.isInternal === true && edge.label.startsWith("effect:");
  const kind: VizEdgeKind = isEffect
    ? "effect"
    : edge.source === INITIAL_NODE_ID
      ? "initial"
      : edge.isUndetermined === true
        ? "undetermined"
        : "transition";
  return {
    id: edge.id,
    source: edge.source,
    target: edge.isUndetermined === true ? edge.source : edge.target,
    label: edge.label,
    kind,
    isActive: edge.isActive,
    isInternal: edge.isInternal ?? false,
    contexts: edge.contexts,
    action: edge.payload?.action,
  };
}

function normalizeGraph(actor: AnyActor, graph: ActorGraph): VizResult {
  const effectCounts = collectEffectCounts(actor);
  const payloads = collectPayloads(actor.snapshot());
  const nodes = graph.nodes.map((n) => toVizNode(n, effectCounts, payloads));
  if (nodes.length === 0) {
    return {
      status: "error",
      reason: "empty-graph",
      message: "actor exposes no states",
    };
  }
  return {
    status: "ok",
    graph: {
      nodes,
      edges: graph.edges.map(toVizEdge),
      groups: collectGroups(actor),
    },
  };
}

/**
 * Build the render-ready VizGraph from a live actor. Never returns an empty
 * graph silently: a missing actor, a throwing `buildGraph` (handler errors
 * rethrow), or a state-less actor all become typed errors the UI renders.
 */
export function buildVizGraph(actor: AnyActor | undefined): VizResult {
  if (!actor) {
    return { status: "error", reason: "missing-actor", message: "actor is null or undefined" };
  }
  return Either.match(
    Either.from(() => buildGraph(actor)),
    (error) => ({
      status: "error",
      reason: "handler-threw",
      message: toMessage(error),
    }),
    (graph) => normalizeGraph(actor, graph),
  );
}
