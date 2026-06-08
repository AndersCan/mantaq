import type { Snapshot, AnyActor, AnyStateRef } from "@mantaq/core";

interface ActorWithOptions extends AnyActor {
  options: {
    states: AnyStateRef[];
    transitions: Record<
      string,
      Record<string, ((...args: unknown[]) => { state?: unknown }) | undefined> | undefined
    >;
  };
}

export interface GraphNode {
  id: string;
  label: string;
  isActive: boolean;
  isFinal: boolean;
  depth: number;
  children: GraphNode[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  isActive: boolean;
}

export interface ActorGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  activePath: string[];
}

export interface GraphBuilderOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  padding?: number;
}

function estimateNodeWidth(label: string, minWidth: number): number {
  const estimated = label.length * 8 + 24;
  return Math.max(estimated, minWidth);
}

function buildNodes(
  states: AnyStateRef[],
  snapshot: Snapshot,
  opts: Required<GraphBuilderOptions>,
  depth: number,
  parentPath: string,
): GraphNode[] {
  const nodes: GraphNode[] = [];

  for (const state of states) {
    const statePath = parentPath ? `${parentPath}/${state.name}` : state.name;
    const isActive = snapshot.path[depth] === state.name;

    const children: GraphNode[] = [];
    if (state._regions) {
      for (const [regionName, region] of Object.entries(state._regions)) {
        const regionStates = Object.values(region.states);
        const regionSnapshot = snapshot.regions[regionName];
        if (regionStates.length > 0 && regionSnapshot) {
          const regionPath = `${statePath}/${regionName}`;
          const regionNodes = buildNodes(regionStates, regionSnapshot, opts, 0, regionPath);

          children.push({
            id: regionPath,
            label: regionName,
            isActive: regionSnapshot.path.length > 0,
            isFinal: false,
            depth: depth + 1,
            children: regionNodes,
            width: estimateNodeWidth(regionName, opts.nodeWidth),
            height: opts.nodeHeight,
          });
        }
      }
    }

    nodes.push({
      id: statePath,
      label: state.name,
      isActive,
      isFinal: state.isFinal,
      depth,
      children,
      width: estimateNodeWidth(state.name, opts.nodeWidth),
      height: opts.nodeHeight,
    });
  }

  return nodes;
}

function collectAllStateIds(states: AnyStateRef[], parentPath: string): Set<string> {
  const ids = new Set<string>();
  for (const state of states) {
    const id = parentPath ? `${parentPath}/${state.name}` : state.name;
    ids.add(id);
  }
  return ids;
}

function resolveTargetState(
  transitionFn: ((...args: unknown[]) => { state?: unknown }) | undefined,
): string | null {
  if (!transitionFn) return null;
  try {
    const result = transitionFn();
    if (result && typeof result === "object" && "state" in result && result.state) {
      const ref = result.state as { name?: string };
      if (typeof ref.name === "string") return ref.name;
    }
  } catch {
    // transition requires args we can't provide
  }
  return null;
}

function buildEdges(actor: ActorWithOptions, allStateIds: Set<string>): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const transitions = actor.options.transitions;

  for (const [sourceName, eventMap] of Object.entries(transitions)) {
    if (!eventMap) continue;

    for (const [eventId, transitionFn] of Object.entries(eventMap)) {
      if (sourceName === "Any") {
        for (const targetId of allStateIds) {
          edges.push({
            id: `Any->${targetId}:${eventId}`,
            source: "Any",
            target: targetId,
            label: eventId,
            isActive: false,
          });
        }
      } else if (allStateIds.has(sourceName)) {
        const targetName = resolveTargetState(transitionFn) ?? sourceName;
        edges.push({
          id: `${sourceName}->${targetName}:${eventId}`,
          source: sourceName,
          target: targetName,
          label: eventId,
          isActive: false,
        });
      }
    }
  }

  return edges;
}

function buildChildGraphs(
  regions: Record<string, AnyActor>,
  snapshot: Snapshot,
  opts: Required<GraphBuilderOptions>,
  depth: number,
  parentPath: string,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const [regionName, child] of Object.entries(regions)) {
    const regionPath = parentPath ? `${parentPath}/${regionName}` : regionName;
    const childGraph = buildGraph(child, {
      nodeWidth: opts.nodeWidth,
      nodeHeight: opts.nodeHeight,
      padding: opts.padding,
    });

    for (const node of childGraph.nodes) {
      nodes.push({
        ...node,
        id: `${regionPath}/${node.id}`,
        depth,
      });
    }

    for (const edge of childGraph.edges) {
      edges.push({
        ...edge,
        source: `${regionPath}/${edge.source}`,
        target: `${regionPath}/${edge.target}`,
        id: `${regionPath}/${edge.id}`,
      });
    }
  }

  return { nodes, edges };
}

function markActiveEdges(edges: GraphEdge[], snapshot: Snapshot): void {
  const activePath = snapshot.path;
  const activeStates = new Set<string>();
  let current = "";
  for (const segment of activePath) {
    current = current ? `${current}/${segment}` : segment;
    activeStates.add(current);
  }

  for (const edge of edges) {
    if (activeStates.has(edge.source) || activeStates.has(edge.target)) {
      edge.isActive = true;
    }
  }
}

export function buildGraph(actor: AnyActor, options?: GraphBuilderOptions): ActorGraph {
  const a = actor as ActorWithOptions;
  const opts: Required<GraphBuilderOptions> = {
    nodeWidth: options?.nodeWidth ?? 120,
    nodeHeight: options?.nodeHeight ?? 60,
    padding: options?.padding ?? 20,
  };

  const snapshot = actor.snapshot();
  const activePath = snapshot.path;

  const rootStates = a.options.states;
  const nodes = buildNodes(rootStates, snapshot, opts, 0, "");

  const allStateIds = collectAllStateIds(rootStates, "");
  const edges = buildEdges(a, allStateIds);

  const childResult = buildChildGraphs(actor.regions, snapshot, opts, 1, "");
  nodes.push(...childResult.nodes);
  edges.push(...childResult.edges);

  markActiveEdges(edges, snapshot);

  return { nodes, edges, activePath };
}

export function flattenNodes(node: GraphNode): GraphNode[] {
  const result: GraphNode[] = [node];
  for (const child of node.children) {
    result.push(...flattenNodes(child));
  }
  return result;
}

export function collectEdges(graph: ActorGraph): GraphEdge[] {
  return [...graph.edges];
}

export function getTransitionsForNode(graph: ActorGraph, nodeId: string): string[] {
  return graph.edges.filter((edge) => edge.source === nodeId).map((edge) => edge.label);
}
