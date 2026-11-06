/**
 * Lockout counter bumped by a two-step cycle: `submit` leaves `signedOut`,
 * `rejected` returns to it and counts. The third rejection locks out, so the
 * loop body is the pair `submit, rejected`, not `rejected` alone (which
 * `signedOut` ignores).
 */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

const signedOut = state("signedOut")();
const checking = state("checking")();
const lockedOut = state("lockedOut")();

const submit = event("submit")();
const rejected = event("rejected")();

export function createLockoutActor(clock: VirtualClock = VirtualClock()) {
  const initialContext: { failedAttempts: number } = { failedAttempts: 0 };
  return Actor({
    inputs: [submit],
    internal: [rejected],
    states: [signedOut, checking, lockedOut],
    initial: signedOut,
    clock,
    context: initialContext,
    setup: (m) => {
      m.on(signedOut, { event: submit, to: [checking], handler: () => ({ state: checking }) });
      m.on(checking, {
        event: rejected,
        to: [signedOut, lockedOut],
        handler: (_event, { context }) => {
          const failedAttempts = context.get().failedAttempts + 1;
          context.set({ failedAttempts });
          return { state: failedAttempts >= 3 ? lockedOut : signedOut };
        },
      });
    },
  });
}
