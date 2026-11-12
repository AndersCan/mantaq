import { Actor, event, state } from "@mantaq/core";
import type { Clock } from "@mantaq/core";
import { withTimeout } from "@mantaq/sugar";

/** Stands in for the code your app keeps. */
const doorCode = "1234";

/** The door is shut and will not open. */
const locked = state("locked")();
/** The door opens with a push, for 30 seconds. */
const unlocked = state("unlocked")();

/** Someone typed a code at the door. */
export const enterCode = event("enterCode")<{
  /** @example 1234 */
  code: string;
}>();
/** 30 seconds passed with the door unlocked. */
const timeRanOut = event("timeRanOut")();

export function createDoorLock(clock: Clock) {
  return Actor({
    inputs: [enterCode],
    internal: [timeRanOut],
    states: [locked, unlocked],
    initial: locked,
    clock,
    setup: (m) => {
      /** The right code unlocks the door; a wrong one leaves it locked. */
      m.on(locked, {
        event: enterCode,
        to: [unlocked],
        handler: (event) => {
          if (event.payload.code !== doorCode) return {};
          return { state: unlocked };
        },
      });
      /** We chose to lock the door again 30 seconds after it opens. */
      m.effect(unlocked, {
        name: "relockTimer",
        sends: [timeRanOut],
        fn: (input) => withTimeout(30_000, { input, event: () => timeRanOut.create() }),
      });
      /** Time ran out, so the door locks. */
      m.on(unlocked, { event: timeRanOut, to: [locked], handler: () => ({ state: locked }) });
    },
  });
}
