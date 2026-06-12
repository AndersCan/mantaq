export interface GraphNode {
  id: string;
  label: string;
  isActive: boolean;
  isFinal: boolean;
  isInitial?: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  isActive: boolean;
  isInternal?: boolean;
  isUndetermined?: boolean;
  payload?: { action?: string };
  contexts?: string[];
}

export interface ActorGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface StateVisit {
  stateName: string;
  timestamp: number;
}

export interface TransitionRecord {
  from: string;
  event: string;
  to: string | undefined;
  timestamp: number;
}

export interface EffectRecord {
  stateName: string;
  timestamp: number;
}

export interface HistoryEntry {
  type: "state_visit" | "transition" | "effect" | "send";
  data: StateVisit | TransitionRecord | EffectRecord | { event: string; timestamp: number };
}
