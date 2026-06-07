export interface GraphNode {
  id: string;
  isInitial: boolean;
  isFinal: boolean;
  effects: string[];
  regions: Record<string, Graph>;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  eventId: string;
  isWildcard: boolean;
}

export interface Graph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  initial: string;
}

export interface ActorConfigInput {
  states: Array<{ name: string; isFinal?: boolean; _regions?: unknown }>;
  transitions: Record<string, Record<string, unknown>>;
  effects?: Record<string, unknown[]>;
  initial: unknown;
  inputs?: Array<{ id: string }>;
  internal?: Array<{ id: string }>;
  regions?: Record<string, unknown>;
}

export interface Path {
  states: string[];
  events: string[];
}

export interface CoverageReport {
  statesVisited: Set<string>;
  statesTotal: Set<string>;
  edgesVisited: Set<string>;
  edgesTotal: Set<string>;
  stateCoverage: number;
  edgeCoverage: number;
  unreachableStates: string[];
  deadEndStates: string[];
}

export interface LLMContext {
  currentState: string;
  possibleTransitions: Array<{
    eventId: string;
    targetState: string;
    isWildcard: boolean;
  }>;
  activeEffects: string[];
  isFinal: boolean;
  graphSummary: string;
}

export type ExportFormat = "mermaid" | "dot" | "json";
