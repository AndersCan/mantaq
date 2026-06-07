import type { AnyActor } from "@mantaq/core";
import { TransitionState } from "@mantaq/core";
import type { Graph, GraphNode, GraphEdge, ActorConfigInput } from "./types.ts";

function isStateRef(
  value: unknown,
): value is { name: string; isFinal?: boolean; _regions?: unknown } {
  return typeof value === "object" && value !== null && "name" in value;
}

function resolveInitialName(initial: unknown): string {
  if (isStateRef(initial)) return initial.name;
  if (initial instanceof TransitionState) return (initial as TransitionState).__stateRef.name;
  if (typeof initial === "object" && initial !== null && "state" in initial) {
    const s = (initial as { state: unknown }).state;
    if (isStateRef(s)) return s.name;
  }
  return "";
}

function buildEdges(
  transitions: Record<string, Record<string, unknown>>,
  context: unknown,
  actor: AnyActor,
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const [sourceName, events] of Object.entries(transitions)) {
    const isWildcard = sourceName === "Any";
    for (const [eventId, handler] of Object.entries(events)) {
      if (typeof handler !== "function") continue;
      let targetName = "";
      try {
        const result = (handler as Function)({ id: eventId }, { context, actor });
        if (result && typeof result === "object" && "state" in result) {
          const target = (result as { state: unknown }).state;
          if (isStateRef(target)) targetName = target.name;
          else if (target instanceof TransitionState)
            targetName = (target as TransitionState).__stateRef.name;
        }
      } catch {
        /* handler threw, target unknown */
      }
      edges.push({
        id: `${sourceName}:${eventId}`,
        from: isWildcard ? "*" : sourceName,
        to: targetName,
        eventId,
        isWildcard,
      });
    }
  }
  return edges;
}

function buildNodes(
  states: Array<{ name: string; isFinal?: boolean; _regions?: unknown }>,
  effects: Record<string, unknown[]> | undefined,
  initialName: string,
): Map<string, GraphNode> {
  const nodes = new Map<string, GraphNode>();
  for (const s of states) {
    const stateEffects = effects?.[s.name] ?? [];
    nodes.set(s.name, {
      id: s.name,
      isInitial: s.name === initialName,
      isFinal: s.isFinal ?? false,
      effects: stateEffects.map((_, i) => `${s.name}:effect:${i}`),
      regions: {},
    });
  }
  return nodes;
}

/**
 * Extract graph from raw actor config.
 * Best-effort: invokes transition handlers to determine target states.
 */
export function extractGraph(config: ActorConfigInput): Graph {
  const initialName = resolveInitialName(config.initial);
  const nodes = buildNodes(config.states, config.effects, initialName);
  const edges = buildEdges(config.transitions, {}, {} as AnyActor);

  for (const s of config.states) {
    if (s._regions) {
      const node = nodes.get(s.name);
      if (node) {
        for (const regionName of Object.keys(s._regions as Record<string, unknown>)) {
          node.regions[regionName] = { nodes: new Map(), edges: [], initial: "" };
        }
      }
    }
  }

  return { nodes, edges, initial: initialName };
}

/**
 * Extract graph from a live actor instance.
 * Reads actor.options for full structure including regions.
 */
export function extractGraphFromActor(actor: AnyActor): Graph {
  const options = (actor as unknown as { options: ActorConfigInput & { context: unknown } })
    .options;
  const initialName = resolveInitialName(options.initial);
  const states = options.states as Array<{ name: string; isFinal?: boolean; _regions?: unknown }>;
  const effects = options.effects as Record<string, unknown[]> | undefined;
  const nodes = buildNodes(states, effects, initialName);
  const transitions = options.transitions as Record<string, Record<string, unknown>>;
  const edges = buildEdges(transitions, options.context, actor);

  for (const s of states) {
    if (s._regions) {
      const node = nodes.get(s.name);
      if (node) {
        for (const regionName of Object.keys(s._regions as Record<string, unknown>)) {
          const child = actor.regions[regionName];
          if (child) {
            node.regions[regionName] = extractGraphFromActor(child);
          }
        }
      }
    }
  }

  return { nodes, edges, initial: initialName };
}
