import { buildEdgesFromTransitions } from "./graph-edges.ts";
import type { GraphTraversal } from "./graph-edges.ts";
import {
  ANY_NODE_NAME,
  INITIAL_NODE_ID,
  collectActiveStates,
  collectActorsFromSnapshot,
  isAnyNode,
  nodeId,
} from "./graph-ids.ts";
import {
  parseContextRecord,
  parseInitialName,
  parseStates,
  parseTargetMap,
  parseTransitionMap,
} from "./parse-graph.ts";
import type { ActorGraph, GraphEdge, GraphNode, StateDef } from "./types.ts";
import type { AnyActor } from "@mantaq/core";
import { Either } from "@mantaq/utils";

export { ANY_NODE_NAME, INITIAL_NODE_ID, collectActiveStates, isAnyNode };

function buildNodesFromStates(
  states: ReadonlyArray<StateDef>,
  options: { activeSet: Set<string>; pathPrefix: string },
): GraphNode[] {
  return states.map((stateEntry) => {
    const graphId = nodeId({ prefix: options.pathPrefix, name: stateEntry.name });
    return {
      id: graphId,
      label: stateEntry.name,
      isActive: options.activeSet.has(graphId),
      isFinal: stateEntry.isFinal,
    };
  });
}

function addNodesForActor(
  actor: AnyActor<unknown>,
  layout: { pathPrefix: string; activeSet: Set<string> },
): GraphNode[] {
  const states = parseStates(actor.options);
  const nodes = buildNodesFromStates(states, {
    activeSet: layout.activeSet,
    pathPrefix: layout.pathPrefix,
  });
  const anyTransitions = parseTransitionMap(actor.options?.transitions)["Any"];
  if (anyTransitions !== undefined && Object.keys(anyTransitions).length > 0) {
    const id = nodeId({ prefix: layout.pathPrefix, name: ANY_NODE_NAME });
    nodes.push({ id, label: "any state", isActive: false, isFinal: false, isAny: true });
  }
  return nodes;
}

function addEdgesForActor(
  actor: AnyActor<unknown>,
  layout: { traversal: GraphTraversal },
): GraphEdge[] {
  const states = parseStates(actor.options);
  const transitions = parseTransitionMap(actor.options?.transitions);
  const targets = parseTargetMap(actor.options?.targets);
  return buildEdgesFromTransitions({ states, transitions, targets, traversal: layout.traversal });
}

function recurseRegions(
  actor: AnyActor<unknown>,
  layout: { traversal: GraphTraversal },
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const childEdges: GraphEdge[] = [];
  if (actor.regions) {
    for (const [regionName, childActor] of Object.entries(actor.regions)) {
      const child = buildForActor(childActor, {
        traversal: {
          ...layout.traversal,
          pathPrefix: nodeId({ prefix: layout.traversal.pathPrefix, name: regionName }),
        },
      });
      nodes.push(...child.nodes);
      childEdges.push(...child.edges);
    }
  }
  return { nodes, edges: childEdges };
}

function addEffectSelfLoops(
  actor: AnyActor<unknown>,
  layout: { pathPrefix: string; activeSet: Set<string> },
): GraphEdge[] {
  const selfLoops: GraphEdge[] = [];
  const effects = actor.options?.effects;
  if (effects) {
    for (const [stateName, effectFns] of Object.entries(effects)) {
      if (Array.isArray(effectFns) && effectFns.length > 0) {
        const loopId = nodeId({ prefix: layout.pathPrefix, name: stateName });
        selfLoops.push({
          id: `${loopId}-effect:${stateName}-${loopId}`,
          source: loopId,
          target: loopId,
          label: `effect:${stateName}`,
          isActive: layout.activeSet.has(loopId),
          isInternal: true,
          contexts: [],
        });
      }
    }
  }
  return selfLoops;
}

function buildForActor(
  actor: AnyActor<unknown>,
  layout: { traversal: GraphTraversal },
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (!actor) return { nodes: [], edges: [] };
  const nodes = addNodesForActor(actor, {
    pathPrefix: layout.traversal.pathPrefix,
    activeSet: layout.traversal.activeSet,
  });
  const actorEdges = addEdgesForActor(actor, { traversal: layout.traversal });
  const region = recurseRegions(actor, { traversal: layout.traversal });
  nodes.push(...region.nodes);
  actorEdges.push(...region.edges);
  actorEdges.push(
    ...addEffectSelfLoops(actor, {
      pathPrefix: layout.traversal.pathPrefix,
      activeSet: layout.traversal.activeSet,
    }),
  );
  return { nodes, edges: actorEdges };
}

function addInitialNode(
  actor: AnyActor<unknown>,
  layout: { nodes: GraphNode[]; graphEdges: GraphEdge[] },
): void {
  const initialName = parseInitialName(actor.options);
  if (!initialName) return;
  const initNodeId = INITIAL_NODE_ID;
  const targetId = nodeId({ prefix: "", name: initialName });
  layout.nodes.push({
    id: initNodeId,
    label: "",
    isActive: false,
    isFinal: false,
    isInitial: true,
  });
  layout.graphEdges.push({
    id: `${initNodeId}->${targetId}`,
    source: initNodeId,
    target: targetId,
    label: "",
    isActive: true,
    contexts: [],
  });
}

function collectNamedContexts(named?: {
  sampleContext?: Record<string, unknown>;
  sampleContexts?: Record<string, Record<string, unknown>>;
}): Record<string, Record<string, unknown>> | undefined {
  return (
    named?.sampleContexts ?? (named?.sampleContext ? { default: named.sampleContext } : undefined)
  );
}

export function buildGraph<C>(
  actor: AnyActor<C>,
  options?: {
    internalIds?: Set<string>;
    sampleContext?: Record<string, unknown>;
    sampleContexts?: Record<string, Record<string, unknown>>;
  },
): ActorGraph {
  if (!actor) return { nodes: [], edges: [] };
  return Either.getOrElse(
    Either.from(() => {
      const activeSet = collectActorsFromSnapshot(actor.snapshot());
      const namedContexts = collectNamedContexts(options);
      const contexts = namedContexts ?? {
        default: parseContextRecord(actor.context),
      };
      const traversal: GraphTraversal = {
        actor,
        pathPrefix: "",
        activeSet,
        internalIds: options?.internalIds,
        contexts,
        contextNames: Object.keys(contexts),
      };

      const built = buildForActor(actor, { traversal });

      addInitialNode(actor, { nodes: built.nodes, graphEdges: built.edges });
      return { nodes: built.nodes, edges: built.edges };
    }),
    { onLeft: () => ({ nodes: [], edges: [] }) },
  );
}
