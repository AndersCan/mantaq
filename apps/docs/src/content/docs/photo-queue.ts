/**
 * Photo queue, for the Mantaq docs: a queue that starts one upload actor per photo.
 *
 * Adding a photo starts a child in the `photos` actor map, keyed by the photo's
 * id. Each child sends its own photo: it can be confirmed, fail, and retry.
 * Clearing the queue removes every child.
 */
import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { createActorMap } from "@mantaq/sugar";

/** The queue has no photos. */
const showingEmptyQueue = state("showingEmptyQueue")();
/** The queue has photos. */
const showingQueue = state("showingQueue")();

/** The photo is being sent. */
const sendingPhoto = state("sendingPhoto")();
/** The photo failed to send and waits for a retry. */
const waitingForRetry = state("waitingForRetry")();
/** The photo was sent. */
const photoSent = state("photoSent")().final();

/** A photo was added to the queue. */
const photoAdded = event("photoAdded")<{ photoId: string }>();
/** The queue was cleared. */
const queueCleared = event("queueCleared")();
/** The server confirmed the upload. */
const uploadConfirmed = event("uploadConfirmed")();
/** The upload failed. */
const uploadFailed = event("uploadFailed")();
/** The retry button was pressed. */
const retryPressed = event("retryPressed")();

function createPhotoActor(clock: VirtualClock) {
  return Actor({
    clock,
    inputs: [uploadConfirmed, uploadFailed, retryPressed],
    states: [sendingPhoto, waitingForRetry, photoSent],
    initial: sendingPhoto,
    setup: (m) => {
      /** The server confirmed, so the photo is sent. */
      m.on(sendingPhoto, {
        event: uploadConfirmed,
        to: [photoSent],
        handler: () => ({ state: photoSent }),
      });
      /** The upload failed, so the photo waits for a retry. */
      m.on(sendingPhoto, {
        event: uploadFailed,
        to: [waitingForRetry],
        handler: () => ({ state: waitingForRetry }),
      });
      /** Retry sends the photo again. */
      m.on(waitingForRetry, {
        event: retryPressed,
        to: [sendingPhoto],
        handler: () => ({ state: sendingPhoto }),
      });
    },
  });
}

export function createPhotoQueueActor(options: { clock?: VirtualClock } = {}) {
  const { clock = VirtualClock() } = options;
  const photos = createActorMap((_photoId: string) => createPhotoActor(clock));
  const actor = Actor({
    clock,
    inputs: [photoAdded, queueCleared],
    states: [showingEmptyQueue, showingQueue],
    initial: showingEmptyQueue,
    setup: (m) => {
      /** The first photo starts the queue. */
      m.on(showingEmptyQueue, {
        event: photoAdded,
        to: [showingQueue],
        handler: (added) => {
          photos.ensure(added.payload.photoId);
          return { state: showingQueue };
        },
      });
      /** Another photo joins the queue. */
      m.on(showingQueue, {
        event: photoAdded,
        handler: (added) => {
          photos.ensure(added.payload.photoId);
          return {};
        },
      });
      /** Clearing the queue removes every photo's actor. */
      m.on(showingQueue, {
        event: queueCleared,
        to: [showingEmptyQueue],
        handler: () => {
          for (const key of photos.keys()) photos.kill(key);
          return { state: showingEmptyQueue };
        },
      });
    },
  });
  return { actor, photos };
}
