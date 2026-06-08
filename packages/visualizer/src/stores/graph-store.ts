import { atom, computed, type WritableAtom } from "nanostores";
import type { AnyActor } from "@mantaq/core";
import type { ActorGraph, GraphNode } from "../graph.ts";
import type { ComputedEdge, LayoutResult } from "../layout.ts";

export const $actor: WritableAtom<AnyActor | null> = atom(null);

export const $graph: WritableAtom<ActorGraph | null> = atom(null);

export const $layout: WritableAtom<LayoutResult | null> = atom(null);

export const $layoutLoading: WritableAtom<boolean> = atom(false);

export const $layoutError: WritableAtom<string | null> = atom(null);

export const $selectedNodeId: WritableAtom<string | null> = atom(null);

export const $zoom: WritableAtom<number> = atom(1);

export const $pan: WritableAtom<{ x: number; y: number }> = atom({ x: 0, y: 0 });

export const $viewport: WritableAtom<{ width: number; height: number }> = atom({
  width: 800,
  height: 600,
});

export const $flatNodes = computed($layout, (layout): GraphNode[] => {
  if (!layout) return [];
  return layout.nodes;
});

export const $edges = computed($layout, (layout): ComputedEdge[] => {
  if (!layout) return [];
  return layout.edges;
});

export const $selectedNode = computed(
  [$layout, $selectedNodeId],
  (layout, selectedId): GraphNode | null => {
    if (!layout || !selectedId) return null;
    return layout.nodes.find((n) => n.id === selectedId) ?? null;
  },
);

export const $graphDimensions = computed($layout, (layout): { width: number; height: number } => {
  if (!layout) return { width: 800, height: 600 };
  return { width: layout.width, height: layout.height };
});

export function setActor(actor: AnyActor | null): void {
  $actor.set(actor);

  if (!actor) {
    $graph.set(null);
    $layout.set(null);
    $selectedNodeId.set(null);
    return;
  }

  void import("../graph.ts").then(({ buildGraph }) => {
    const graph = buildGraph(actor);
    $graph.set(graph);
    void updateLayout(graph);
  });
}

export async function updateLayout(graph: ActorGraph): Promise<void> {
  $layoutLoading.set(true);
  $layoutError.set(null);

  try {
    const { computeLayout } = await import("../layout.ts");
    const result = await computeLayout(graph);
    $layout.set(result);
  } catch (err) {
    $layoutError.set(err instanceof Error ? err.message : String(err));
  } finally {
    $layoutLoading.set(false);
  }
}

export function selectNode(nodeId: string | null): void {
  $selectedNodeId.set(nodeId);
}

export function zoomIn(): void {
  $zoom.set(Math.min($zoom.get() * 1.2, 3));
}

export function zoomOut(): void {
  $zoom.set(Math.max($zoom.get() / 1.2, 0.3));
}

export function zoomToFit(): void {
  const layout = $layout.get();
  const viewport = $viewport.get();
  if (!layout) return;

  const scaleX = viewport.width / (layout.width + 40);
  const scaleY = viewport.height / (layout.height + 40);
  const scale = Math.min(scaleX, scaleY, 1.5);

  $zoom.set(scale);
  $pan.set({
    x: (viewport.width - layout.width * scale) / 2,
    y: (viewport.height - layout.height * scale) / 2,
  });
}

export function resetView(): void {
  $zoom.set(1);
  $pan.set({ x: 0, y: 0 });
}

export function setViewport(width: number, height: number): void {
  $viewport.set({ width, height });
}

export function startActorSync(): () => void {
  return $actor.subscribe((actor) => {
    if (!actor) {
      $graph.set(null);
      return;
    }

    void import("../graph.ts").then(({ buildGraph }) => {
      const graph = buildGraph(actor);
      $graph.set(graph);
      void updateLayout(graph);
    });
  });
}
