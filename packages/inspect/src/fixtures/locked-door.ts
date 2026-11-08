/** A door that opens when pushed, unless the factory is built locked. */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

/** The door is shut; the initial state. */
const closedDoor = state("closedDoor")();
/** The door swung open; final. */
const openedDoor = state("openedDoor")().final();
/** The push met a lock; final. */
const lockedOut = state("lockedOut")().final();
/** Someone pushes the door. */
const pushDoor = event("pushDoor")();

/** A door actor; `locked` makes the push end in `lockedOut`. */
export function createLockedDoorActor(options: { clock?: VirtualClock; locked?: boolean } = {}) {
  return Actor({
    inputs: [pushDoor],
    states: [closedDoor, openedDoor, lockedOut],
    initial: closedDoor,
    clock: options.clock ?? VirtualClock(),
    setup: (m) => {
      m.on(closedDoor, {
        event: pushDoor,
        to: [openedDoor, lockedOut],
        handler: () => ({ state: options.locked === true ? lockedOut : openedDoor }),
      });
    },
  });
}
