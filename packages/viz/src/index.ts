/**
 * @mantaq/viz — public API (index.ts is the spec, see viz.v2.md §3).
 * Exports grow per phase; each export is covered by the public-path contract
 * test (`tests/index.test.ts`).
 */
export { buildVizGraph } from "./core/graph-model.ts";
export type {
  VizGraph,
  VizNode,
  VizEdge,
  VizGroup,
  VizEffect,
  VizNodeKind,
  VizEdgeKind,
  VizResult,
  VizErrorReason,
} from "./core/graph-model.ts";
export { layoutGraph } from "./core/layout.ts";
export type { LayoutOptions, LayoutResult, LayoutDirection, VizPosition } from "./core/layout.ts";

// --- React components ---
export { StateGraph } from "./components/state-graph.tsx";
export type { StateGraphProps } from "./components/state-graph.tsx";
export { ActorBadge } from "./components/actor-badge.tsx";
export type { ActorBadgeProps } from "./components/actor-badge.tsx";
export { ErrorBanner } from "./components/error-banner.tsx";
export type { ErrorBannerProps } from "./components/error-banner.tsx";

// --- data hooks / model ---
export { VizProvider, useVizStore } from "./model/viz-provider.tsx";
export type { VizStore, VizProviderProps, PendingTimer } from "./model/viz-provider.tsx";
export { useActorModel } from "./model/use-actor-model.ts";
export type { ActorModel, VizError, VizErrorKind } from "./model/use-actor-model.ts";

// Side-effect import bundles the stylesheet: `vp pack` emits dist/styles.css
// (React Flow CSS inlined) and adds the "./styles.css" export. Consumers opt
// in with `import "@mantaq/viz/styles.css"`.
import "./styles/styles.css";
