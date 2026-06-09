export { buildGraph, collectActiveStates } from "./graph.ts";
export type { ActorGraph, GraphNode, GraphEdge } from "./graph.ts";

export { computeLayout, invalidateLayoutCache } from "./layout.ts";
export type { LayoutResult, LayoutNode, LayoutEdge, LayoutOptions } from "./layout.ts";

export {
  $layout,
  $selectedNodeId,
  $selectedNodeIds,
  $zoom,
  $pan,
  $layoutError,
  $contextData,
  $timers,
  $timerSpeed,
  $searchQuery,
  $searchResults,
  $filterStatus,
  $isMobile,
  MOBILE_BREAKPOINT,
  $theme,
  $customStyles,
  $animationEnabled,
  $animationSpeed,
  $prefersReducedMotion,
  $errorStore,
  $layoutAlgorithm,
  $edgeRouting,
  $layoutAnimation,
  $activePreset,
  $autoSize,
  LAYOUT_PRESETS,
  applyPreset,
  toggleAutoSize,
  $graphData,
  $graph,
  $layoutOptions,
  setActor,
  zoomToFit,
  resetView,
  setZoom,
  startActorSync,
  applyDefaultStyles,
  removeDefaultStyles,
  setTheme,
  initTheme,
  cycleTheme,
  setCustomStyles,
  initMobileDetection,
  pauseTimer,
  resumeTimer,
  cancelTimer,
  setTimerSpeed,
  toggleAnimation,
  setAnimationSpeed,
  initAnimation,
  setSearchQuery,
  getVisibleNodes,
  setLayoutAlgorithm,
  setEdgeRouting,
  toggleLayoutAnimation,
  $history,
  $historyVisible,
  $historyReplayIndex,
  $visitedStates,
  clearHistory,
  exportHistory,
  setHistoryReplayIndex,
  selectAllNodes,
  deselectAllNodes,
  toggleNodeSelection,
  isNodeSelected,
  addError,
  clearErrors,
  removeError,
} from "./graph-store.ts";
export type {
  ThemeMode,
  TimerInfo,
  FilterStatus,
  TransitionInfo,
  HistoryEntry,
  ErrorEntry,
  LayoutAlgorithm,
  EdgeRouting,
  LayoutPreset,
  LayoutOptionsConfig,
} from "./graph-store.ts";

export { ActorGraphComponent } from "./components/actor-graph.ts";
export { StateNode } from "./components/state-node.ts";
export { EdgePath } from "./components/edge.ts";
export { TimerIndicator } from "./components/timer-indicator.ts";
export { MinimapComponent, $minimapVisible } from "./components/minimap.ts";
export { NodeDetailsPanel } from "./components/node-details-panel.ts";
export { HistoryPanelComponent } from "./components/history-panel.ts";
export { LayoutControlsComponent } from "./components/layout-controls.ts";
export { ExportMenuComponent } from "./components/export-menu.ts";
export { ShortcutOverlay, $shortcutOverlayVisible } from "./components/shortcut-overlay.ts";
export {
  GoToDialog,
  $goToDialogVisible,
  openGoToDialog,
  closeGoToDialog,
  goToNode,
  setGoToQuery,
} from "./components/go-to-dialog.ts";
export {
  ShortcutEditor,
  $shortcutEditorVisible,
  openShortcutEditor,
  closeShortcutEditor,
} from "./components/shortcut-editor.ts";
export {
  exportAsSvg,
  exportAsPng,
  copyGraphState,
  shareViaUrl,
  importFromUrl,
  getGraphState,
  buildSvgString,
  $exportMenuVisible,
} from "./export.ts";
export type { ExportOptions, GraphState } from "./export.ts";
export { logDebug, logInfo, logWarn, logError } from "./logger.ts";

export {
  $shortcuts,
  DEFAULT_SHORTCUTS,
  SHORTCUT_CATEGORIES,
  matchShortcut,
  formatShortcutKey,
  groupShortcutsByCategory,
  getShortcutsForAction,
  updateShortcut,
  resetShortcuts,
  addShortcut,
  removeShortcut,
} from "./shortcut-registry.ts";
export type { ShortcutDefinition } from "./shortcut-registry.ts";
