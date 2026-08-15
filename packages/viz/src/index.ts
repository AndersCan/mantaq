/**
 * Phase 1 vertical slice — graph rendering core.
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

// Side-effect import bundles the stylesheet: `vp pack` emits dist/styles.css
// (React Flow CSS inlined) and adds the "./styles.css" export. Consumers opt
// in with `import "@mantaq/viz/styles.css"`.
import "./styles/styles.css";
