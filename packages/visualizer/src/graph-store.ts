import { atom } from "nanostores";
import type { AnyActor } from "@mantaq/core";
import { buildGraph, type ActorGraph } from "./graph.ts";
import { computeLayout, type LayoutResult, type LayoutOptions } from "./layout.ts";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;

export const $graph = atom<ActorGraph | null>(null);
export const $layoutOptions = atom<LayoutOptions>({});
export const $layout = atom<LayoutResult | null>(null);
export const $selectedNodeId = atom<string | null>(null);
export const $zoom = atom(1);
export const $pan = atom({ x: 0, y: 0 });
export const $layoutError = atom<string | null>(null);

let layoutGeneration = 0;
let currentActor: AnyActor | null = null;

export async function setActor(actor: AnyActor): Promise<void> {
  currentActor = actor;
  $selectedNodeId.set(null);

  const generation = ++layoutGeneration;

  try {
    const graph = buildGraph(actor);
    $graph.set(graph);
    const options = $layoutOptions.get();
    const layout = await computeLayout(graph, options);
    if (generation !== layoutGeneration) return;
    $layout.set(layout);
    $layoutError.set(null);
  } catch (err) {
    if (generation !== layoutGeneration) return;
    $layoutError.set(err instanceof Error ? err.message : "Layout computation failed");
  }
}

export function setZoom(zoom: number): void {
  $zoom.set(Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM));
}

export function zoomToFit(): void {
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

const DEFAULT_STYLES = `
  :root {
    --viz-bg: #fafafa;
    --viz-border: #e5e7eb;
    --viz-node-bg: #ffffff;
    --viz-node-active-bg: #dcfce7;
    --viz-node-border: #d1d5db;
    --viz-node-active-border: #22c55e;
    --viz-node-label: #374151;
    --viz-edge-color: #9ca3af;
    --viz-edge-active: #22c55e;
    --viz-edge-label: #6b7280;
    --viz-text: #374151;
    --viz-text-muted: #6b7280;
    --viz-accent: #6366f1;
    --viz-error-text: #dc2626;
    --viz-error-bg: #fef2f2;
    --viz-error-border: #fecaca;
  }

  [data-theme="dark"] {
    --viz-bg: #111827;
    --viz-border: #374151;
    --viz-node-bg: #1f2937;
    --viz-node-active-bg: #064e3b;
    --viz-node-border: #4b5563;
    --viz-node-active-border: #22c55e;
    --viz-node-label: #e5e7eb;
    --viz-edge-color: #4b5563;
    --viz-edge-active: #22c55e;
    --viz-edge-label: #9ca3af;
    --viz-text: #e5e7eb;
    --viz-text-muted: #9ca3af;
    --viz-accent: #818cf8;
    --viz-error-text: #fca5a5;
    --viz-error-bg: #450a0a;
    --viz-error-border: #7f1d1d;
  }
`;

let stylesInjected = false;

export function applyDefaultStyles(): void {
  if (stylesInjected) return;
  if (typeof document === "undefined") return;

  const style = document.createElement("style");
  style.id = "mantaq-visualizer-defaults";
  style.textContent = DEFAULT_STYLES;
  document.head.appendChild(style);
  stylesInjected = true;
}

export function removeDefaultStyles(): void {
  const style = document.getElementById("mantaq-visualizer-defaults");
  style?.remove();
  stylesInjected = false;
}
