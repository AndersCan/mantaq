import type { VizActorRef, VizLiveState, VizMachine } from "../../../schema.ts";
import type { EnteredText } from "../../explore.ts";
import type { Focus } from "../focus.ts";
import { isNever } from "../../../is-never.ts";
import { scopeOf } from "../../../schema.ts";

/** An entered machine that runs now: the root is in the state that embeds it, and the driver knows the child's state. */
export interface EnteredRun {
  /** The root machine: every step goes to it. */
  parent: VizMachine;
  /** The entered machine, whose arrows the canvas draws. */
  machine: VizMachine;
  /** Inputs of the root that embed sends on to the child, from the embedding state of the document. */
  forward: ReadonlyArray<string>;
  /** The child's current state id. */
  current: string;
  /** Where a forwarded event goes: the region or returned machine that holds the embedding state; undefined = the root. */
  actor: VizActorRef | undefined;
}

/** How the walk shows on the canvas: the root's own walk, an entered machine that runs, or one drawn without its state. */
export type EnteredWalk =
  | { kind: "root" }
  | { kind: "running"; run: EnteredRun }
  | { kind: "static"; note: string | undefined };

export interface EnteredWalkOptions {
  root: VizMachine;
  live: VizLiveState | null;
}

interface Embedding {
  root: VizMachine;
  child: VizMachine;
  /** The root's state that embeds the child, as the root's diagram names it. */
  state: string;
}

function staticWalk(note: string | undefined): EnteredWalk {
  return { kind: "static", note };
}

/** What the canvas walks for the focus path: an entered machine runs only one level in, while the root is in the state that embeds it. */
export function enteredWalk(focus: Focus, options: EnteredWalkOptions): EnteredWalk {
  const { root, live } = options;
  const entered: string[] = [];
  for (const step of focus.steps) {
    if (step.kind === "enter") entered.push(step.state);
  }
  const [state] = entered;
  if (state === undefined) return { kind: "root" };
  const child = focus.machine;
  if (live === null) return staticWalk(undefined);
  if (entered.length > 1) {
    return staticWalk(
      `${child.id} is shown without its state: only a machine that ${root.id} embeds runs live here.`,
    );
  }
  return runningWalk({ root, child, state }, live);
}

/** Why the root's live state shows no embed entry for the entered machine: the root left the state, or the child ended. */
function goneNote(embedding: Embedding, live: VizLiveState): string {
  const { root, child, state } = embedding;
  const scope = scopeOf(state);
  const now = scope === "" ? live.state : (live.regions[scope] ?? "another state");
  if (now === state) return `${child.id} ended, so it is shown without its state.`;
  return `${child.id} runs only while ${root.id} is in ${state}. It is in ${now} now, so ${child.id} is shown without its state.`;
}

/** Why an entered machine one level in is drawn without its state, or the run that it is. */
function runningWalk(embedding: Embedding, live: VizLiveState): EnteredWalk {
  const { root, child, state } = embedding;
  const scope = scopeOf(state);
  if (root.maps.includes(scope)) {
    return staticWalk(
      `${child.id} is shown without its state: the children of ${scope} embed it, and their machines do not run live here.`,
    );
  }
  if (live.embeds === undefined) {
    return staticWalk(
      `${child.id} is shown without its state: the driver does not report the machines that ${root.id} embeds.`,
    );
  }
  const found = live.embeds.find((each) => each.state === state);
  if (found === undefined) return staticWalk(goneNote(embedding, live));
  const { current } = found;
  if (current === undefined) {
    return staticWalk(
      `${child.id} is shown without its state: ${root.id} does not say where it keeps the snapshot of ${child.id} (the embed option keep).`,
    );
  }
  const forward = root.states.find((each) => each.id === state)?.forward ?? [];
  const actor = scope === "" ? undefined : { region: scope };
  return { kind: "running", run: { parent: root, machine: child, forward, current, actor } };
}

/** What the Step tab says for the walk: nothing extra at the root. */
export function enteredText(walk: EnteredWalk, root: VizMachine): EnteredText | undefined {
  switch (walk.kind) {
    case "root":
      return undefined;
    case "running": {
      const { machine } = walk.run;
      return {
        empty: `No steps yet. Click an arrow of ${machine.id} that ${root.id} forwards to send its event. Its ? opens Details, where you can change what it sends.`,
        note: undefined,
      };
    }
    case "static":
      return {
        empty: `No steps yet. The arrows of a machine shown without its state send nothing. Go back to ${root.id} and click an arrow there.`,
        note: walk.note,
      };
    default:
      return isNever(walk);
  }
}
