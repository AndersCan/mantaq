import { payloadSamples, movesFrom } from "../moves.ts";
import type {
  VizActorRef,
  VizEdge,
  VizJson,
  VizLiveState,
  VizLiveStep,
  VizMachine,
  VizStep,
} from "../schema.ts";
import { knownPayload } from "./fill.ts";

/**
 * What a dry run sends for `event`: the form's example values, never the last value sent, so a
 * payload-only guard does not block the arrow. null when the event takes no data.
 */
export function examplePayload(machine: VizMachine, event: string): VizJson {
  const fields = machine.events.find((each) => each.id === event)?.payload ?? null;
  const samples = payloadSamples(machine, event);
  return knownPayload(fields, { event, samples, steps: [] })?.payload ?? null;
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
 * Why a transition arrow is blocked: its handler, tried with the example payload, stayed put
 * (or threw), and it reads the context. The reason names those context values. null = not
 * blocked, including when only the payload could be the cause. A handler that reads both and
 * fails on its example payload is drawn blocked with the context values as the reason; give the
 * field an `@example` that passes to fix it.
 */
export function blockedReason(context: {
  edge: VizEdge;
  outcome: VizLiveStep | null;
  live: VizJson;
}): string | null {
  const { edge, outcome, live } = context;
  if (edge.kind !== "transition" || outcome === null) return null;
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
    currents: ReadonlyArray<string>;
    dryRun: (steps: ReadonlyArray<VizStep>) => Array<VizLiveStep | null>;
    actorOf: (edge: VizEdge) => VizActorRef | undefined | "none";
  },
): Map<string, string> {
  const asked = new Map<string, { step: VizStep; edges: VizEdge[] }>();
  for (const { edge } of from.currents.flatMap((current) => movesFrom(machine, current))) {
    const actor = from.actorOf(edge);
    if (edge.kind !== "transition" || actor === "none") continue;
    const key = JSON.stringify([edge.event, actor ?? null]);
    const step: VizStep = {
      kind: "event",
      event: edge.event,
      payload: examplePayload(machine, edge.event),
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
