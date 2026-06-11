export { createGraph } from "./create-graph.ts";
export type { X6GraphOptions } from "./create-graph.ts";

export { nodeAttrs } from "./node-style.ts";
export type { NodeAttrs } from "./node-style.ts";

export { edgeConfig, edgeLine, edgeLabel, edgeData } from "./edge-style.ts";
export type { EdgeConfig, EdgeLabelAttrs, EdgeLineAttrs } from "./edge-style.ts";

export { toNodeDef, toEdgeDef } from "./to-x6.ts";
export type { X6NodeDef } from "./to-x6.ts";

export { syncGraph, syncNodes, syncEdges } from "./sync.ts";
export type { SyncResult } from "./sync.ts";
