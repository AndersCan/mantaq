export { toAtlas, toAtlasMachine } from "./atlas.ts";
export type { AtlasInput } from "./atlas.ts";
export { serializeAtlas } from "./serialize.ts";
export { parseAtlas, validateAtlas } from "./validate.ts";
export type { AtlasIssue } from "./validate.ts";
export { fuzz, shrink } from "./fuzz/fuzz.ts";
export type { CorpusEntry, FuzzOptions, FuzzResult } from "./fuzz/fuzz.ts";
export { eventCatalog, execute } from "./fuzz/run.ts";
export type { FuzzTarget, Observation, RunError, Trace } from "./fuzz/run.ts";
export type { LiteralPool } from "./fuzz/mutate.ts";
export { fuzzedMachine } from "./fuzz/to-atlas.ts";
export { withTestCoverage } from "./fuzz/coverage.ts";
export { branchDistance, branchDistanceGuide, guidance, literalPool } from "./fuzz/guided.ts";
export { analyzeSource, annotateMachine } from "./ast/annotate.ts";
export type { HandlerSite } from "./ast/annotate.ts";
export type { AnalysisSource } from "./ast/program.ts";
export { ATLAS_SCHEMA_VERSION } from "./schema.ts";
export type {
  AtlasCoverage,
  AtlasDocument,
  AtlasBranch,
  AtlasBranchTarget,
  AtlasComparison,
  AtlasEdge,
  AtlasEdgeKind,
  AtlasEdgeOrigin,
  AtlasEvent,
  AtlasExplanation,
  AtlasFuzz,
  AtlasFuzzError,
  AtlasFuzzSequence,
  AtlasJson,
  AtlasLocation,
  AtlasMachine,
  AtlasState,
  AtlasStep,
} from "./schema.ts";
