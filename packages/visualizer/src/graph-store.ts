import { atom } from "nanostores";
import type { AnyActor } from "@mantaq/core";
import { buildGraph, collectActiveStates, type ActorGraph } from "./graph.ts";
import { computeLayout, type LayoutResult } from "./layout.ts";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;

export const $layout = atom<LayoutResult | null>(null);
export const $selectedNodeId = atom<string | null>(null);
export const $zoom = atom(1);
export const $pan = atom({ x: 0, y: 0 });
export const $layoutError = atom<string | null>(null);

export interface TransitionInfo {
  activatedNodes: string[];
  deactivatedNodes: string[];
  activatedEdges: string[];
  deactivatedEdges: string[];
  timestamp: number;
}

export const $lastTransition = atom<TransitionInfo | null>(null);
export const $graphData = atom<ActorGraph | null>(null);
export const $graph = $graphData;

export type LayoutAlgorithm = "layered" | "force" | "stress" | "mrtree";
export const $layoutAlgorithm = atom<LayoutAlgorithm>("layered");
export type EdgeRouting = "orthogonal" | "spline" | "polyline";
export const $edgeRouting = atom<EdgeRouting>("orthogonal");
export const $layoutAnimation = atom(true);
export const $autoSize = atom(false);

export interface LayoutOptionsConfig {
  direction?: "RIGHT" | "DOWN" | "LEFT" | "UP";
  elkOptions?: Record<string, string>;
}
export const $layoutOptions = atom<LayoutOptionsConfig>({});

let layoutGeneration = 0;
let currentActor: AnyActor | null = null;
let cachedGraphStructure: import("./graph.ts").ActorGraph | null = null;
let cachedActorOptions: unknown = null;

export async function setActor(actor: AnyActor): Promise<void> {
  currentActor = actor;
  const generation = ++layoutGeneration;

  try {
    const opts = actor.options;
    let graph: import("./graph.ts").ActorGraph;
    if (cachedGraphStructure && cachedActorOptions === opts) {
      const snapshot = actor.snapshot();
      const activeSet = new Set<string>();
      collectActiveStates(snapshot, "", activeSet);
      graph = {
        nodes: cachedGraphStructure.nodes.map((n) => ({ ...n, isActive: activeSet.has(n.id) })),
        edges: cachedGraphStructure.edges.map((e) => ({ ...e, isActive: activeSet.has(e.source) })),
      };
    } else {
      graph = buildGraph(actor);
      cachedGraphStructure = graph;
      cachedActorOptions = opts;
    }

    const layout = await computeLayout(graph, {
      algorithm: $layoutAlgorithm.get(),
      edgeRouting: $edgeRouting.get(),
      autoSize: $autoSize.get(),
    });
    if (generation !== layoutGeneration) return;

    const prevLayout = $layout.get();
    if (prevLayout) {
      const prevActiveNodes = new Set(prevLayout.nodes.filter((n) => n.isActive).map((n) => n.id));
      const newActiveNodes = new Set(layout.nodes.filter((n) => n.isActive).map((n) => n.id));
      const prevActiveEdges = new Set(prevLayout.edges.filter((e) => e.isActive).map((e) => e.id));
      const newActiveEdges = new Set(layout.edges.filter((e) => e.isActive).map((e) => e.id));

      const activatedNodes = [...newActiveNodes].filter((id) => !prevActiveNodes.has(id));
      const deactivatedNodes = [...prevActiveNodes].filter((id) => !newActiveNodes.has(id));
      const activatedEdges = [...newActiveEdges].filter((id) => !prevActiveEdges.has(id));
      const deactivatedEdges = [...prevActiveEdges].filter((id) => !newActiveEdges.has(id));

      if (
        activatedNodes.length > 0 ||
        deactivatedNodes.length > 0 ||
        activatedEdges.length > 0 ||
        deactivatedEdges.length > 0
      ) {
        $lastTransition.set({
          activatedNodes,
          deactivatedNodes,
          activatedEdges,
          deactivatedEdges,
          timestamp: Date.now(),
        });
      }
    }

    $selectedNodeId.set(null);
    $layout.set(layout);
    $graphData.set(graph);
    $layoutError.set(null);
  } catch (err) {
    if (generation !== layoutGeneration) return;
    const msg = err instanceof Error ? err.message : "Layout computation failed";
    console.error("setActor", msg, err);
    $layoutError.set(msg);
  }
}

export function setZoom(zoom: number): void {
  $zoom.set(Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM));
}

export function zoomToFit(): void {
  try {
    const layout = $layout.get();
    if (!layout) return resetView();

    const graphEl = document.querySelector("actor-graph");
    if (!graphEl) return resetView();

    const rect = graphEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return resetView();

    const padding = 80;
    const scaleX = (rect.width - padding) / layout.width;
    const scaleY = (rect.height - padding) / layout.height;
    const newZoom = Math.min(Math.max(Math.min(scaleX, scaleY), MIN_ZOOM), MAX_ZOOM);

    $zoom.set(newZoom);
    $pan.set({
      x: (rect.width - layout.width * newZoom) / 2,
      y: (rect.height - layout.height * newZoom) / 2,
    });
  } catch {
    resetView();
  }
}

export function resetView(): void {
  $zoom.set(1);
  $pan.set({ x: 0, y: 0 });
}

export function startActorSync(): () => void {
  if (!currentActor) return () => {};
  return currentActor.on("change", () => {
    void setActor(currentActor!);
  });
}
