/** Structural mirror of `packages/examples/authentication.test.ts` (effects stubbed). */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

const checkingAuth = state("checkingAuth")();
const loggedOut = state("loggedOut")();
const signingIn = state("signingIn")();
const loggedIn = state("loggedIn")();
const signingOut = state("signingOut")();
const signInError = state("signInError")();

const signIn = event("SIGN_IN")<{ phoneNumber: string }>();
const signOut = event("SIGN_OUT")();
const retry = event("RETRY")();
const signInDone = event("SIGN_IN_DONE")<{ user: { uid: string } }>();
const signInFailed = event("SIGN_IN_ERROR")<{ error: string }>();
const monitorTick = event("MONITOR_TICK")();
const signingOutDone = event("SIGNING_OUT_DONE")();

export function createAuthActor() {
  return Actor({
    inputs: [signIn, signOut, retry],
    outputs: [],
    internal: [signInDone, signInFailed, monitorTick, signingOutDone],
    states: [checkingAuth, loggedOut, signingIn, loggedIn, signingOut, signInError],
    initial: checkingAuth,
    clock: VirtualClock(),
    context: {},
    setup: (m) => {
      m.effect(checkingAuth, { name: "monitorCheckingAuth", fn: () => undefined });
      m.effect(loggedIn, { name: "monitorLoggedIn", fn: () => undefined });
      m.effect(signingIn, { name: "signInWithPhone", fn: () => undefined });
      m.effect(signingOut, { name: "signOut", fn: () => undefined });
      m.onAny({ eventRef: monitorTick, handler: () => ({}) });
      m.on(checkingAuth, { eventRef: signIn, handler: () => ({ state: signingIn }) });
      m.on(loggedOut, { eventRef: signIn, handler: () => ({ state: signingIn }) });
      m.on(signingIn, { eventRef: signInDone, handler: () => ({ state: loggedIn }) });
      m.on(signingIn, { eventRef: signInFailed, handler: () => ({ state: signInError }) });
      m.on(loggedIn, { eventRef: signOut, handler: () => ({ state: signingOut }) });
      m.on(signingOut, { eventRef: signingOutDone, handler: () => ({ state: loggedOut }) });
      m.on(signInError, { eventRef: retry, handler: () => ({ state: signingIn }) });
      m.on(signInError, { eventRef: signIn, handler: () => ({ state: signingIn }) });
    },
  });
}
