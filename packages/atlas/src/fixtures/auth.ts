/**
 * Mirror of `packages/examples/authentication.test.ts`. Handlers are copied
 * verbatim; effects are stubbed, so sign-in results, monitor ticks and the
 * sign-out timer arrive as injected internal events.
 */
import { Actor, VirtualClock, event } from "@mantaq/core";
import { events, states } from "@mantaq/sugar";

interface User {
  uid: string;
  email: string;
  phone?: string;
}

const authStates = states(
  "checkingAuth",
  "loggedOut",
  "signingIn",
  "loggedIn",
  "signingOut",
  "signInError",
);

const signInEvent = event("SIGN_IN")<{ phoneNumber: string }>();
const userSignedInEvent = event("USER_SIGNED_IN")<{ user: User }>();
const signInDoneEvent = event("SIGN_IN_DONE")<{ user: User }>();
const signInErrorEvent = event("SIGN_IN_ERROR")<{ error: string }>();
const authEvents = events("SIGN_OUT", "RETRY", "MONITOR_TICK", "SIGNING_OUT_DONE");

type AuthContext = {
  user?: User;
  phoneNumber?: string;
  error?: string;
};

export function createAuthActor(clock: VirtualClock = VirtualClock()) {
  const initialContext: AuthContext = {};
  return Actor({
    inputs: [signInEvent, authEvents.SIGN_OUT, authEvents.RETRY],
    outputs: [],
    internal: [
      userSignedInEvent,
      signInDoneEvent,
      signInErrorEvent,
      authEvents.MONITOR_TICK,
      authEvents.SIGNING_OUT_DONE,
    ],
    states: [
      authStates.checkingAuth,
      authStates.loggedOut,
      authStates.signingIn,
      authStates.loggedIn,
      authStates.signingOut,
      authStates.signInError,
    ],
    initial: authStates.checkingAuth,
    clock,
    context: initialContext,
    setup: (m) => {
      m.effect(authStates.checkingAuth, { name: "monitorCheckingAuth", fn: () => undefined });
      m.effect(authStates.loggedIn, { name: "monitorLoggedIn", fn: () => undefined });
      m.effect(authStates.signingIn, { name: "signInWithPhone", fn: () => undefined });
      m.effect(authStates.signingOut, { name: "signOut", fn: () => undefined });
      m.onAny({ eventRef: authEvents.MONITOR_TICK, handler: () => ({}) });
      m.on(authStates.checkingAuth, {
        eventRef: signInEvent,
        handler: (event, { context }) => {
          const current = context.get();
          current.phoneNumber = event.payload.phoneNumber;
          context.set(current);
          return { state: authStates.signingIn };
        },
      });
      m.on(authStates.loggedOut, {
        eventRef: signInEvent,
        handler: (event, { context }) => {
          const current = context.get();
          current.phoneNumber = event.payload.phoneNumber;
          context.set(current);
          return { state: authStates.signingIn };
        },
      });
      m.on(authStates.signingIn, {
        eventRef: signInDoneEvent,
        handler: (event, { context }) => {
          const current = context.get();
          current.user = event.payload.user;
          context.set(current);
          return { state: authStates.loggedIn };
        },
      });
      m.on(authStates.signingIn, {
        eventRef: signInErrorEvent,
        handler: (event, { context }) => {
          const current = context.get();
          current.error = event.payload.error;
          context.set(current);
          return { state: authStates.signInError };
        },
      });
      m.on(authStates.loggedIn, {
        eventRef: authEvents.SIGN_OUT,
        handler: (_event, { context }) => {
          const current = context.get();
          current.user = undefined;
          current.phoneNumber = undefined;
          context.set(current);
          return { state: authStates.signingOut };
        },
      });
      m.on(authStates.signingOut, {
        eventRef: authEvents.SIGNING_OUT_DONE,
        handler: () => ({
          state: authStates.loggedOut,
        }),
      });
      m.on(authStates.signInError, {
        eventRef: authEvents.RETRY,
        handler: () => ({ state: authStates.signingIn }),
      });
      m.on(authStates.signInError, {
        eventRef: signInEvent,
        handler: (event, { context }) => {
          const current = context.get();
          current.phoneNumber = event.payload.phoneNumber;
          context.set(current);
          return { state: authStates.signingIn };
        },
      });
    },
  });
}
