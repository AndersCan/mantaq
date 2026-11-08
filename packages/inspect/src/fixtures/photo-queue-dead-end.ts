import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { createActorMap } from "@mantaq/sugar";

/** The queue is open. */
const open = state("open")();
/** A photo joined the queue. */
const photoAdded = event("photoAdded")<{ photoId: string }>();
/** The photo is being sent. */
const sendingPhoto = state("sendingPhoto")();
/** The photo is paused and nothing can resume it. */
const pausedPhoto = state("pausedPhoto")();
/** The upload was paused. */
const uploadPaused = event("uploadPaused")();

function createPhoto(clock: VirtualClock) {
  return Actor({
    clock,
    inputs: [uploadPaused],
    states: [sendingPhoto, pausedPhoto],
    initial: sendingPhoto,
    setup: (m) => {
      m.on(sendingPhoto, {
        event: uploadPaused,
        to: [pausedPhoto],
        handler: () => ({ state: pausedPhoto }),
      });
    },
  });
}

/** A queue whose photo upload can pause and never leave the pause. */
export function createPhotoQueueDeadEnd({ clock = VirtualClock() } = {}) {
  const photos = createActorMap(() => createPhoto(clock));
  const actor = Actor({
    clock,
    inputs: [photoAdded],
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
    },
  });
  return { actor, photos };
}
