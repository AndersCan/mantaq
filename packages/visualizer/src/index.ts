export type { GraphNode, GraphEdge, ActorGraph, GraphBuilderOptions } from "./graph.ts";
export { buildGraph, flattenNodes } from "./graph.ts";

export type { LayoutOptions, ComputedEdge, LayoutResult } from "./layout.ts";
export { computeLayout } from "./layout.ts";

export type { Theme } from "./styles.ts";
export {
  theme,
  visualizerStyles,
  stateNodeStyles,
  edgeStyles,
  applyDefaultStyles,
} from "./styles.ts";

export { ActorGraph as ActorGraphComponent } from "./components/actor-graph.ts";
export { StateNode } from "./components/state-node.ts";
export { renderEdge } from "./components/edge.ts";

export {
  $actor,
  $graph,
  $layout,
  $layoutLoading,
  $layoutError,
  $selectedNodeId,
  $zoom,
  $pan,
  $viewport,
  $flatNodes,
  $edges,
  $selectedNode,
  $graphDimensions,
  ZOOM_MIN,
  ZOOM_MAX,
  setActor,
  updateLayout,
  selectNode,
  setZoom,
  zoomIn,
  zoomOut,
  zoomToFit,
  resetView,
  setViewport,
  startActorSync,
} from "./stores/graph-store.ts";
