import { ANY_NODE_NAME, nodeId } from "./graph-ids.ts";
import { isHandlerResult } from "./is-handler-result.ts";
import type {
  GraphEdge,
  StateDef,
  SyntheticEvent,
  TargetMap,
  TransitionDispatchMap,
  TransitionHandler,
} from "./types.ts";
import { Context, type AnyActor } from "@mantaq/core";
import { Either } from "@mantaq/utils";

export interface GraphTraversal {
  actor: AnyActor<unknown>;
  pathPrefix: string;
  activeSet: Set<string>;
  internalIds?: Set<string>;
  contexts: Record<string, Record<string, unknown>>;
  contextNames: string[];
}

interface HandledTransition {
  targetName?: string;
  emitNames: string[];
}

function invokeHandler(
  handler: TransitionHandler,
  options: { eventId: string; context: Record<string, unknown>; actor: AnyActor<unknown> },
): Either<unknown, HandledTransition> {
  return Either.from(() => {
    const syntheticEvent: SyntheticEvent = { type: options.eventId, payload: {} };
    const syntheticContext = Context<Record<string, unknown>>({
      get: () => options.context,
      set: () => {},
    });
    const result: unknown = handler(syntheticEvent, {
      context: syntheticContext,
      actor: options.actor,
    });
    return isHandlerResult(result)
      ? {
          targetName: result.state?.name,
          emitNames:
            result.emit
              ?.map((emitted) => emitted.type)
              .filter((eventType): eventType is string => Boolean(eventType)) ?? [],
        }
      : { targetName: undefined, emitNames: [] };
  });
}

interface TransitionPass {
  edgeMap: Map<string, GraphEdge>;
  sourceId: string;
  /** Whether the machine currently sits in the edge's source. */
  isActive: boolean;
  traversal: GraphTraversal;
}

interface Registration {
  eventId: string;
  handler: TransitionHandler;
  /** Builder `to` names; `undefined` when the actor carries no declaration (one undetermined edge). */
  declared: string[] | undefined;
}

interface Probe {
  ctxName: string;
  handled: HandledTransition;
}

function probeAll(registration: Registration, pass: TransitionPass): Probe[] {
  const probes: Probe[] = [];
  for (const ctxName of pass.traversal.contextNames) {
    const sampleContext = pass.traversal.contexts[ctxName];
    if (sampleContext === undefined) continue;
    const handled = Either.getRight(
      invokeHandler(registration.handler, {
        eventId: registration.eventId,
        context: sampleContext,
        actor: pass.traversal.actor,
      }),
    );
    // A probe that throws reached no target, so it labels no edge.
    if (handled !== undefined) probes.push({ ctxName, handled });
  }
  return probes;
}

/**
 * One edge per declared target, a `stay` edge when `to` is empty, or one
 * undetermined edge when the actor carries no declaration. Probing only labels
 * edges: which sample contexts reach each target, and what it emits.
 */
function addRegistration(registration: Registration, pass: TransitionPass): void {
  const probes = probeAll(registration, pass);
  const declared = registration.declared ?? [];
  const targets: Array<string | undefined> = declared.length > 0 ? declared : [undefined];
  const undetermined = registration.declared === undefined;
  for (const targetName of targets) {
    const matching = undetermined
      ? probes
      : probes.filter((probe) => probe.handled.targetName === targetName);
    const emitNames = [...new Set(matching.flatMap((probe) => probe.handled.emitNames))].sort();
    const targetId = targetName
      ? nodeId({ prefix: pass.traversal.pathPrefix, name: targetName })
      : pass.sourceId;
    const suffix = targetName ? targetId : undetermined ? "undetermined" : "stay";
    const edgeId = `${pass.sourceId}-${registration.eventId}-${suffix}`;
    pass.edgeMap.set(edgeId, {
      id: edgeId,
      source: pass.sourceId,
      target: targetId,
      label: registration.eventId,
      isActive: pass.isActive,
      isInternal: pass.traversal.internalIds?.has(registration.eventId),
      isUndetermined: undetermined,
      isStay: !undetermined && targetName === undefined,
      isDeclared: !undetermined,
      contexts: matching.map((probe) => probe.ctxName),
      ...(emitNames.length > 0 && { payload: { action: `emit(${emitNames.join(", ")})` } }),
    });
  }
}

function registrations(
  handlers: Record<string, TransitionHandler> | undefined,
  declared: Record<string, string[]> | undefined,
): Registration[] {
  return Object.entries(handlers ?? {}).map(([eventId, handler]) => ({
    eventId,
    handler,
    declared: declared?.[eventId],
  }));
}

function stateEdges(edges: {
  state: StateDef;
  transitions: TransitionDispatchMap;
  targets: TargetMap;
  traversal: GraphTraversal;
}): GraphEdge[] {
  const sourceId = nodeId({ prefix: edges.traversal.pathPrefix, name: edges.state.name });
  const pass: TransitionPass = {
    edgeMap: new Map(),
    sourceId,
    isActive: edges.traversal.activeSet.has(sourceId),
    traversal: edges.traversal,
  };
  const own = registrations(edges.transitions[edges.state.name], edges.targets[edges.state.name]);
  for (const registration of own) addRegistration(registration, pass);
  return [...pass.edgeMap.values()];
}

/**
 * `onAny` edges leave one `*` source, once per target: "from any non-final
 * state". Expanding them per state would claim source/target pairs the code
 * never states. A state's own handler for the same event runs first; when it
 * stays, `onAny` may still transition, so both edges are kept.
 */
function anyEdges(edges: {
  states: ReadonlyArray<StateDef>;
  transitions: TransitionDispatchMap;
  targets: TargetMap;
  traversal: GraphTraversal;
}): GraphEdge[] {
  const prefix = edges.traversal.pathPrefix;
  const pass: TransitionPass = {
    edgeMap: new Map(),
    sourceId: nodeId({ prefix, name: ANY_NODE_NAME }),
    isActive: edges.states.some(
      (state) =>
        !state.isFinal && edges.traversal.activeSet.has(nodeId({ prefix, name: state.name })),
    ),
    traversal: edges.traversal,
  };
  for (const registration of registrations(edges.transitions["Any"], edges.targets["Any"])) {
    addRegistration(registration, pass);
  }
  return [...pass.edgeMap.values()];
}

export function buildEdgesFromTransitions(edges: {
  states: ReadonlyArray<StateDef>;
  transitions: TransitionDispatchMap;
  targets?: TargetMap;
  traversal: GraphTraversal;
}): GraphEdge[] {
  const scope = {
    transitions: edges.transitions,
    targets: edges.targets ?? {},
    traversal: edges.traversal,
  };
  return [
    ...edges.states.flatMap((state) => stateEdges({ ...scope, state })),
    ...anyEdges({ ...scope, states: edges.states }),
  ];
}
