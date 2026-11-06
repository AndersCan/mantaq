/**
 * Login with lockout, for the Mantaq docs: a machine whose context decides
 * where it goes.
 *
 * Context counts failed attempts. The third wrong password locks the account
 * instead of returning to the form, and each lockout lasts twice as long as
 * the one before (30 s, 60 s, 120 s, ...). The states are real modes; the
 * context is what the machine has learned along the way.
 *
 *   signedOut --SUBMIT--> checking --ACCEPTED--> signedIn --SIGN_OUT--> signedOut
 *                            |
 *                            +--REJECTED (attempts < 3)--> signedOut
 *                            +--REJECTED (3rd attempt)---> lockedOut --UNLOCK--> signedOut
 *
 * The submitted credentials and the signed-in user ride on state payloads
 * (`checking`, `signedIn`), so context holds no "maybe set" fields.
 */
import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { withTimeout } from "@mantaq/sugar";

type Credentials = { username: string; password: string };

const MAX_ATTEMPTS = 3;
const FIRST_LOCKOUT_MS = 30_000;

/** Stand-in for your auth service. */
const accounts: Readonly<Record<string, string>> = { ada: "lovelace" };

type LoginContext = {
  /** Wrong passwords since the last success or unlock. */
  failedAttempts: number;
  /** Lockouts so far; each one doubles the next lockout's length. */
  lockouts: number;
};

/** The form is showing. */
const signedOut = state("signedOut")();
/** The credentials are being verified. */
const checking = state("checking")<Credentials>();
/** Signed in as `username`. */
const signedIn = state("signedIn")<{ username: string }>();
/** Too many wrong passwords: the form is disabled until the timer unlocks it. */
const lockedOut = state("lockedOut")();

/** The person submits the form. */
const submit = event("SUBMIT")<Credentials>();
/** The person signs out. */
const signOut = event("SIGN_OUT")();
/** The auth service accepted the credentials. */
const accepted = event("ACCEPTED")<{ username: string }>();
/** The auth service rejected the credentials. */
const rejected = event("REJECTED")<{ reason: string }>();
/** The lockout is over. */
const unlock = event("UNLOCK")();

function lockoutMs(lockouts: number): number {
  return FIRST_LOCKOUT_MS * 2 ** Math.max(0, lockouts - 1);
}

export function createLoginActor(clock: VirtualClock = VirtualClock()) {
  const initialContext: LoginContext = { failedAttempts: 0, lockouts: 0 };
  const actor = Actor({
    inputs: [submit, signOut],
    internal: [accepted, rejected, unlock],
    states: [signedOut, checking, signedIn, lockedOut],
    initial: signedOut,
    clock,
    context: initialContext,
    setup: (m) => {
      /** Submitting the form starts a check of those credentials. */
      m.on(signedOut, {
        event: submit,
        to: [checking],
        handler: (e) => ({ state: checking.create(e.payload) }),
      });
      /** The auth service answers after a short delay. */
      m.effect(checking, {
        name: "verifyPassword",
        sends: [accepted, rejected],
        fn: (input) => {
          const { username, password } = input.state.payload;
          withTimeout(300, {
            input,
            event: () =>
              accounts[username] === password
                ? accepted.create({ username })
                : rejected.create({ reason: "wrong username or password" }),
          });
        },
      });
      /** Right password: the count starts over. */
      m.on(checking, {
        event: accepted,
        to: [signedIn],
        handler: (e, { context }) => {
          context.set({ ...context.get(), failedAttempts: 0 });
          return { state: signedIn.create({ username: e.payload.username }) };
        },
      });
      /** Wrong password: back to the form, or locked out on the third in a row. */
      m.on(checking, {
        event: rejected,
        to: [signedOut, lockedOut],
        handler: (_e, { context }) => {
          const current = context.get();
          const failedAttempts = current.failedAttempts + 1;
          if (failedAttempts >= MAX_ATTEMPTS) {
            context.set({ failedAttempts, lockouts: current.lockouts + 1 });
            return { state: lockedOut };
          }
          context.set({ ...current, failedAttempts });
          return { state: signedOut };
        },
      });
      /** The lockout runs for a time that doubles with every lockout. */
      m.effect(lockedOut, {
        name: "lockoutTimer",
        sends: [unlock],
        fn: (input) => {
          withTimeout(lockoutMs(input.context.get().lockouts), {
            input,
            event: () => unlock.create(),
          });
        },
      });
      /** The lockout is over: the form comes back with a fresh count. */
      m.on(lockedOut, {
        event: unlock,
        to: [signedOut],
        handler: (_e, { context }) => {
          context.set({ ...context.get(), failedAttempts: 0 });
          return { state: signedOut };
        },
      });
      /** Signing out shows the form again. */
      m.on(signedIn, { event: signOut, to: [signedOut], handler: () => ({ state: signedOut }) });
    },
  });
  return { actor, clock };
}
