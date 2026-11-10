/**
 * Photo queue, for the Mantaq docs: a queue that starts one upload actor per photo.
 *
 * Adding a photo starts a child in the `photos` actor map, keyed by the photo's
 * id. Each child sends its own photo: it can be confirmed, fail, and retry.
 * Clearing the queue removes every child.
 */
import { Actor, VirtualClock } from "@mantaq/core";
export declare function createPhotoQueueActor(options?: { clock?: VirtualClock }): {
  actor: Actor<
    readonly [
      import("@mantaq/core").StateRef<"showingEmptyQueue", unknown, false>,
      import("@mantaq/core").StateRef<"showingQueue", unknown, false>,
    ],
    readonly [
      import("@mantaq/core").EventRef<
        "photoAdded",
        {
          /** @example p1 */
          photoId: string;
        }
      >,
      import("@mantaq/core").EventRef<"queueCleared", void>,
    ],
    readonly [],
    readonly [],
    Record<string, unknown>
  >;
  photos: import("@mantaq/sugar").ActorMap;
};
