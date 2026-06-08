import { atom } from "nanostores";
import type { AnyActor } from "@mantaq/core";
import type { ActorGraph } from "../graph.ts";
import type { LayoutResult } from "../layout.ts";
import { buildGraph } from "../graph.ts";
import { computeLayout } from "../layout.ts";

export const $actor = atom<AnyActor | null>(null);
export const $graph = atom<ActorGraph | null>(null);
export const $layout = atom<LayoutResult | null>(null);
export const $selectedNodeId = atom<string | null>(null);
export const $zoom = atom(1);
export const $pan = atom({ x: 0, y: 0 });
export const $layoutError = atom<string | null>(null);
export const $isComputing = atom(false);

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.2;

let layoutGeneration = 0;

export async function setActor(actor: AnyActor): Promise<void> {
  $actor.set(actor);
  $selectedNodeId.set(null);

  const generation = ++layoutGeneration;

  try {
    $isComputing.set(true);
    const graph = buildGraph(actor);
    $graph.set(graph);
    const layout = await computeLayout(graph);
    if (generation !== layoutGeneration) return;
    $layout.set(layout);
    $layoutError.set(null);
  } catch (err) {
    if (generation !== layoutGeneration) return;
    $layoutError.set(err instanceof Error ? err.message : "Layout computation failed");
  } finally {
    if (generation === layoutGeneration) {
      $isComputing.set(false);
    }
  }
}

export function selectNode(nodeId: string | null): void {
  $selectedNodeId.set(nodeId);
}

export function zoomIn(): void {
  const current = $zoom.get();
  $zoom.set(Math.min(current + ZOOM_STEP, MAX_ZOOM));
}

export function zoomOut(): void {
  const current = $zoom.get();
  $zoom.set(Math.max(current - ZOOM_STEP, MIN_ZOOM));
}

export function zoomToFit(): void {
  const layout = $layout.get();
  if (!layout) {
    resetView();
    return;
  }

  const graphEl = document.querySelector("actor-graph");
  if (!graphEl) {
    resetView();
    return;
  }

  const rect = graphEl.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    resetView();
    return;
  }

  const padding = 80;
  const scaleX = (rect.width - padding) / layout.width;
  const scaleY = (rect.height - padding) / layout.height;
  const newZoom = Math.min(Math.max(Math.min(scaleX, scaleY), MIN_ZOOM), MAX_ZOOM);

  $zoom.set(newZoom);
  $pan.set({
    x: (rect.width - layout.width * newZoom) / 2,
    y: (rect.height - layout.height * newZoom) / 2,
  });
}

export function resetView(): void {
  $zoom.set(1);
  $pan.set({ x: 0, y: 0 });
}

export function setZoom(zoom: number): void {
  $zoom.set(Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM));
}

export function setPan(pan: { x: number; y: number }): void {
  $pan.set(pan);
}

export function startActorSync(): () => void {
  const actor = $actor.get();
  if (!actor) return () => {};

  return actor.on("change", () => {
    void setActor(actor);
  });
}

export function applyDarkTheme(): void {
  document.documentElement.setAttribute("data-theme", "dark");
}

export function removeDarkTheme(): void {
  document.documentElement.removeAttribute("data-theme");
}
