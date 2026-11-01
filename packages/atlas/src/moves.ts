import { coveredByAny } from "./schema.ts";
import type { AtlasEdge, AtlasMachine } from "./schema.ts";

/**
 * Walking the drawn graph by hand: no actor runs. A path is the edges taken
 * from the initial state, each with the state it led to. Guards are not
 * evaluated, so a path shows what the declarations allow, not what a run does.
 */
export interface ExploreStep {
  edge: string;
  to: string;
}

/**
 * `input`: sent from outside. `effect`: sent by an effect of the current
 * state (its `sends` list). `internal`: any other internal event (another
 * actor, a timer the effect did not declare, a test injecting it).
 */
export type MoveGroup = "input" | "effect" | "internal";

export interface Move {
  edge: AtlasEdge;
  /** States this edge can lead to; several for an undetermined edge, none when unknown. */
  targets: string[];
  group: MoveGroup;
  /** Effects of the current state whose `sends` list this event. */
  sentBy: string[];
}

const GROUP_ORDER: Record<MoveGroup, number> = { input: 0, effect: 1, internal: 2 };

function targetsOf(edge: AtlasEdge, current: string): string[] {
  if (edge.kind === "stay") return [current];
  if (edge.to !== null) return [edge.to];
  if (edge.explanation?.status !== "analyzed") return [];
  const targets = edge.explanation.branches.flatMap((branch) => {
    if (branch.target.kind === "state") return [branch.target.state];
    return branch.target.kind === "stay" ? [current] : [];
  });
  return [...new Set(targets)].sort();
}

function sendersOf(machine: AtlasMachine, state: string): Map<string, string[]> {
  const senders = new Map<string, string[]>();
  const effects = machine.states.find((each) => each.id === state)?.effects ?? [];
  for (const effect of effects) {
    for (const sent of effect.sends ?? []) {
      senders.set(sent, [...(senders.get(sent) ?? []), effect.name]);
    }
  }
  return senders;
}

/**
 * Every edge an event can take out of `state`: its own registrations and the
 * `onAny` ones. A final state has none: the actor has stopped.
 */
export function movesFrom(machine: AtlasMachine, state: string): Move[] {
  const current = machine.states.find((each) => each.id === state);
  if (current === undefined || current.final) return [];
  const internal = new Set(machine.events.filter((each) => each.internal).map((each) => each.id));
  const senders = sendersOf(machine, state);
  return machine.edges
    .filter(
      (edge) =>
        (edge.kind === "transition" || edge.kind === "stay") &&
        (edge.from === state || coveredByAny(edge.from, state)),
    )
    .map((edge): Move => {
      const sentBy = senders.get(edge.event) ?? [];
      const group: MoveGroup = !internal.has(edge.event)
        ? "input"
        : sentBy.length > 0
          ? "effect"
          : "internal";
      return { edge, targets: targetsOf(edge, state), group, sentBy };
    })
    .sort(
      (left, right) =>
        GROUP_ORDER[left.group] - GROUP_ORDER[right.group] ||
        left.edge.event.localeCompare(right.edge.event) ||
        left.edge.id.localeCompare(right.edge.id),
    );
}

/** Where a path ends: the last step's target, or the initial state. */
export function stateAfter(machine: AtlasMachine, path: ReadonlyArray<ExploreStep>): string | null {
  return path.at(-1)?.to ?? machine.initial;
}

/** Events an effect of `state` declares in `sends` that no handler in `state` takes. */
export function unhandledSends(
  machine: AtlasMachine,
  state: string,
): Array<{ effect: string; event: string }> {
  const handled = new Set(movesFrom(machine, state).map((move) => move.edge.event));
  const effects = machine.states.find((each) => each.id === state)?.effects ?? [];
  return effects.flatMap((effect) =>
    (effect.sends ?? [])
      .filter((event) => !handled.has(event))
      .map((event) => ({ effect: effect.name, event })),
  );
}

/** One step as text for a URL: the edge id, plus `~target` when the edge has no single target. */
export function encodeStep(machine: AtlasMachine, step: ExploreStep): string {
  const edge = machine.edges.find((each) => each.id === step.edge);
  return edge !== undefined && edge.to === null && edge.kind !== "stay"
    ? `${step.edge}~${step.to}`
    : step.edge;
}

/**
 * Rebuild a path from encoded steps (e.g. `?step=` in a shared link). Stops at
 * the first step the graph does not allow from where the path has got to, so
 * a link from an older document still opens at its last valid point.
 */
export function decodePath(machine: AtlasMachine, encoded: ReadonlyArray<string>): ExploreStep[] {
  const path: ExploreStep[] = [];
  for (const text of encoded) {
    const cut = text.lastIndexOf("~");
    const edgeId = cut === -1 ? text : text.slice(0, cut);
    const from = stateAfter(machine, path);
    const move =
      from === null ? undefined : movesFrom(machine, from).find((each) => each.edge.id === edgeId);
    const to = cut === -1 && move?.targets.length === 1 ? move.targets[0] : text.slice(cut + 1);
    if (move === undefined || to === undefined || !move.targets.includes(to)) break;
    path.push({ edge: edgeId, to });
  }
  return path;
}
