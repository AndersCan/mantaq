/** A screen for the design page: its upload part reports a failure that nothing in the machine takes, to show the out arrow in the system view. */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

const showingScreen = state("showingScreen")();
const showingPhoto = state("showingPhoto")().final();
const waiting = state("waiting")();
const sending = state("sending")();

const photoPicked = event("photoPicked")();
const uploadFailed = event("uploadFailed")();
const photoUploaded = event("photoUploaded")();

export function createOutArrowActor({ clock = VirtualClock() }: { clock?: VirtualClock } = {}) {
  const upload = Actor({
    clock,
    inputs: [photoPicked],
    outputs: [photoUploaded, uploadFailed],
    states: [waiting, sending],
    initial: waiting,
    setup: (m) => {
      m.on(waiting, {
        event: photoPicked,
        to: [sending],
        handler: () => ({ state: sending, emit: [photoUploaded.create(), uploadFailed.create()] }),
      });
    },
  });
  return Actor({
    clock,
    inputs: [],
    internal: [photoUploaded, uploadFailed],
    states: [showingScreen, showingPhoto],
    initial: showingScreen,
    regions: { upload },
    setup: (m) => {
      m.on(showingScreen, {
        event: photoUploaded,
        to: [showingPhoto],
        handler: () => ({ state: showingPhoto }),
      });
    },
  });
}
