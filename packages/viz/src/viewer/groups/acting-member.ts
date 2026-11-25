import { arrowMembersOf, realMachineOf } from "./fold-groups.ts";
import type { VizLiveState, VizMachine } from "../../schema.ts";
import { currentsOf } from "../compartments.ts";
import type { Move } from "../../moves.ts";
import { movesFrom } from "../../moves.ts";
import type { Shared } from "../shared.ts";
import { sharedArrowsOf } from "../shared.ts";

export interface RealMembersOptions {
  /** The shared arrows of the drawn machine. */
  shared: Shared;
  /** The drawn arrow's id. */
  arrow: string;
}

/** The real edge ids a drawn arrow stands for: a shared arrow's members, each group arrow among them by its own real members; an edge alone is itself. */
export function realMembersOf(drawn: VizMachine, options: RealMembersOptions): string[] {
  const { shared, arrow } = options;
  const sharedArrow = shared.arrows.find((each) => each.id === arrow);
  const ids = sharedArrow === undefined ? [arrow] : sharedArrow.members.map((member) => member.id);
  const real: string[] = [];
  for (const id of ids) {
    const found = arrowMembersOf(drawn, { arrow: id });
    real.push(...(found.length === 0 ? [id] : found.map((member) => member.id)));
  }
  return real;
}

export interface ActingMemberOptions {
  /** The moves the walk can take now, on the real machine. */
  moves: ReadonlyArray<Move>;
  /** Edge id → why its guard blocks it. */
  blocked: ReadonlyMap<string, string>;
  /** The walk's current real states. */
  currents: ReadonlyArray<string>;
  /** Real edge id → its source state. */
  sources: ReadonlyMap<string, string>;
}

/**
 * The real edge a drawn arrow acts as now, the one answer the marks and a click
 * share: a member the walk can take that no guard blocks, else one it can take,
 * else one that leaves a current state; undefined when none leaves it.
 */
export function actingMember(
  members: ReadonlyArray<string>,
  options: ActingMemberOptions,
): string | undefined {
  const { moves, blocked, currents, sources } = options;
  const taken = new Set<string>();
  for (const move of moves) taken.add(move.edge.id);
  const open = members.find((member) => taken.has(member) && !blocked.has(member));
  const takenMember = members.find((member) => taken.has(member));
  const leaving = members.find((member) => currents.includes(sources.get(member) ?? ""));
  return open ?? takenMember ?? leaving;
}

/** Where the walk is now, as the viewer holds it. */
interface WalkNow {
  /** Unset without a driver: no walk. */
  live: VizLiveState | null;
  picked: { map: string; key: string } | null;
  /** Edge id → why its guard blocks it. */
  blocked: ReadonlyMap<string, string>;
}

export interface ActingNowOptions {
  walk: WalkNow;
  /** The drawn arrow's id. */
  arrow: string;
}

/** The real edge a drawn arrow of `drawn` acts as now (see `actingMember`); undefined without a walk, or when none of its members leaves a current state. The marks, a click and a `?` ask this one function. */
export function actingMemberOf(drawn: VizMachine, options: ActingNowOptions): string | undefined {
  const { walk, arrow } = options;
  if (walk.live === null) return undefined;
  const real = realMachineOf(drawn);
  const currents = currentsOf(walk.live, walk.picked);
  const moves = currents.flatMap((current) => movesFrom(real, current));
  const members = realMembersOf(drawn, { shared: sharedArrowsOf(drawn), arrow });
  const sources = new Map(real.edges.map((edge) => [edge.id, edge.from]));
  return actingMember(members, { moves, blocked: walk.blocked, currents, sources });
}
