import type { VizActorRef, VizLiveState, VizMachine } from "../schema.ts";
/**
 * The events to offer as buttons for a compartment: what it handles, plus the
 * inputs nothing else handles (so a declared input with no handler still shows).
 */
export declare function offeredEvents(
  machine: VizMachine,
  compartment: string,
  handled: ReadonlyArray<string>,
): string[];
/** The actor a step in `compartment` goes to; none for the machine itself. */
export declare function actorOf(compartment: string): {
  actor?: VizActorRef;
};
/** The URL/DOM text of an actor ref: "" for the machine itself. */
export declare function actorText(actor: VizActorRef | undefined): string;
/** Region paths of a live state, sorted. */
export declare function regionPaths(state: VizLiveState): string[];
/** Every state the actor is in: the machine's own, each region's, then each map child's. */
export declare function currentsOf(
  state: VizLiveState,
  picked?: {
    map: string;
    key: string;
  } | null,
): string[];
/** Name of a state inside its region. */
export declare function localName(id: string): string;
