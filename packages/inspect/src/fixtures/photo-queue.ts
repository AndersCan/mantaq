import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { createActorMap } from "@mantaq/sugar";

/** The queue is open. */
const open = state("open")();

/** A photo joined the queue. */
const photoAdded = event("photoAdded")<{ photoId: string }>();
/** Every photo was removed from the queue. */
const queueCleared = event("queueCleared")();
/** The server confirmed the upload. */
const uploadConfirmed = event("uploadConfirmed")();

/** The photo is being sent. */
const sendingPhoto = state("sendingPhoto")();
/** The photo was sent. */
const photoSent = state("photoSent")().final();

function createPhoto(clock: VirtualClock) {
  return Actor({
    clock,
    inputs: [uploadConfirmed],
    states: [sendingPhoto, photoSent],
    initial: sendingPhoto,
    setup: (m) => {
      m.on(sendingPhoto, {
        event: uploadConfirmed,
        to: [photoSent],
        handler: () => ({ state: photoSent }),
      });
    },
  });
}

/** One photo upload actor per queued photo, kept in the `photos` map. */
export function createPhotoQueue({ clock = VirtualClock() } = {}) {
  const photos = createActorMap(() => createPhoto(clock));
  const actor = Actor({
    clock,
    inputs: [photoAdded, queueCleared],
    states: [open],
    initial: open,
    setup: (m) => {
      m.on(open, {
        event: photoAdded,
        handler: (added) => {
          photos.ensure(added.payload.photoId);
          return {};
        },
      });
      m.on(open, {
        event: queueCleared,
        handler: () => {
          for (const key of photos.keys()) photos.kill(key);
          return {};
        },
      });
    },
  });
  return { actor, photos };
}
