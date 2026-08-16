/**
 * PINNED FIXTURE — auth.
 *
 * Source: packages/examples/authentication.actor.test.ts (`createAuthActor`)
 * FIXTURE_VERSION: 1
 *
 * Do not import from packages/examples: factories are module-private inside
 * .actor.test.ts with no exports map. This is a copy; the drift guard
 * (browser/fixtures/fingerprints.json + tests/fingerprints.test.ts) catches
 * upstream refactors that change the graph shape.
 *
 * Story: Firebase-style phone auth (xstate reimplementation).
 *
 *   checkingAuth → loggedOut → signingIn → loggedIn → signingOut → loggedOut
 *                    ↘ SIGN_IN ↗                    ↘ SIGN_OUT ↗
 *                  signingIn → signInError → RETRY → signingIn
 *
 * Determinism: source's signInWithPhoneEffect used Math.random() (success
 * roll) + Date.now() (uid/email). Both neutralized in this pin — the success
 * roll is a constant 0.5 (always succeeds) and timestamps come from the
 * VirtualClock, so the fixture is replayable (goldens + timeline).
 * The goldens only ever show the success path; the failure path is covered
 * by the failure unit tests upstream, not by this fixture.
 */

import { Actor, VirtualClock, state, event } from "@mantaq/core";
import type { EffectInput, InternalEvent } from "@mantaq/core";

// Inlined copy of @mantaq/sugar withTimeout — pinned fixtures stay
// self-contained (no drift via sugar refactors).
function withTimeout<ActorContext>(
  ms: number,
  input: EffectInput<ActorContext>,
  event: () => InternalEvent,
): void {
  input.clock.setTimeout(
    ms,
    () => {
      if (input.signal.aborted) return;
      input.emit(event());
    },
    { signal: input.signal },
  );
}

interface User {
  uid: string;
  email: string;
  phone?: string;
}

const s = {
  checkingAuth: state("checkingAuth")(),
  loggedOut: state("loggedOut")(),
  signingIn: state("signingIn")(),
  loggedIn: state("loggedIn")(),
  signingOut: state("signingOut")(),
  signInError: state("signInError")(),
};

export const signIn = event("SIGN_IN")<{ phoneNumber: string }>();
export const signOut = event("SIGN_OUT")();
export const retry = event("RETRY")();

const userSignedIn = event("USER_SIGNED_IN")<{ user: User }>();
const signInDone = event("SIGN_IN_DONE")<{ user: User }>();
const signInErrorEvent = event("SIGN_IN_ERROR")<{ error: string }>();
const monitorTick = event("MONITOR_TICK")();
const signingOutDone = event("SIGNING_OUT_DONE")();

type AuthContext = {
  user?: User;
  phoneNumber?: string;
  error?: string;
};

// monitorAuthState: fromCallback with setInterval — simulated session check.
// Clock only has setTimeout, so we recurse manually.
const monitorAuthStateEffect = (input: EffectInput<AuthContext>) => {
  let id: number;
  const tick = () => {
    if (signal.aborted) return;
    input.emit(monitorTick.create());
    id = input.clock.setTimeout(5000, tick, { signal: input.signal });
  };
  const { signal } = input;
  id = input.clock.setTimeout(5000, tick, { signal: input.signal });
  signal.addEventListener("abort", () => input.clock.clearTimeout(id));
};

// signInWithPhone: fromPromise — simulate Firebase phone auth.
// DETERMINISM NOTE: source used Math.random() > 0.1 + Date.now(); both are
// neutralized here (constant success roll + VirtualClock time).
const signInWithPhoneEffect = (input: EffectInput<AuthContext>) => {
  input.clock.setTimeout(
    2000,
    () => {
      if (input.signal.aborted) return;
      const now = input.clock.now();
      const user: User = {
        uid: `user-${now}`,
        email: `user${now}@example.com`,
        phone: input.context.get().phoneNumber,
      };
      input.emit(signInDone.create({ user }));
    },
    { signal: input.signal },
  );
};

// signingOut effect: after 500ms → loggedOut (clearUser happens on entry).
const signingOutEffect = (input: EffectInput<AuthContext>) =>
  withTimeout(500, input, () => signingOutDone.create());

export function createAuthActor(clock?: VirtualClock) {
  const c = clock ?? new VirtualClock();

  const actor = new Actor({
    inputs: [signIn, signOut, retry],
    outputs: [],
    internal: [userSignedIn, signInDone, signInErrorEvent, monitorTick, signingOutDone],
    states: [s.checkingAuth, s.loggedOut, s.signingIn, s.loggedIn, s.signingOut, s.signInError],
    initial: s.checkingAuth,
    clock: c,
    context: {} as AuthContext,
    setup: (m) => {
      m.effect(s.checkingAuth, monitorAuthStateEffect);
      m.effect(s.loggedIn, monitorAuthStateEffect);
      m.effect(s.signingIn, signInWithPhoneEffect);
      m.effect(s.signingOut, signingOutEffect);
      m.onAny(monitorTick, () => ({}));
      m.on(s.checkingAuth, signIn, (event, opts) => {
        const cur = opts!.context.get();
        cur.phoneNumber = event.payload.phoneNumber;
        opts!.context.set(cur);
        return { state: s.signingIn };
      });
      m.on(s.loggedOut, signIn, (event, opts) => {
        const cur = opts!.context.get();
        cur.phoneNumber = event.payload.phoneNumber;
        opts!.context.set(cur);
        return { state: s.signingIn };
      });
      m.on(s.signingIn, signInDone, (event, opts) => {
        const cur = opts!.context.get();
        cur.user = event.payload.user;
        opts!.context.set(cur);
        return { state: s.loggedIn };
      });
      m.on(s.signingIn, signInErrorEvent, (event, opts) => {
        const cur = opts!.context.get();
        cur.error = event.payload.error;
        opts!.context.set(cur);
        return { state: s.signInError };
      });
      m.on(s.loggedIn, signOut, (_event, opts) => {
        const cur = opts!.context.get();
        cur.user = undefined;
        cur.phoneNumber = undefined;
        opts!.context.set(cur);
        return { state: s.signingOut };
      });
      m.on(s.signingOut, signingOutDone, () => ({ state: s.loggedOut }));
      m.on(s.signInError, retry, () => ({ state: s.signingIn }));
      m.on(s.signInError, signIn, (event, opts) => {
        const cur = opts!.context.get();
        cur.phoneNumber = event.payload.phoneNumber;
        opts!.context.set(cur);
        return { state: s.signingIn };
      });
    },
  });

  return { actor, clock: c };
}
