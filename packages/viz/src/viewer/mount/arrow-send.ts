import { arrowCandidates, payloadFor } from "../fill.ts";
import { blockedEdges, sentByParts, whyNotHere } from "../blocked.ts";
import { currentsOf, walkedChild } from "../compartments.ts";
import type { PickedChild, ViewState } from "./view-state.ts";
import type { VizActorRef, VizDriver, VizEdge, VizLiveState, VizMachine } from "../../schema.ts";
import { movesFrom } from "../../moves.ts";
import { scopeOf } from "../../schema.ts";

export type ArrowSend =
  | { kind: "send"; actor: VizActorRef | undefined }
  | { kind: "refuse"; text: string }
  | { kind: "elsewhere"; text: string }
  | { kind: "none" };

export interface ArrowSendContext {
  machine: VizMachine;
  view: ViewState;
  driver: VizDriver | undefined;
}

/** What a click on this arrow does: the one decision Details and the diagram share. */
export function arrowSend(from: ArrowSendContext, edge: VizEdge): ArrowSend {
  const { machine, view } = from;
  if (view.live === null) return { kind: "none" };
  if (edge.kind !== "transition" && edge.kind !== "stay") return { kind: "none" };
  const senders = sentByParts(machine, edge);
  if (senders.length > 0) {
    const named = senders.join(" and ");
    return { kind: "refuse", text: `${edge.event} is sent by ${named}, not by hand.` };
  }
  const why = whyNotHere(machine, edge, { live: view.live, picked: view.picked });
  if (why !== null) return { kind: "elsewhere", text: why };
  updateBlocked(view, { machine, driver: from.driver });
  const reason = view.blocked.get(edge.id);
  if (reason !== undefined) return { kind: "refuse", text: reason };
  const actor = actorOf(machine, { edge, state: view.live, picked: view.picked });
  if (actor === "none") return { kind: "none" };
  const sendable = currentsOf(view.live, view.picked).some((current) =>
    movesFrom(machine, current).some((move) => move.edge.id === edge.id),
  );
  return sendable ? { kind: "send", actor } : { kind: "none" };
}

interface ActorOfOptions {
  edge: VizEdge;
  state: VizLiveState | null;
  picked: PickedChild | null;
}

/** Who an edge click sends to: the walked child; "none" = the map has no child. */
function actorOf(machine: VizMachine, live: ActorOfOptions): VizActorRef | undefined | "none" {
  const region = scopeOf(live.edge.from);
  if (machine.maps.includes(region)) {
    const target = live.state === null ? undefined : walkedChild(live.state, region, live.picked);
    return target === undefined ? "none" : { map: target.map, key: target.key };
  }
  return region === "" ? undefined : { region };
}

function sameBlocked(asked: NonNullable<ViewState["blockedFor"]>, view: ViewState): boolean {
  return (
    asked.live === view.live &&
    asked.values === view.values &&
    asked.picked?.map === view.picked?.map &&
    asked.picked?.key === view.picked?.key
  );
}

export interface UpdateBlockedOptions {
  machine: VizMachine;
  driver: VizDriver | undefined;
}

/** Recomputes the blocked arrows when the live state or the picked child changed; no `dryRun` blocks nothing. */
export function updateBlocked(view: ViewState, options: UpdateBlockedOptions): void {
  const { machine, driver } = options;
  const { live, blockedFor } = view;
  if (live === null || driver?.dryRun === undefined) {
    view.blocked = new Map();
    view.chosen = new Map();
    view.blockedFor = undefined;
    return;
  }
  if (blockedFor !== undefined && sameBlocked(blockedFor, view)) return;
  view.blockedFor = { live, picked: view.picked, values: view.values };
  function actorFor(edge: VizEdge): VizActorRef | undefined | "none" {
    return actorOf(machine, { edge, state: live, picked: view.picked });
  }
  const found = blockedEdges(machine, {
    live,
    currents: currentsOf(live, view.picked),
    defaultOf: (edge) =>
      payloadFor(machine, edge.event, { set: view.values, live, afters: view.afters }),
    candidatesOf: (edge) => {
      const actor = actorFor(edge);
      return arrowCandidates(machine, edge, {
        set: view.values,
        live,
        afters: view.afters,
        actor: actor === "none" ? undefined : actor,
      });
    },
    dryRun: (steps) => driver.dryRun?.(steps) ?? [],
    actorOf: actorFor,
  });
  view.blocked = found.blocked;
  view.chosen = found.chosen;
}
