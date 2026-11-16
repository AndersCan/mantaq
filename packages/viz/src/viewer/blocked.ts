import { movesFrom } from "../moves.ts";
import type {
  VizActorRef,
  VizEdge,
  VizJson,
  VizLiveState,
  VizLiveStep,
  VizMachine,
  VizStep,
} from "../schema.ts";
import { isAnyState, scopeOf } from "../schema.ts";
import { localName, walkedChild } from "./compartments.ts";

/** The parts that send `edge.event` themselves, by name; `[]` means a person may send it. */
export function sentByParts(machine: VizMachine, edge: VizEdge): string[] {
  const scope = scopeOf(edge.from);
  const parts: Array<[string, string[]]> = [
    ["", machine.outputs],
    ...Object.entries(machine.partOutputs),
  ];
  return parts
    .filter(([path, events]) => path !== scope && events.includes(edge.event))
    .map(([path]) => (path === "" ? machine.id : path));
}

/** Why the walk cannot send `edge` where it is now, or null when it can (or is unknown). */
export function whyNotHere(
  machine: VizMachine,
  edge: VizEdge,
  at: { live: VizLiveState; picked: { map: string; key: string } | null },
): string | null {
  const scope = scopeOf(edge.from);
  let current: string | undefined;
  let who = "the walk";
  if (scope === "") {
    current = at.live.state;
  } else if (machine.maps.includes(scope)) {
    const child = walkedChild(at.live, scope, at.picked);
    if (child === undefined) return `${edge.event} can't be sent: ${scope} has no child.`;
    current = child.state;
    who = machine.maps.length > 1 ? `${scope} ${child.key}` : child.key;
  } else {
    current = at.live.regions[scope];
    who = scope;
  }
  if (current === undefined) return null;
  if (movesFrom(machine, current).some((move) => move.edge.id === edge.id)) return null;
  const source = isAnyState(edge.from) ? "any state" : localName(edge.from);
  return `${edge.event} can't be sent: ${who} is in ${localName(current)}, this arrow leaves ${source}.`;
}

/** The value at a dotted path in the live context; "not set" when there is none (the Context tab's word). */
function valueAt(context: VizJson, path: string): string {
  let value: VizJson | undefined = context;
  for (const key of path.split(".")) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return "not set";
    value = Object.hasOwn(value, key) ? value[key] : undefined;
  }
  return value === undefined ? "not set" : (JSON.stringify(value) ?? "not set");
}

function contextPaths(edge: VizEdge): string[] {
  const { explanation } = edge;
  if (explanation === null || explanation.status !== "analyzed") return [];
  const compared = explanation.comparisons
    .filter((each) => each.source === "context")
    .map((each) => each.path);
  return [...new Set(compared.length > 0 ? compared : explanation.contextReads)];
}

/**
 * Why a transition arrow is blocked, tried with the payload Send would send. Its handler stayed
 * put (or threw) and it reads the context: the reason names those context values. Or the guard
 * took the walk to another state than the one drawn: the reason names where it goes. null = not
 * blocked, including when only the payload could be the cause.
 */
export function blockedReason(context: {
  edge: VizEdge;
  outcome: VizLiveStep | null;
  live: VizJson;
}): string | null {
  const { edge, outcome, live } = context;
  if (edge.kind !== "transition" || outcome === null) return null;
  if (edge.to !== null && outcome.outcome === "transition" && outcome.to !== edge.to) {
    return `${edge.event} goes to ${localName(outcome.to)}, not ${localName(edge.to)}`;
  }
  const stayed =
    outcome.outcome === "stay" || (outcome.outcome === "missing" && outcome.error !== null);
  if (!stayed) return null;
  const paths = contextPaths(edge);
  if (paths.length === 0) return null;
  return `${edge.event} is blocked: ${paths.map((path) => `${path} is ${valueAt(live, path)}`).join(", ")}`;
}

/**
 * Edge id → reason for every transition arrow out of `currents` that the live state's guard
 * stops. Each distinct (event, actor) is tried once on a throwaway copy via `dryRun`; a throw
 * blocks nothing.
 */
export function blockedEdges(
  machine: VizMachine,
  from: {
    live: VizLiveState;
    /** The payload Send would send for an event. */
    payloadOf: (event: string) => VizJson;
    currents: ReadonlyArray<string>;
    dryRun: (steps: ReadonlyArray<VizStep>) => Array<VizLiveStep | null>;
    actorOf: (edge: VizEdge) => VizActorRef | undefined | "none";
  },
): Map<string, string> {
  const asked = new Map<string, { step: VizStep; edges: VizEdge[] }>();
  for (const { edge } of from.currents.flatMap((current) => movesFrom(machine, current))) {
    const actor = from.actorOf(edge);
    if (edge.kind !== "transition" || actor === "none") continue;
    if (sentByParts(machine, edge).length > 0) continue;
    const key = JSON.stringify([edge.event, actor ?? null]);
    const step: VizStep = {
      kind: "event",
      event: edge.event,
      payload: from.payloadOf(edge.event),
      ...(actor === undefined ? {} : { actor }),
    };
    const entry = asked.get(key) ?? { step, edges: [] };
    entry.edges.push(edge);
    asked.set(key, entry);
  }
  const blocked = new Map<string, string>();
  const entries = [...asked.values()];
  try {
    const outcomes = from.dryRun(entries.map((each) => each.step));
    entries.forEach(({ edges }, index) => {
      for (const edge of edges) {
        const reason = blockedReason({
          edge,
          outcome: outcomes[index] ?? null,
          live: from.live.context,
        });
        if (reason !== null) blocked.set(edge.id, reason);
      }
    });
  } catch {
    return new Map();
  }
  return blocked;
}
