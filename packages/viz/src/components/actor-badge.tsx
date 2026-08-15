/**
 * ActorBadge — identity + status chip (specs/actor-badge.md).
 *
 * - status: running / error / done (from `snapshot.error` / `snapshot.done`),
 * - stats: `N states · N events · N effects · N regions` — derived from the
 *   graph model, never from DOM counting,
 * - the badge is a static snapshot of the actor passed in; wrap in
 *   <VizProvider> if live updates are wanted (the composite does that).
 */

import type { ReactNode } from "react";
import type { AnyActor } from "@mantaq/core";
import { buildVizGraph } from "../core/index.ts";

export interface ActorBadgeProps {
  actor: AnyActor;
  /** Display name (defaults to the actor name). */
  name?: string;
  /** Show the stats line. Default true. */
  showStats?: boolean;
}

function toStats(actor: AnyActor): {
  status: "running" | "error" | "done";
  states: number;
  events: number;
  effects: number;
  regions: number;
} {
  const snapshot = actor.snapshot();
  const status = snapshot.error !== undefined ? "error" : snapshot.done ? "done" : "running";

  const result = buildVizGraph(actor);
  if (result.status === "error") {
    return { status, states: 0, events: 0, effects: 0, regions: 0 };
  }
  const { graph } = result;
  const states = graph.nodes.filter((node) => node.kind === "state").length;
  const events = new Set(graph.edges.map((edge) => edge.label)).size;
  const effects = graph.nodes.reduce(
    (sum, node) => sum + node.effects.reduce((s, e) => s + e.count, 0),
    0,
  );
  const regions = graph.groups.length - 1; // minus root group
  return { status, states, events, effects, regions };
}

export function ActorBadge({ actor, name, showStats = true }: ActorBadgeProps): ReactNode {
  const stats = toStats(actor);
  return (
    <div className="mtq-actor-badge" data-status={stats.status}>
      <span className="mtq-actor-badge__dot" aria-hidden="true" />
      <span className="mtq-actor-badge__name">{name ?? "actor"}</span>
      {showStats ? (
        <span className="mtq-actor-badge__stats">
          {stats.states} states · {stats.events} events · {stats.effects} effects · {stats.regions}{" "}
          regions
        </span>
      ) : null}
    </div>
  );
}
