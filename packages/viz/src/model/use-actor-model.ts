/**
 * use-actor-model — ActorModel, VizError normalization, rebuild-on-path-change
 * (plan §6.4).
 *
 * - **Rebuild on path change.** `buildVizGraph` runs when the active path (or
 *   `done`/`error`) changes — edges genuinely depend on live state/context/
 *   clock, so this is the correct model, not a perf shortcut. `buildGraph` is
 *   O(states × handlers) and runs only on transitions, never on
 *   render/scroll/hover.
 * - **applyLive for context-only changes.** When the active path is unchanged,
 *   the graph objects keep identity (React Flow prop diff is O(changed));
 *   only the snapshot ref advances.
 * - Layout is memoized on the structural fingerprint (sorted node ids +
 *   sorted edge triples) inside `buildActorModel`.
 */

import { useMemo, useRef, useSyncExternalStore } from "react";
import type { AnyActor, Snapshot } from "@mantaq/core";
import { buildVizGraph, layoutGraph } from "../core/index.ts";
import type { VizGraph, VizResult, LayoutResult } from "../core/index.ts";
import { useVizStore } from "./viz-provider.tsx";

export type VizErrorKind = "graph" | "actor";

export interface VizError {
  kind: VizErrorKind;
  reason: string;
  message: string;
}

export interface ActorModel {
  /** Render-ready graph (last-good on graph error). */
  graph: VizGraph;
  /** Ok layout — memoized on the structural fingerprint. */
  layout: Extract<LayoutResult, { status: "ok" }>;
  /** Structural fingerprint: sorted node ids + sorted edge triples. */
  fingerprint: string;
  /** Last snapshot the model was derived from. */
  snapshot: Snapshot;
  /** First error since the last rebuild (or `undefined`). */
  error?: VizError;
  /** Last-good graph, kept for the 30%-opacity error render. */
  lastGoodGraph?: VizGraph;
}

/** Flatten the snapshot path tree into a comparable key. */
function pathKey(snapshot: Snapshot): string {
  const parts: string[] = [];
  const walk = (snap: Snapshot, prefix: string): void => {
    const name = snap.path[snap.path.length - 1];
    parts.push(prefix ? `${prefix}.${name}` : name);
    for (const [regionName, regionSnap] of Object.entries(snap.regions)) {
      walk(regionSnap, prefix ? `${prefix}.${regionName}` : regionName);
    }
  };
  walk(snapshot, "");
  return parts.join("\u0000");
}

/** True when the change is context-only (same active path, same done/error). */
function sameStructure(prev: Snapshot, next: Snapshot): boolean {
  return (
    pathKey(prev) === pathKey(next) &&
    prev.done === next.done &&
    (prev.error === undefined) === (next.error === undefined)
  );
}

function errorToVizError(result: Extract<VizResult, { status: "error" }>): VizError {
  return { kind: "graph", reason: result.reason, message: result.message };
}

/** Structural fingerprint — memo key for the layout. */
export function graphFingerprint(graph: VizGraph): string {
  const nodeIds = graph.nodes
    .map((n) => n.id)
    .sort()
    .join("\u0000");
  const edges = graph.edges
    .map((e) => `${e.id}|${e.source}|${e.target}`)
    .sort()
    .join("\u0000");
  return `${nodeIds}\u0001${edges}`;
}

/** Full rebuild: buildVizGraph + layoutGraph. Keeps lastGood on error. */
function buildActorModel(
  snapshot: Snapshot,
  actor: AnyActor,
  lastGoodGraph?: VizGraph,
): ActorModel {
  const result = buildVizGraph(actor);
  if (result.status === "error") {
    return {
      graph: lastGoodGraph ?? { nodes: [], edges: [], groups: [] },
      layout: emptyLayout(),
      fingerprint: lastGoodGraph ? graphFingerprint(lastGoodGraph) : "",
      snapshot,
      error: errorToVizError(result),
      lastGoodGraph,
    };
  }
  const graph = result.graph;
  const layout = layoutGraph(graph);
  if (layout.status === "error") {
    return {
      graph,
      layout: emptyLayout(),
      fingerprint: graphFingerprint(graph),
      snapshot,
      error: { kind: "graph", reason: layout.reason, message: layout.message },
      lastGoodGraph: graph,
    };
  }
  return {
    graph,
    layout,
    fingerprint: graphFingerprint(graph),
    snapshot,
    lastGoodGraph: graph,
  };
}

function emptyLayout(): Extract<LayoutResult, { status: "ok" }> {
  return { status: "ok", positions: new Map(), width: 0, height: 0, direction: "LR" };
}

/**
 * Context-only change: keep every graph object's identity, advance only the
 * snapshot. `isActive` flags are already correct — the active path did not
 * change, so the last build's flags still match it.
 */
function applyLive(prev: ActorModel, snapshot: Snapshot): ActorModel {
  return { ...prev, snapshot };
}

/** Model for the error-before-any-success render (empty graph + error). */
function buildErrorModel(snapshot: Snapshot, error: VizError): ActorModel {
  return {
    graph: { nodes: [], edges: [], groups: [] },
    layout: emptyLayout(),
    fingerprint: "",
    snapshot,
    error,
  };
}

/**
 * React hook: derive the ActorModel from the actor in the nearest VizProvider.
 * Rebuilds on path change, applies live on context-only change.
 */
export function useActorModel(): ActorModel {
  const store = useVizStore();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const actor = store.actor();
  const prevRef = useRef<ActorModel | null>(null);

  return useMemo((): ActorModel => {
    const prev = prevRef.current;
    if (!actor) {
      const model = buildErrorModel(snapshot, {
        kind: "graph",
        reason: "missing-actor",
        message: "actor is null or undefined",
      });
      prevRef.current = model;
      return model;
    }
    if (prev !== null && sameStructure(prev.snapshot, snapshot)) {
      const model = applyLive(prev, snapshot);
      prevRef.current = model;
      return model;
    }
    const rebuilt = buildActorModel(snapshot, actor, prev?.lastGoodGraph);
    prevRef.current = rebuilt;
    return rebuilt;
  }, [actor, snapshot, store]);
}
