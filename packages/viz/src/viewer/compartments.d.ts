import type { VizActorRef, VizLiveChild, VizLiveState } from "../schema.ts";
/** The URL/DOM text of an actor ref: "" for the machine itself. */
export declare function actorText(actor: VizActorRef | undefined): string;
export declare function compareKeys(a: string, b: string): number;
/** The child a map's diagram shows: the picked one while it exists, else the lowest key. */
export declare function walkedChild(
  state: VizLiveState,
  map: string,
  picked: {
    map: string;
    key: string;
  } | null,
): VizLiveChild | undefined;
/** Every state the actor is in: the machine's own, each region's, then the walked child of each map. */
export declare function currentsOf(
  state: VizLiveState,
  picked?: {
    map: string;
    key: string;
  } | null,
): string[];
/** Name of a state inside its region. */
export declare function localName(id: string): string;
