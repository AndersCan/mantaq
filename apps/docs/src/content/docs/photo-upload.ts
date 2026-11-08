/**
 * Photo upload, for the Mantaq docs: one screen with two parts that run side by side.
 *
 * The screen shows the upload form until a photo is uploaded. Two regions run
 * alongside it: `upload` (waiting for a photo, sending it, sent) and `network`
 * (online, offline). Send each region its own events; the screen reacts when
 * `upload` reports `photoUploaded`.
 */
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

export function createPhotoUploadActor(options: { clock?: VirtualClock } = {}) {
  const { clock = VirtualClock() } = options;
  const upload = Actor({
    clock,
    inputs: [photoPicked, uploadConfirmed],
    outputs: [photoUploaded],
    states: [waitingForPhoto, sendingPhoto, photoSent],
    initial: waitingForPhoto,
    setup: (m) => {
      /** A photo was picked, so the visitor confirms the upload. */
      m.on(waitingForPhoto, {
        event: photoPicked,
        to: [sendingPhoto],
        handler: () => ({ state: sendingPhoto }),
      });
      /** The upload was confirmed, so the photo is sent. */
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
      /** The connection was lost. */
      m.on(online, {
        event: connectionLost,
        to: [offline],
        handler: () => ({ state: offline }),
      });
      /** The connection is back. */
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
      /** The photo was uploaded, so the upload screen shows. */
      m.on(showingUploadScreen, {
        event: photoUploaded,
        to: [showingUploadedPhoto],
        handler: () => ({ state: showingUploadedPhoto }),
      });
    },
  });
}
