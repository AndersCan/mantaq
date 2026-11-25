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
import { childWhoText } from "./explore.ts";

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
    who = childWhoText(machine, { map: scope, key: child.key });
  } else {
    current = at.live.regions[scope];
    who = scope;
  }
  if (current === undefined) return null;
  return leavesElsewhere(machine, { edge, current, who }) ?? null;
}

export interface ElsewhereOptions {
  edge: VizEdge;
  /** The state the part is in now. */
  current: string;
  /** How the sentence names the part. */
  who: string;
}

/** Why `edge` cannot be sent from `current`; undefined when it leaves `current`. */
export function leavesElsewhere(
  machine: VizMachine,
  options: ElsewhereOptions,
): string | undefined {
  const { edge, current, who } = options;
  if (movesFrom(machine, current).some((move) => move.edge.id === edge.id)) return undefined;
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
 * took the walk to another state than the one drawn: the reason names where it goes. A stay on an
 * arrow that points elsewhere is a lock too, naming where the walk stays. null = not blocked.
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
  if (paths.length === 0) return staysElsewhere(edge, outcome);
  return `${edge.event} is blocked: ${paths.map((path) => `${path} is ${valueAt(live, path)}`).join(", ")}`;
}

function staysElsewhere(edge: VizEdge, outcome: VizLiveStep): string | null {
  if (edge.to === null || edge.to === outcome.from || outcome.error !== null) return null;
  return `${edge.event} stays in ${localName(outcome.from)}, not ${localName(edge.to)}`;
}

function takes(edge: VizEdge, outcome: VizLiveStep | null): boolean {
  return (
    outcome !== null &&
    outcome.outcome === "transition" &&
    (edge.to === null || outcome.to === edge.to)
  );
}

type Asked = {
  asked: Map<string, VizStep>;
  arrows: Array<{ edge: VizEdge; keys: string[]; defaultKey: string }>;
};

/** Every distinct step to try, and per transition arrow the keys of its candidates. */
function askedArrows(
  machine: VizMachine,
  from: {
    currents: ReadonlyArray<string>;
    candidatesOf: (edge: VizEdge) => ReadonlyArray<VizJson>;
    defaultOf: (edge: VizEdge) => VizJson;
    actorOf: (edge: VizEdge) => VizActorRef | undefined | "none";
  },
): Asked {
  const asked = new Map<string, VizStep>();
  const arrows: Array<{ edge: VizEdge; keys: string[]; defaultKey: string }> = [];
  for (const { edge } of from.currents.flatMap((current) => movesFrom(machine, current))) {
    const actor = from.actorOf(edge);
    if (edge.kind !== "transition" || actor === "none") continue;
    if (sentByParts(machine, edge).length > 0) continue;
    const ask = (payload: VizJson): string => {
      const key = JSON.stringify([edge.event, actor ?? null, payload]);
      const step: VizStep = {
        kind: "event",
        event: edge.event,
        payload,
        ...(actor === undefined ? {} : { actor }),
      };
      asked.set(key, asked.get(key) ?? step);
      return key;
    };
    const keys = from.candidatesOf(edge).map(ask);
    arrows.push({ edge, keys, defaultKey: ask(from.defaultOf(edge)) });
  }
  return { asked, arrows };
}

/**
 * Per transition arrow out of `currents`: the first candidate payload `dryRun` says takes it (the
 * arrow's `chosen` payload), and, when none does, the default's reason (`blocked`). Each distinct
 * (event, actor, payload) is tried once on a throwaway copy; a throw blocks nothing and chooses nothing.
 */
export function blockedEdges(
  machine: VizMachine,
  from: {
    live: VizLiveState;
    /** The payloads a click on an arrow may send, in the order they are tried. */
    candidatesOf: (edge: VizEdge) => ReadonlyArray<VizJson>;
    /** The payload an arrow sends when no candidate takes it; its outcome gives the lock reason. */
    defaultOf: (edge: VizEdge) => VizJson;
    currents: ReadonlyArray<string>;
    dryRun: (steps: ReadonlyArray<VizStep>) => Array<VizLiveStep | null>;
    actorOf: (edge: VizEdge) => VizActorRef | undefined | "none";
  },
): { blocked: Map<string, string>; chosen: Map<string, VizJson> } {
  const { asked, arrows } = askedArrows(machine, from);
  const blocked = new Map<string, string>();
  const chosen = new Map<string, VizJson>();
  const order = [...asked.keys()];
  try {
    const outcomes = from.dryRun([...asked.values()]);
    const outcomeOf = (key: string | undefined): VizLiveStep | null =>
      key === undefined ? null : (outcomes[order.indexOf(key)] ?? null);
    for (const { edge, keys, defaultKey } of arrows) {
      const taken = keys.find((each) => takes(edge, outcomeOf(each)));
      const step = asked.get(taken ?? defaultKey);
      if (step?.kind === "event") chosen.set(edge.id, step.payload);
      if (taken !== undefined) continue;
      const outcome = outcomeOf(defaultKey);
      const reason = blockedReason({ edge, outcome, live: from.live.context });
      if (reason !== null) blocked.set(edge.id, reason);
    }
  } catch {
    return { blocked: new Map(), chosen: new Map() };
  }
  return { blocked, chosen };
}
