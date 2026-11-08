import { Actor, VirtualClock, event, state } from "@mantaq/core";

/** The upload screen is showing. */
const showingUploadScreen = state("showingUploadScreen")();
/** The uploaded photo is showing. */
const showingUploadedPhoto = state("showingUploadedPhoto")().final();

/** The upload region waits for a photo. */
const waitingForPhoto = state("waitingForPhoto")();
/** The upload region is sending the photo. */
const sendingPhoto = state("sendingPhoto")();
/** The photo was sent. */
const photoSent = state("photoSent")().final();

/** The network region is online. */
const online = state("online")();
/** The network region is offline. */
const offline = state("offline")();

/** A photo was picked. */
const photoPicked = event("photoPicked")<{ fileName: string }>();
/** The server confirmed the upload. */
const uploadConfirmed = event("uploadConfirmed")();
/** The connection was lost. */
const connectionLost = event("connectionLost")();
/** The connection came back. */
const connectionRestored = event("connectionRestored")();
/** The photo was uploaded (the upload region tells the screen). */
const photoUploaded = event("photoUploaded")();

export function createUploadRegionsActor({ clock = VirtualClock() } = {}) {
  const upload = Actor({
    clock,
    inputs: [photoPicked, uploadConfirmed],
    outputs: [photoUploaded],
    states: [waitingForPhoto, sendingPhoto, photoSent],
    initial: waitingForPhoto,
    setup: (m) => {
      m.on(waitingForPhoto, {
        event: photoPicked,
        to: [sendingPhoto],
        handler: () => ({ state: sendingPhoto }),
      });
      m.on(sendingPhoto, {
        event: uploadConfirmed,
        to: [photoSent],
        handler: () => ({ state: photoSent, emit: [photoUploaded.create()] }),
      });
    },
  });
  const network = Actor({
    clock,
    inputs: [connectionLost, connectionRestored],
    states: [online, offline],
    initial: online,
    setup: (m) => {
      m.on(online, {
        event: connectionLost,
        to: [offline],
        handler: () => ({ state: offline }),
      });
      m.on(offline, {
        event: connectionRestored,
        to: [online],
        handler: () => ({ state: online }),
      });
    },
  });
  return Actor({
    clock,
    inputs: [],
    internal: [photoUploaded],
    states: [showingUploadScreen, showingUploadedPhoto],
    initial: showingUploadScreen,
    regions: { upload, network },
    setup: (m) => {
      m.on(showingUploadScreen, {
        event: photoUploaded,
        to: [showingUploadedPhoto],
        handler: () => ({ state: showingUploadedPhoto }),
      });
    },
  });
}
