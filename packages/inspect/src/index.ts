export { toViz, toVizMachine } from "./structure.ts";
export type { VizInput } from "./structure.ts";
export { fuzz, shrink } from "./fuzz/fuzz.ts";
export type { CorpusEntry, FuzzOptions, FuzzResult } from "./fuzz/fuzz.ts";
export { eventCatalog, execute } from "./fuzz/run.ts";
export type { FuzzTarget, Observation, RunError, Trace } from "./fuzz/run.ts";
export type { LiteralPool } from "./fuzz/mutate.ts";
export { fuzzedMachine } from "./fuzz/to-viz.ts";
export { withTestCoverage } from "./fuzz/coverage.ts";
export { branchDistance, branchDistanceGuide, guidance, literalPool } from "./fuzz/guided.ts";
export { analyzeSource, annotateMachine } from "./ast/annotate.ts";
export type { HandlerSite } from "./ast/annotate.ts";
export type { AnalysisSource } from "./ast/program.ts";
export { inspect, inspectModule, machineId, vizDocument } from "./inspect.ts";
export type {
  FuzzSettings,
  Inspected,
  InspectedModule,
  InspectTarget,
  ModuleOptions,
} from "./inspect.ts";
export { inspectFile } from "./load.ts";
export type { FileOptions } from "./load.ts";
export { htmlPage } from "./page.ts";
export { analyzeModule } from "./ast/annotate.ts";
export type { ModuleAnalysis } from "./ast/annotate.ts";
export type { MachineExport } from "./ast/discover.ts";
