import type { AnyActor, Clock, Snapshot } from "@mantaq/core";
import { Context } from "@mantaq/core";
import { Either } from "@mantaq/utils";
import type {
  ActorGraph,
  GraphNode,
  GraphEdge,
  SyntheticEvent,
  StateDef,
  TransitionHandler,
  TransitionDispatchMap,
} from "./types.ts";

export const INITIAL_NODE_ID = "__initial__";

/**
 * Sandboxed actor facade for handler dry-runs (plan §6.4 "non-mutating"):
 * graph discovery executes every transition handler with a synthetic event
 * to learn its target, so handlers must never touch the live machine.
 *
 * Handlers receive `{ context, actor }` — the context setter is already
 * dropped (synthetic Context). The actor facade neutralizes the remaining
 * mutation channels: sends (to self or any region), subscriptions, clock
 * timers, and `recover`. Reads (snapshot, context, state, options, clock
 * reads) pass through, so handlers that branch on live state still resolve
 * correctly.
 *
 * Without this facade, a handler that forwards to a region
 * (`opts.actor.regions.health.send(...)`) would corrupt live actor state on
 * every graph build (v1 audit #11 class bug).
 */
const NOOP = (): void => {};

const actorSandboxCache = new WeakMap<object, unknown>();
const clockSandboxCache = new WeakMap<object, Clock>();

function sandboxClock(clock: Clock): Clock {
  const cached = clockSandboxCache.get(clock);
  if (cached !== undefined) return cached;
  const sandbox: Clock = new Proxy(clock, {
    get(target, prop) {
      // Clock writes: timers + the drain hook. `advance` is virtual-only but
      // neutralize it too — a dry-run must never move time.
      if (
        prop === "setTimeout" ||
        prop === "clearTimeout" ||
        prop === "setInterval" ||
        prop === "clearInterval" ||
        prop === "setDrain" ||
        prop === "advance"
      ) {
        return NOOP;
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  clockSandboxCache.set(clock, sandbox);
  return sandbox;
}

function sandboxActor<C>(actor: AnyActor<C>): AnyActor<C> {
  const cached = actorSandboxCache.get(actor);
  if (cached !== undefined) return cached as AnyActor<C>;
  const regions = sandboxRegions(actor.regions);
  const clock = sandboxClock(actor.clock);
  const sandbox: AnyActor<C> = new Proxy(actor, {
    get(target, prop) {
      if (prop === "send" || prop === "recover") return NOOP;
      if (prop === "on") return () => NOOP;
      if (prop === "regions") return regions;
      if (prop === "clock") return clock;
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    // A dry-run must never write machine state back through the facade.
    set(target, prop, value) {
      if (
        prop === "state" ||
        prop === "context" ||
        prop === "regions" ||
        prop === "clock" ||
        prop === "options"
      ) {
        return true;
      }
      return Reflect.set(target, prop, value, target);
    },
  });
  actorSandboxCache.set(actor, sandbox);
  return sandbox;
}

function sandboxRegions(regions: Record<string, AnyActor>): Record<string, AnyActor> {
  if (!regions) return regions;
  return new Proxy(regions, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value === "object" && value !== null) {
        return sandboxActor(value as AnyActor);
      }
      return value;
    },
    // Object.entries / spread bypass the get trap — return sandboxed actors
    // through the descriptor path as well.
    getOwnPropertyDescriptor(target, prop) {
      const desc = Reflect.getOwnPropertyDescriptor(target, prop);
      if (
        desc !== undefined &&
        "value" in desc &&
        typeof desc.value === "object" &&
        desc.value !== null
      ) {
        return { ...desc, value: sandboxActor(desc.value as AnyActor) };
      }
      return desc;
    },
  });
}

interface GraphTraversal {
  actor: AnyActor<unknown>;
  pathPrefix: string;
  activeSet: Set<string>;
  internalIds?: Set<string>;
  contexts: Record<string, Record<string, unknown>>;
  contextNames: string[];
}

interface TransitionPass {
  edgeMap: Map<string, GraphEdge>;
  sourceId: string;
  traversal: GraphTraversal;
}

interface HandledTransition {
  targetName?: string;
  emitNames: string[];
}

export function collectActiveStates(
  snapshot: Snapshot,
  prefix: string,
  activeSet: Set<string>,
): void {
  if (!snapshot || !snapshot.path) return;
  const currentName = snapshot.path[snapshot.path.length - 1];
  if (!currentName) return;

  const fullId = nodeId(prefix, currentName);
  activeSet.add(fullId);

  if (snapshot.regions && !snapshot.done && !snapshot.error) {
    for (const [regionName, regionSnap] of Object.entries(snapshot.regions)) {
      collectActiveStates(regionSnap, regionName, activeSet);
    }
  }
}

function nodeId(prefix: string, name: string): string {
  return prefix ? `${prefix}.${name}` : name;
}

function buildNodesFromStates(
  states: ReadonlyArray<StateDef>,
  activeSet: Set<string>,
  pathPrefix: string,
): GraphNode[] {
  return states.map((stateRef) => {
    const nid = nodeId(pathPrefix, stateRef.name);
    return {
      id: nid,
      label: stateRef.name,
      isActive: activeSet.has(nid),
      isFinal: stateRef.isFinal,
    };
  });
}

function invokeHandler(
  handler: TransitionHandler,
  eventId: string,
  context: Record<string, unknown>,
  actor: AnyActor<unknown>,
): Either<unknown, HandledTransition> {
  return Either.from(() => {
    const syntheticEvent: SyntheticEvent = { type: eventId, payload: {} };
    const syntheticContext = new Context<Record<string, unknown>>(
      () => context,
      () => {},
    );
    const result = handler(syntheticEvent, {
      context: syntheticContext,
      actor: sandboxActor(actor),
    });
    return {
      targetName: result?.state?.name,
      emitNames:
        result?.emit?.map((e) => e.type).filter((type): type is string => Boolean(type)) ?? [],
    };
  });
}

function upsertEdge(
  sink: { edgeMap: Map<string, GraphEdge>; sourceId: string; ctxName: string },
  traversal: GraphTraversal,
  eventId: string,
  handled: HandledTransition,
): void {
  const undetermined = !handled.targetName;
  const targetId = handled.targetName
    ? nodeId(traversal.pathPrefix, handled.targetName)
    : `${sink.sourceId}-undetermined-${eventId}`;
  const edgeId = `${sink.sourceId}-${eventId}-${targetId}`;

  const existing = sink.edgeMap.get(edgeId);
  if (existing) {
    existing.contexts!.push(sink.ctxName);
  } else {
    sink.edgeMap.set(edgeId, {
      id: edgeId,
      source: sink.sourceId,
      target: targetId,
      label: eventId,
      isActive: traversal.activeSet.has(sink.sourceId),
      isInternal: traversal.internalIds?.has(eventId),
      isUndetermined: undetermined,
      contexts: [sink.ctxName],
      ...(handled.emitNames.length > 0 && {
        payload: { action: `emit(${handled.emitNames.join(", ")})` },
      }),
    });
  }
}

function processStateTransitions(
  stateTransitions: Record<string, TransitionHandler | undefined>,
  pass: TransitionPass,
): Set<string> {
  const stateTransitionedEvents = new Set<string>();
  for (const [eventId, handler] of Object.entries(stateTransitions)) {
    if (typeof handler !== "function") continue;
    for (const ctxName of pass.traversal.contextNames) {
      const sampleContext = pass.traversal.contexts[ctxName];
      const handled = Either.getOrElse(
        invokeHandler(handler, eventId, sampleContext, pass.traversal.actor),
        () => ({ targetName: undefined, emitNames: [] }),
      );
      if (handled.targetName) stateTransitionedEvents.add(eventId);
      upsertEdge(
        { edgeMap: pass.edgeMap, sourceId: pass.sourceId, ctxName },
        pass.traversal,
        eventId,
        handled,
      );
    }
  }
  return stateTransitionedEvents;
}

function mergeAnyTransitions(
  anyTransitions: Record<string, TransitionHandler | undefined>,
  stateTransitionedEvents: Set<string>,
  pass: TransitionPass,
): void {
  for (const [eventId, handler] of Object.entries(anyTransitions)) {
    if (typeof handler !== "function") continue;
    if (stateTransitionedEvents.has(eventId)) continue;
    for (const ctxName of pass.traversal.contextNames) {
      const sampleContext = pass.traversal.contexts[ctxName];
      const handled = Either.getOrElse(
        invokeHandler(handler, eventId, sampleContext, pass.traversal.actor),
        () => ({ targetName: undefined, emitNames: [] }),
      );
      upsertEdge(
        { edgeMap: pass.edgeMap, sourceId: pass.sourceId, ctxName },
        pass.traversal,
        eventId,
        handled,
      );
    }
  }
}

function collectTransitionsForState(
  stateTransitions: Record<string, TransitionHandler | undefined> | undefined,
  anyTransitions: Record<string, TransitionHandler | undefined> | undefined,
  sourceId: string,
  traversal: GraphTraversal,
): Map<string, GraphEdge> {
  const edgeMap = new Map<string, GraphEdge>();
  const pass: TransitionPass = { edgeMap, sourceId, traversal };
  const stateTransitionedEvents = stateTransitions
    ? processStateTransitions(stateTransitions, pass)
    : new Set<string>();

  if (anyTransitions) {
    mergeAnyTransitions(anyTransitions, stateTransitionedEvents, pass);
  }

  return edgeMap;
}

function buildEdgesFromTransitions(
  states: ReadonlyArray<{ name: string }>,
  transitions: TransitionDispatchMap | undefined,
  traversal: GraphTraversal,
): GraphEdge[] {
  if (!transitions) return [];

  const anyTransitions = transitions["Any"];
  const edges: GraphEdge[] = [];

  for (const stateRef of states) {
    const sourceId = nodeId(traversal.pathPrefix, stateRef.name);
    const edgeMap = collectTransitionsForState(
      transitions[stateRef.name],
      anyTransitions,
      sourceId,
      traversal,
    );
    edges.push(...edgeMap.values());
  }

  return edges;
}

function addNodesForActor(
  actor: AnyActor<unknown>,
  pathPrefix: string,
  activeSet: Set<string>,
): GraphNode[] {
  const states = (actor.options?.states ?? []) as ReadonlyArray<StateDef>;
  return buildNodesFromStates(states, activeSet, pathPrefix);
}

function addEdgesForActor(actor: AnyActor<unknown>, traversal: GraphTraversal): GraphEdge[] {
  const states = (actor.options?.states ?? []) as ReadonlyArray<StateDef>;
  return buildEdgesFromTransitions(
    states,
    // AnyActor.options.types transitions values as unknown — actual type is handler functions (TransitionDispatch in actor.ts)
    actor.options?.transitions as TransitionDispatchMap | undefined,
    traversal,
  );
}

function recurseRegions(
  actor: AnyActor<unknown>,
  traversal: GraphTraversal,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  if (actor.regions) {
    for (const [regionName, childActor] of Object.entries(actor.regions)) {
      const child = buildForActor(childActor, {
        ...traversal,
        pathPrefix: nodeId(traversal.pathPrefix, regionName),
      });
      nodes.push(...child.nodes);
      edges.push(...child.edges);
    }
  }
  return { nodes, edges };
}

function addEffectSelfLoops(
  actor: AnyActor<unknown>,
  pathPrefix: string,
  activeSet: Set<string>,
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const effects = actor.options?.effects;
  if (effects) {
    for (const [stateName, fns] of Object.entries(effects)) {
      if (Array.isArray(fns) && fns.length > 0) {
        const sid = nodeId(pathPrefix, stateName);
        edges.push({
          id: `${sid}-effect:${stateName}-${sid}`,
          source: sid,
          target: sid,
          label: `effect:${stateName}`,
          isActive: activeSet.has(sid),
          isInternal: true,
        });
      }
    }
  }
  return edges;
}

function buildForActor(
  actor: AnyActor<unknown>,
  traversal: GraphTraversal,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (!actor) return { nodes: [], edges: [] };
  const nodes = addNodesForActor(actor, traversal.pathPrefix, traversal.activeSet);
  const edges = addEdgesForActor(actor, traversal);
  const region = recurseRegions(actor, traversal);
  nodes.push(...region.nodes);
  edges.push(...region.edges);
  edges.push(...addEffectSelfLoops(actor, traversal.pathPrefix, traversal.activeSet));
  return { nodes, edges };
}

function addInitialNode(actor: AnyActor<unknown>, nodes: GraphNode[], edges: GraphEdge[]): void {
  // AnyActor.options type lacks `initial` field — cast required (see actor-internal.ts)
  const initialName = (actor.options as { initial?: { name?: string } })?.initial?.name;
  if (!initialName) return;
  const initNodeId = nodeId("", INITIAL_NODE_ID);
  const targetId = nodeId("", initialName);
  nodes.push({
    id: initNodeId,
    label: "",
    isActive: false,
    isFinal: false,
    isInitial: true,
  });
  edges.push({
    id: `${initNodeId}->${targetId}`,
    source: initNodeId,
    target: targetId,
    label: "",
    isActive: true,
  });
}

function collectActorsFromSnapshot(snapshot: Snapshot): Set<string> {
  const activeSet = new Set<string>();
  collectActiveStates(snapshot, "", activeSet);
  return activeSet;
}

function collectNamedContexts(options?: {
  sampleContext?: Record<string, unknown>;
  sampleContexts?: Record<string, Record<string, unknown>>;
}): Record<string, Record<string, unknown>> | undefined {
  return (
    options?.sampleContexts ??
    (options?.sampleContext ? { default: options.sampleContext } : undefined)
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
  return Either.match(
    Either.from(() => {
      const activeSet = collectActorsFromSnapshot(actor.snapshot());
      const namedContexts = collectNamedContexts(options);
      const contexts = namedContexts ?? {
        default: { ...actor.context } as Record<string, unknown>,
      };
      const traversal: GraphTraversal = {
        actor,
        pathPrefix: "",
        activeSet,
        internalIds: options?.internalIds,
        contexts,
        contextNames: Object.keys(contexts),
      };

      const { nodes, edges } = buildForActor(actor, traversal);

      addInitialNode(actor, nodes, edges);
      return { nodes, edges };
    }),
    (error) => {
      throw error;
    },
    (result) => result,
  );
}
