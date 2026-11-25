/** Delivery packs the parcel, drives it to the door, and waits there for the shopper to sign, or takes it back. */
import { Actor, event, machine, state } from "@mantaq/core";
import { withTimeout } from "@mantaq/sugar";

/** The warehouse packs the parcel. */
const packingParcel = state("packingParcel")();
/** The courier drives the parcel to the shopper. */
const parcelOnTheWay = state("parcelOnTheWay")();
/** The courier waits at the door for a signature. */
const waitingAtDoor = state("waitingAtDoor")();
/** The shopper signed for the parcel. */
const parcelHandedOver = state("parcelHandedOver")().final();
/** Nobody signed, so the courier took the parcel back. */
const parcelTakenBack = state("parcelTakenBack")().final();

/** The parcel is packed. */
const parcelPacked = event("parcelPacked")();
/** The courier is at the door. */
const courierArrived = event("courierArrived")();
/** Nobody signed in time. */
const nobodyAnswered = event("nobodyAnswered")();
/** The shopper signs on the device of the courier. */
export const signForParcel = event("signForParcel")();

/** The delivery machine: 1000 ms to pack, 2000 ms on the way, and 600 ms at the door. */
export const delivery = machine("delivery", {
  create: ({ clock }) =>
    Actor({
      inputs: [signForParcel],
      internal: [parcelPacked, courierArrived, nobodyAnswered],
      states: [packingParcel, parcelOnTheWay, waitingAtDoor, parcelHandedOver, parcelTakenBack],
      initial: packingParcel,
      clock,
      setup: (builder) => {
        builder.effect(packingParcel, {
          name: "packParcel",
          sends: [parcelPacked],
          fn: (input) => withTimeout(1000, { input, event: () => parcelPacked.create() }),
        });
        builder.effect(parcelOnTheWay, {
          name: "driveToDoor",
          sends: [courierArrived],
          fn: (input) => withTimeout(2000, { input, event: () => courierArrived.create() }),
        });
        builder.effect(waitingAtDoor, {
          name: "waitForSignature",
          sends: [nobodyAnswered],
          fn: (input) => withTimeout(600, { input, event: () => nobodyAnswered.create() }),
        });
        builder.on(packingParcel, {
          event: parcelPacked,
          to: [parcelOnTheWay],
          handler: () => ({ state: parcelOnTheWay }),
        });
        builder.on(parcelOnTheWay, {
          event: courierArrived,
          to: [waitingAtDoor],
          handler: () => ({ state: waitingAtDoor }),
        });
        builder.on(waitingAtDoor, {
          event: signForParcel,
          to: [parcelHandedOver],
          handler: () => ({ state: parcelHandedOver }),
        });
        builder.on(waitingAtDoor, {
          event: nobodyAnswered,
          to: [parcelTakenBack],
          handler: () => ({ state: parcelTakenBack }),
        });
      },
    }),
});
