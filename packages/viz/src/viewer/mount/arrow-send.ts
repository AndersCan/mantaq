import { arrowCandidates, payloadFor } from "../fill.ts";
import { blockedEdges, leavesElsewhere, sentByParts, whyNotHere } from "../blocked.ts";
import { currentsOf, walkedChild } from "../compartments.ts";
import type { EnteredRun, EnteredWalk } from "./entered/entered-walk.ts";
import type { PickedChild, ViewState } from "./view-state.ts";
import type {
  VizActorRef,
  VizDriver,
  VizEdge,
  VizJson,
  VizLiveState,
  VizMachine,
} from "../../schema.ts";
import { changedFields } from "../send/payloads.ts";
import { isNever } from "../../is-never.ts";
import { movesFrom } from "../../moves.ts";
import { scopeOf } from "../../schema.ts";

/** `send` also covers a blocked arrow: the click sends, and `blocked` says why the guard will not take the arrow. */
export type ArrowSend =
  | { kind: "send"; actor: VizActorRef | undefined; blocked: string | undefined }
  | { kind: "refuse"; text: string }
  | { kind: "elsewhere"; text: string }
  | { kind: "none" };

export interface ArrowSendContext {
  /** The machine whose arrows are clicked: the root, or the entered machine of `entered`. */
  machine: VizMachine;
  view: ViewState;
  driver: VizDriver | undefined;
  /** Set when the arrows are those of an entered machine that runs: its events go to the root through `forward`. */
  entered?: EnteredRun;
}

/** Whether a click on an entered machine's arrow sends: only a forwarded event from the child's current state does. */
function enteredSend(run: EnteredRun, edge: VizEdge): ArrowSend {
  if (edge.kind !== "transition" && edge.kind !== "stay") return { kind: "none" };
  const { machine, current, forward, parent } = run;
  const elsewhere = leavesElsewhere(machine, { edge, current, who: machine.id });
  if (elsewhere !== undefined) return { kind: "elsewhere", text: elsewhere };
  if (forward.includes(edge.event)) {
    return { kind: "send", actor: run.actor, blocked: undefined };
  }
  const internal = machine.events.some((event) => event.id === edge.event && event.internal);
  if (internal) {
    return {
      kind: "refuse",
      text: `${edge.event} is internal to ${machine.id}: only ${machine.id} sends it.`,
    };
  }
  const listed = forward.join(", ");
  const forwarded = forward.length === 0 ? "it forwards no events" : `it forwards ${listed}`;
  return {
    kind: "refuse",
    text: `${edge.event} can't be sent: ${parent.id} does not forward it to ${machine.id}; ${forwarded}.`,
  };
}

/** Edge id → why a click does not send it, for each arrow out of the entered machine's current state that the parent does not forward. */
export function notForwarded(run: EnteredRun): Map<string, string> {
  const refused = new Map<string, string>();
  for (const move of movesFrom(run.machine, run.current)) {
    const decision = enteredSend(run, move.edge);
    if (decision.kind === "refuse") refused.set(move.edge.id, decision.text);
  }
  return refused;
}

/** The states the clicked machine is in now: the entered machine's one, else every state of the root's walk. */
export function currentsFor(from: ArrowSendContext): string[] {
  const { view, entered } = from;
  if (entered !== undefined) return [entered.current];
  return view.live === null ? [] : currentsOf(view.live, view.picked);
}

/** Why the guard blocks the arrow now; undefined when it does not, or for an entered machine, whose arrows are not dry run. */
export function arrowLock(from: ArrowSendContext, edge: VizEdge): string | undefined {
  return from.entered === undefined ? from.view.blocked.get(edge.id) : undefined;
}

/** Where a click on an arrow sends from: the root's walk, an entered machine that runs, or nowhere for a machine drawn without its state. */
export function arrowContextOf(
  walk: EnteredWalk,
  root: ArrowSendContext,
): ArrowSendContext | undefined {
  switch (walk.kind) {
    case "root":
      return root;
    case "running":
      return { ...root, machine: walk.run.machine, entered: walk.run };
    case "static":
      return undefined;
    default:
      return isNever(walk);
  }
}

/** Whether a click on this arrow sends: the one decision Details and the diagram share. */
export function arrowSend(from: ArrowSendContext, edge: VizEdge): ArrowSend {
  const { machine, view } = from;
  if (view.live === null) return { kind: "none" };
  if (from.entered !== undefined) return enteredSend(from.entered, edge);
  if (edge.kind !== "transition" && edge.kind !== "stay") return { kind: "none" };
  const senders = sentByParts(machine, edge);
  if (senders.length > 0) {
    const named = senders.join(" and ");
    return { kind: "refuse", text: `${edge.event} is sent by ${named}, not by hand.` };
  }
  const why = whyNotHere(machine, edge, { live: view.live, picked: view.picked });
  if (why !== null) return { kind: "elsewhere", text: why };
  updateBlocked(view, { machine, driver: from.driver });
  const actor = actorOf(machine, { edge, state: view.live, picked: view.picked });
  if (actor === "none") return { kind: "none" };
  const sendable = currentsOf(view.live, view.picked).some((current) =>
    movesFrom(machine, current).some((move) => move.edge.id === edge.id),
  );
  if (!sendable) return { kind: "none" };
  return { kind: "send", actor, blocked: view.blocked.get(edge.id) };
}

/** The payload a click on `edge` sends: the one its dry run tried, else the event's default with the changed fields. Its send form shows it. */
export function arrowPayload(from: ArrowSendContext, edge: VizEdge): VizJson {
  const { machine, view } = from;
  if (from.entered === undefined) updateBlocked(view, { machine, driver: from.driver });
  const chosen = from.entered === undefined ? view.chosen.get(edge.id) : undefined;
  if (chosen !== undefined) return chosen;
  return payloadFor(machine, edge.event, {
    set: changedFields(view.payloads, { machine: machine.id, event: edge.event }),
    live: view.live,
    afters: view.afters,
  });
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
    asked.payloads === view.payloads &&
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
  view.blockedFor = { live, picked: view.picked, payloads: view.payloads };
  function actorFor(edge: VizEdge): VizActorRef | undefined | "none" {
    return actorOf(machine, { edge, state: live, picked: view.picked });
  }
  const found = blockedEdges(machine, {
    live,
    currents: currentsOf(live, view.picked),
    defaultOf: (edge) =>
      payloadFor(machine, edge.event, {
        set: changedFields(view.payloads, { machine: machine.id, event: edge.event }),
        live,
        afters: view.afters,
      }),
    candidatesOf: (edge) => {
      const actor = actorFor(edge);
      return arrowCandidates(machine, edge, {
        set: changedFields(view.payloads, { machine: machine.id, event: edge.event }),
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
