import { atom } from "nanostores";
import type { AnyActor } from "@mantaq/core";
import { VirtualClock } from "@mantaq/core";
import { buildGraph, collectActiveStates, type ActorGraph } from "./graph.ts";
import { computeLayout, invalidateLayoutCache, type LayoutResult } from "./layout.ts";
import { logWarn, logError } from "./logger.ts";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;

export interface TimerInfo {
  id: string;
  nodeId: string;
  label: string;
  duration: number;
  elapsed: number;
  status: "running" | "paused" | "cancelled";
}

export const $layout = atom<LayoutResult | null>(null);
export const $previousLayout = atom<LayoutResult | null>(null);
export const $selectedNodeId = atom<string | null>(null);
export const $selectedNodeIds = atom<Set<string>>(new Set());

export function selectAllNodes(): void {
  const layout = $layout.get();
  if (!layout) return;
  $selectedNodeIds.set(new Set(layout.nodes.map((n) => n.id)));
}

export function deselectAllNodes(): void {
  $selectedNodeIds.set(new Set());
}

export function toggleNodeSelection(nodeId: string): void {
  const current = $selectedNodeIds.get();
  const next = new Set(current);
  if (next.has(nodeId)) {
    next.delete(nodeId);
  } else {
    next.add(nodeId);
  }
  $selectedNodeIds.set(next);
}

export function isNodeSelected(nodeId: string): boolean {
  return $selectedNodeIds.get().has(nodeId);
}

export const $zoom = atom(1);
export const $pan = atom({ x: 0, y: 0 });
export const $layoutError = atom<string | null>(null);
export const $timers = atom<TimerInfo[]>([]);
export const $timerSpeed = atom<number>(1);
export const $contextData = atom<Record<string, unknown>>({});

export interface ErrorEntry {
  id: string;
  message: string;
  source: string;
  timestamp: number;
  severity: "error" | "warn" | "info";
}

export const $errorStore = atom<ErrorEntry[]>([]);

let errorIdCounter = 0;

export function addError(
  message: string,
  source: string,
  severity: ErrorEntry["severity"] = "error",
): void {
  const entry: ErrorEntry = {
    id: `err-${++errorIdCounter}`,
    message,
    source,
    timestamp: Date.now(),
    severity,
  };
  $errorStore.set([...$errorStore.get(), entry]);
}

export function clearErrors(): void {
  $errorStore.set([]);
}

export function removeError(id: string): void {
  $errorStore.set($errorStore.get().filter((e) => e.id !== id));
}

export interface HistoryEntry {
  timestamp: number;
  fromState: string;
  toState: string;
  event: string;
}

export const $history = atom<HistoryEntry[]>([]);
export const $historyVisible = atom(false);
export const $historyReplayIndex = atom(-1);

let previousSnapshotPaths: string[] = [];

function extractSnapshotPaths(snapshot: import("@mantaq/core").Snapshot, prefix: string): string[] {
  const currentName = snapshot.path[snapshot.path.length - 1];
  const fullPath = prefix && currentName ? `${prefix}.${currentName}` : (currentName ?? "");
  const paths: string[] = fullPath ? [fullPath] : [];
  for (const [regionName, childSnap] of Object.entries(snapshot.regions)) {
    const childPrefix = prefix ? `${prefix}.${regionName}` : regionName;
    const childPaths = extractSnapshotPaths(childSnap, childPrefix);
    for (let i = 0; i < childPaths.length; i++) {
      paths.push(childPaths[i]);
    }
  }
  return paths;
}

function recordTransition(actor: AnyActor): void {
  try {
    const snapshot = actor.snapshot();
    const currentPaths = extractSnapshotPaths(snapshot, "");
    const prev = previousSnapshotPaths;
    previousSnapshotPaths = currentPaths;

    if (prev.length === 0) return;

    const prevParts = prev.map((p) => ({
      full: p,
      base: p.split(".").pop() ?? p,
      prefix: p.slice(0, p.lastIndexOf(".")),
    }));
    const curParts = currentPaths.map((c) => ({
      full: c,
      base: c.split(".").pop() ?? c,
      prefix: c.slice(0, c.lastIndexOf(".")),
    }));

    for (const cur of curParts) {
      const matchingPrev = prevParts.find((p) => p.prefix === cur.prefix && p.base !== cur.base);
      if (matchingPrev) {
        const entry: HistoryEntry = {
          timestamp: Date.now(),
          fromState: matchingPrev.full,
          toState: cur.full,
          event: `${matchingPrev.base} → ${cur.base}`,
        };
        $history.set([...$history.get(), entry]);
        const visited = new Set($visitedStates.get());
        visited.add(entry.fromState);
        visited.add(entry.toState);
        $visitedStates.set(visited);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to record transition";
    logWarn("recordTransition", msg);
    addError(msg, "recordTransition", "warn");
  }
}

export function clearHistory(): void {
  $history.set([]);
  $historyReplayIndex.set(-1);
  $visitedStates.set(new Set());
  previousSnapshotPaths = [];
}

export function exportHistory(): string {
  return JSON.stringify($history.get(), null, 2);
}

export function setHistoryReplayIndex(index: number): void {
  const history = $history.get();
  const clamped = Math.max(-1, Math.min(index, history.length - 1));
  $historyReplayIndex.set(clamped);
}

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
export const $detailsPanelVisible = atom(false);

export interface LayoutOptionsConfig {
  direction?: "RIGHT" | "DOWN" | "LEFT" | "UP";
  elkOptions?: Record<string, string>;
}
export const $layoutOptions = atom<LayoutOptionsConfig>({});

export const $animationEnabled = atom(true);
export const $animationSpeed = atom<number>(1);
export const $prefersReducedMotion = atom(false);
export const $visitedStates = atom<Set<string>>(new Set());

export type LayoutAlgorithm = "layered" | "force" | "stress" | "mrtree";
export const $layoutAlgorithm = atom<LayoutAlgorithm>("layered");
export type EdgeRouting = "orthogonal" | "spline" | "polyline";
export const $edgeRouting = atom<EdgeRouting>("orthogonal");
export const $layoutAnimation = atom(true);

export interface LayoutPreset {
  name: string;
  algorithm: LayoutAlgorithm;
  direction: "RIGHT" | "DOWN";
  edgeRouting: EdgeRouting;
  nodeWidth: number;
  nodeHeight: number;
}

export const LAYOUT_PRESETS: Record<string, LayoutPreset> = {
  compact: {
    name: "Compact",
    algorithm: "layered",
    direction: "RIGHT",
    edgeRouting: "orthogonal",
    nodeWidth: 100,
    nodeHeight: 50,
  },
  spacious: {
    name: "Spacious",
    algorithm: "layered",
    direction: "RIGHT",
    edgeRouting: "spline",
    nodeWidth: 160,
    nodeHeight: 70,
  },
  horizontal: {
    name: "Horizontal",
    algorithm: "layered",
    direction: "RIGHT",
    edgeRouting: "orthogonal",
    nodeWidth: 120,
    nodeHeight: 60,
  },
  vertical: {
    name: "Vertical",
    algorithm: "layered",
    direction: "DOWN",
    edgeRouting: "orthogonal",
    nodeWidth: 120,
    nodeHeight: 60,
  },
  force: {
    name: "Force-Directed",
    algorithm: "force",
    direction: "RIGHT",
    edgeRouting: "spline",
    nodeWidth: 120,
    nodeHeight: 60,
  },
  tree: {
    name: "Tree",
    algorithm: "mrtree",
    direction: "DOWN",
    edgeRouting: "orthogonal",
    nodeWidth: 120,
    nodeHeight: 60,
  },
};

export const $activePreset = atom<string | null>(null);
export const $autoSize = atom(false);

export type FilterStatus = "all" | "active" | "final" | "inactive";
export const $searchQuery = atom<string>("");
export const $searchResults = atom<string[]>([]);
export const $filterStatus = atom<FilterStatus>("all");

export const MOBILE_BREAKPOINT = 768;
export const $isMobile = atom(false);

export function initMobileDetection(): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
  $isMobile.set(mq.matches);
  const handler = (e: MediaQueryListEvent) => $isMobile.set(e.matches);
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}

export type ThemeMode = "light" | "dark" | "system" | "high-contrast";
export const $theme = atom<ThemeMode>("system");
export const $customStyles = atom<string>("");

function collectContexts(
  actor: AnyActor,
  prefix: string,
  contextMap: Record<string, unknown>,
): void {
  const states = actor.options?.states ?? [];
  const ctx = actor.context ?? {};
  for (const stateRef of states) {
    const nid = prefix ? `${prefix}.${stateRef.name}` : stateRef.name;
    contextMap[nid] = ctx;
  }
  for (const [regionName, childActor] of Object.entries(actor.regions)) {
    const childPrefix = prefix ? `${prefix}.${regionName}` : regionName;
    collectContexts(childActor, childPrefix, contextMap);
  }
}

function extractContext(actor: AnyActor): Record<string, unknown> {
  try {
    const contextMap: Record<string, unknown> = {};
    collectContexts(actor, "", contextMap);
    return contextMap;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to extract context";
    logWarn("extractContext", msg);
    addError(msg, "extractContext", "warn");
    return {};
  }
}

let layoutGeneration = 0;
let currentActor: AnyActor | null = null;
let cachedGraphStructure: import("./graph.ts").ActorGraph | null = null;
let cachedActorOptions: unknown = null;

export async function setActor(actor: AnyActor): Promise<void> {
  recordTransition(actor);
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

    const context = extractContext(actor);
    const timers = extractTimers(actor);
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
    $previousLayout.set(prevLayout);
    $layout.set(layout);
    $graphData.set(graph);
    $contextData.set(context);
    $timers.set(timers);
    $layoutError.set(null);
  } catch (err) {
    if (generation !== layoutGeneration) return;
    const msg = err instanceof Error ? err.message : "Layout computation failed";
    logError("setActor", msg, err);
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to zoom to fit";
    logWarn("zoomToFit", msg);
    addError(msg, "zoomToFit", "warn");
    resetView();
  }
}

export function resetView(): void {
  $zoom.set(1);
  $pan.set({ x: 0, y: 0 });
}

function extractTimers(actor: AnyActor): TimerInfo[] {
  try {
    if (!(actor.clock instanceof VirtualClock)) return [];
    const pending = actor.clock.pendingTimers();
    const activeStates = new Set<string>();
    collectActiveStateNames(actor, "", activeStates);
    return pending.map((t) => ({
      id: String(t.id),
      nodeId: [...activeStates][0] ?? "unknown",
      label: `${t.ms}ms`,
      duration: t.ms,
      elapsed: 0,
      status: "running" as const,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to extract timers";
    logWarn("extractTimers", msg);
    addError(msg, "extractTimers", "warn");
    return [];
  }
}

function collectActiveStateNames(actor: AnyActor, prefix: string, names: Set<string>): void {
  const snapshot = actor.snapshot();
  const currentName = snapshot.path[snapshot.path.length - 1];
  if (currentName) names.add(prefix ? `${prefix}.${currentName}` : currentName);
}

export function pauseTimer(timerId: string): void {
  $timers.set(
    $timers
      .get()
      .map((t) => (t.id === timerId && t.status === "running" ? { ...t, status: "paused" } : t)),
  );
}

export function resumeTimer(timerId: string): void {
  $timers.set(
    $timers
      .get()
      .map((t) => (t.id === timerId && t.status === "paused" ? { ...t, status: "running" } : t)),
  );
}

export function cancelTimer(timerId: string): void {
  $timers.set($timers.get().map((t) => (t.id === timerId ? { ...t, status: "cancelled" } : t)));
}

export function setTimerSpeed(speed: number): void {
  $timerSpeed.set(Math.max(0.1, Math.min(speed, 10)));
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
    --viz-context-bg: #f8fafc;
    --viz-context-border: #e2e8f0;
    --viz-context-text: #475569;
    --viz-payload-guard-bg: #fef3c7;
    --viz-payload-guard-border: #f59e0b;
    --viz-payload-guard-text: #92400e;
    --viz-payload-action-bg: #dbeafe;
    --viz-payload-action-border: #3b82f6;
    --viz-payload-action-text: #1e40af;
    --viz-timer-badge-bg: #fef3c7;
    --viz-timer-badge-border: #f59e0b;
    --viz-timer-badge-text: #92400e;
    --viz-panel-bg: #ffffff;
    --viz-panel-border: #e5e7eb;
    --viz-panel-text: #374151;
    --viz-panel-title: #111827;
    --viz-panel-item-bg: #fafafa;
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
    --viz-context-bg: #1e293b;
    --viz-context-border: #334155;
    --viz-context-text: #94a3b8;
    --viz-payload-guard-bg: #422006;
    --viz-payload-guard-border: #b45309;
    --viz-payload-guard-text: #fbbf24;
    --viz-payload-action-bg: #172554;
    --viz-payload-action-border: #2563eb;
    --viz-payload-action-text: #93c5fd;
    --viz-timer-badge-bg: #422006;
    --viz-timer-badge-border: #b45309;
    --viz-timer-badge-text: #fbbf24;
    --viz-panel-bg: #1f2937;
    --viz-panel-border: #374151;
    --viz-panel-text: #e5e7eb;
    --viz-panel-title: #f9fafb;
    --viz-panel-item-bg: #111827;
  }

  [data-theme="high-contrast"] {
    --viz-bg: #000000;
    --viz-border: #ffffff;
    --viz-node-bg: #000000;
    --viz-node-active-bg: #003300;
    --viz-node-border: #ffffff;
    --viz-node-active-border: #00ff00;
    --viz-node-label: #ffffff;
    --viz-edge-color: #ffffff;
    --viz-edge-active: #00ff00;
    --viz-edge-label: #ffffff;
    --viz-text: #ffffff;
    --viz-text-muted: #cccccc;
    --viz-accent: #ffff00;
    --viz-error-text: #ff0000;
    --viz-error-bg: #330000;
    --viz-error-border: #ff0000;
    --viz-context-bg: #111111;
    --viz-context-border: #ffffff;
    --viz-context-text: #ffffff;
  }

  @media (prefers-contrast: high) {
    :root {
      --viz-border: #000000;
      --viz-node-border: #000000;
      --viz-edge-color: #000000;
      --viz-text: #000000;
      --viz-text-muted: #333333;
      --viz-node-label: #000000;
    }
    :root, [data-theme="dark"], [data-theme="high-contrast"] {
      --viz-bg: Canvas;
      --viz-node-bg: Canvas;
      --viz-text: CanvasText;
      --viz-node-label: CanvasText;
      --viz-border: CanvasText;
      --viz-node-border: CanvasText;
      --viz-edge-color: CanvasText;
      --viz-accent: Highlight;
      --viz-node-active-bg: Highlight;
      --viz-node-active-border: Highlight;
      --viz-edge-active: Highlight;
    }
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

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function setTheme(theme: ThemeMode): void {
  $theme.set(theme);
  if (typeof document === "undefined") return;
  const resolved = theme === "system" ? getSystemTheme() : theme;
  document.documentElement.setAttribute("data-theme", resolved);
  try {
    localStorage.setItem("mantaq-theme", theme);
  } catch {}
}

export function initTheme(): void {
  if (typeof document === "undefined") return;
  let saved: ThemeMode = "system";
  try {
    const stored = localStorage.getItem("mantaq-theme");
    if (
      stored === "light" ||
      stored === "dark" ||
      stored === "system" ||
      stored === "high-contrast"
    )
      saved = stored;
  } catch {}
  if (saved === "system" && typeof window !== "undefined") {
    const prefersHighContrast = window.matchMedia("(prefers-contrast: high)");
    if (prefersHighContrast.matches) saved = "high-contrast";
  }
  $theme.set(saved);
  const resolved = saved === "system" ? getSystemTheme() : saved;
  document.documentElement.setAttribute("data-theme", resolved);
  if (typeof window !== "undefined") {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if ($theme.get() === "system") {
        document.documentElement.setAttribute("data-theme", getSystemTheme());
      }
    });
    window.matchMedia("(prefers-contrast: high)").addEventListener("change", (e) => {
      if ($theme.get() === "system" && e.matches) {
        document.documentElement.setAttribute("data-theme", "high-contrast");
      }
    });
  }
}

export function cycleTheme(): void {
  const current = $theme.get();
  const next: ThemeMode =
    current === "light"
      ? "dark"
      : current === "dark"
        ? "high-contrast"
        : current === "high-contrast"
          ? "system"
          : "light";
  setTheme(next);
}

export function setCustomStyles(css: string): void {
  $customStyles.set(css);
  if (typeof document === "undefined") return;
  let el = document.getElementById("mantaq-custom-styles");
  if (!el) {
    el = document.createElement("style");
    el.id = "mantaq-custom-styles";
    document.head.appendChild(el);
  }
  el.textContent = css;
}

export function setSearchQuery(query: string): void {
  $searchQuery.set(query);
  updateSearchResults();
}

function updateSearchResults(): void {
  const layout = $layout.get();
  const query = $searchQuery.get().trim().toLowerCase();
  if (!layout || !query) {
    $searchResults.set([]);
    return;
  }
  const matches: string[] = [];
  for (const node of layout.nodes) {
    if (fuzzyMatch(node.label.toLowerCase(), query)) {
      matches.push(node.id);
    }
  }
  $searchResults.set(matches);
}

function fuzzyMatch(text: string, query: string): boolean {
  if (text.includes(query)) return true;
  let qi = 0;
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) qi++;
  }
  return qi === query.length;
}

let cachedVisibleNodes: Set<string> | null = null;
let cachedVisibleKey = "";

export function getVisibleNodes(): Set<string> | null {
  const layout = $layout.get();
  if (!layout) return null;
  const filter = $filterStatus.get();
  const query = $searchQuery.get().trim();
  if (filter === "all" && !query) return null;
  const searchHits = $searchResults.get();
  const cacheKey = `${filter}|${query}|${searchHits.join(",")}|${layout.nodes.length}`;
  if (cacheKey === cachedVisibleKey && cachedVisibleNodes !== undefined) {
    return cachedVisibleNodes;
  }
  const searchSet = query ? new Set(searchHits) : null;
  const visible = new Set<string>();
  for (const node of layout.nodes) {
    const statusMatch =
      filter === "all" ||
      (filter === "active" && node.isActive) ||
      (filter === "final" && node.isFinal) ||
      (filter === "inactive" && !node.isActive && !node.isFinal);
    const searchMatch = !searchSet || searchSet.has(node.id);
    if (statusMatch && searchMatch) visible.add(node.id);
  }
  cachedVisibleKey = cacheKey;
  cachedVisibleNodes = visible;
  return visible;
}

export function toggleAnimation(): void {
  $animationEnabled.set(!$animationEnabled.get());
}

export function setAnimationSpeed(speed: number): void {
  $animationSpeed.set(Math.max(0.25, Math.min(speed, 4)));
}

export function applyPreset(presetKey: string): void {
  const preset = LAYOUT_PRESETS[presetKey];
  if (!preset) return;
  $activePreset.set(presetKey);
  $layoutAlgorithm.set(preset.algorithm);
  $edgeRouting.set(preset.edgeRouting);
  invalidateLayoutCache();
  if (currentActor) void setActor(currentActor);
}

export function setLayoutAlgorithm(algo: LayoutAlgorithm): void {
  if ($layoutAlgorithm.get() === algo) return;
  $activePreset.set(null);
  $layoutAlgorithm.set(algo);
  invalidateLayoutCache();
  if (currentActor) void setActor(currentActor);
}

export function setEdgeRouting(routing: EdgeRouting): void {
  if ($edgeRouting.get() === routing) return;
  $activePreset.set(null);
  $edgeRouting.set(routing);
  invalidateLayoutCache();
  if (currentActor) void setActor(currentActor);
}

export function toggleLayoutAnimation(): void {
  $layoutAnimation.set(!$layoutAnimation.get());
}

export function toggleAutoSize(): void {
  $autoSize.set(!$autoSize.get());
  invalidateLayoutCache();
  if (currentActor) void setActor(currentActor);
}

export function initAnimation(): void {
  if (typeof window === "undefined") return;
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  $prefersReducedMotion.set(mq.matches);
  if (!mq.matches) {
    $animationEnabled.set(true);
  } else {
    $animationEnabled.set(false);
  }
  mq.addEventListener("change", (e) => {
    $prefersReducedMotion.set(e.matches);
    if (e.matches) {
      $animationEnabled.set(false);
    }
  });
}
