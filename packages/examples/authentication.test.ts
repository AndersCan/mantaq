/**
 * Actor reimplementation of xstate auth machine.
 *
 * Mapping from xstate v5 to actor system:
 *   - States become state refs
 *   - Events become event refs
 *   - Context is mutable actor context
 *   - invoke fromPromise becomes an effect that emits internal done/error events
 *   - invoke fromCallback with setInterval becomes an effect with clock.setInterval
 *   - assign actions become direct context mutation in transitions
 *   - after 500ms becomes an effect with clock.setTimeout
 *   - Child actor output becomes internal events emitted from effects
 *
 * Key difference: xstate invoke spawns child actors, here effects handle
 * the same logic inline. monitorAuthState is duplicated across states via
 * effects (matching xstate per-state invoke).
 */

import { Actor, VirtualClock, event } from "@mantaq/core";
import type { EffectInput } from "@mantaq/core";
import { matches, withTimeout, states, events } from "@mantaq/sugar";
import { describe, it, expect } from "vite-plus/test";

interface User {
  uid: string;
  email: string;
  phone?: string;
}

// ── States ──────────────────────────────────────────────────────────
const authStates = states(
  "checkingAuth",
  "loggedOut",
  "signingIn",
  "loggedIn",
  "signingOut",
  "signInError",
);

// ── Input events (external) ─────────────────────────────────────────
const signInEvent = event("SIGN_IN")<{ phoneNumber: string }>();

// ── Internal events (from effects) ──────────────────────────────────
const userSignedInEvent = event("USER_SIGNED_IN")<{ user: User }>();
const signInDoneEvent = event("SIGN_IN_DONE")<{ user: User }>();
const signInErrorEvent = event("SIGN_IN_ERROR")<{ error: string }>();
const authEvents = events("SIGN_OUT", "RETRY", "MONITOR_TICK", "SIGNING_OUT_DONE");

// ── Context ─────────────────────────────────────────────────────────
type AuthContext = {
  user?: User;
  phoneNumber?: string;
  error?: string;
};

function constantRandom(value: number): () => number {
  return () => value;
}

function sequencedRandom(values: number[]): () => number {
  let index = 0;
  return () => {
    const next = values[Math.min(index, values.length - 1)] ?? 1;
    index += 1;
    return next;
  };
}

// ── Actor factory ───────────────────────────────────────────────────
function createAuthActor(options: { clock?: VirtualClock; random?: () => number } = {}) {
  const clockImpl = options.clock ?? VirtualClock();
  const randomSource = options.random ?? Math.random;

  /**
   * monitorAuthState: fromCallback with setInterval — simulated session check
   * Clock only has setTimeout, so we recurse manually
   */
  function monitorAuthState(input: EffectInput<AuthContext>) {
    let timeoutId: number;
    function tick(): void {
      if (input.signal.aborted) return;
      input.emit(authEvents.MONITOR_TICK.create(undefined));
      timeoutId = input.clock.setTimeout(5000, { cb: tick });
    }
    timeoutId = input.clock.setTimeout(5000, { cb: tick });
    input.signal.addEventListener("abort", () => input.clock.clearTimeout(timeoutId));
  }

  // signInWithPhone: fromPromise — simulate Firebase phone auth
  function signInWithPhone(input: EffectInput<AuthContext>) {
    input.clock.setTimeout(2000, {
      cb: () => {
        if (input.signal.aborted) return;
        if (randomSource() > 0.1) {
          const signedInUser: User = {
            uid: `user-${Date.now()}`,
            email: `user${Date.now()}@example.com`,
            phone: input.context.get().phoneNumber,
          };
          input.emit(signInDoneEvent.create({ user: signedInUser }));
        } else {
          input.emit(signInErrorEvent.create({ error: "Sign in failed" }));
        }
      },
    });
  }

  // signingOut effect: after 500ms → loggedOut (clearUser happens on entry, not here)
  function signingOut(input: EffectInput<AuthContext>) {
    return withTimeout(500, {
      input: input,
      event: () => authEvents.SIGNING_OUT_DONE.create(undefined),
    });
  }

  const initialContext: AuthContext = {};
  const actor = Actor({
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
    clock: clockImpl,
    context: initialContext,
    setup: (m) => {
      m.effect(authStates.checkingAuth, { name: "monitorCheckingAuth", fn: monitorAuthState });
      m.effect(authStates.loggedIn, { name: "monitorLoggedIn", fn: monitorAuthState });
      m.effect(authStates.signingIn, { name: "signInWithPhone", fn: signInWithPhone });
      m.effect(authStates.signingOut, { name: "signOut", fn: signingOut });
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

  return { actor, clock: clockImpl };
}

// ── Tests ───────────────────────────────────────────────────────────
describe("auth actor (reimplementation of xstate machine)", () => {
  it("ignores monitor ticks while checking auth", () => {
    const { actor, clock } = createAuthActor();
    expect(matches(actor, "checkingAuth")).toBe(true);

    clock.advance(5000);
    expect(matches(actor, "checkingAuth")).toBe(true);
  });

  it("creates a session when SIGN_IN succeeds from checkingAuth", () => {
    const { actor, clock } = createAuthActor({ random: constantRandom(0.5) });

    actor.send(signInEvent.create({ phoneNumber: "+1234567890" }));
    expect({
      matches: matches(actor, "signingIn"),
      phoneNumber: actor.context.phoneNumber,
    }).toEqual({ matches: true, phoneNumber: "+1234567890" });

    clock.advance(2000);
    expect({ matches: matches(actor, "loggedIn"), userPhone: actor.context.user?.phone }).toEqual({
      matches: true,
      userPhone: "+1234567890",
    });
  });

  it("handles SIGN_IN failure by moving to signInError", () => {
    const { actor, clock } = createAuthActor({ random: constantRandom(0.05) });

    actor.send(signInEvent.create({ phoneNumber: "+1234567890" }));
    clock.advance(2000);
    expect({ matches: matches(actor, "signInError"), error: actor.context.error }).toEqual({
      matches: true,
      error: "Sign in failed",
    });
  });

  it("keeps working across sign-out then sign-in from loggedOut", () => {
    const { actor, clock } = createAuthActor({ random: constantRandom(0.5) });

    actor.send(signInEvent.create({ phoneNumber: "+1234567890" }));
    clock.advance(2000);
    expect(matches(actor, "loggedIn")).toBe(true);

    actor.send(authEvents.SIGN_OUT);
    clock.advance(500);
    expect(matches(actor, "loggedOut")).toBe(true);

    actor.send(signInEvent.create({ phoneNumber: "+0987654321" }));
    expect(matches(actor, "signingIn")).toBe(true);

    clock.advance(2000);
    expect({ matches: matches(actor, "loggedIn"), phoneNumber: actor.context.phoneNumber }).toEqual(
      {
        matches: true,
        phoneNumber: "+0987654321",
      },
    );
  });

  it("removes the user when SIGN_OUT fires and settles in loggedOut after 500ms", () => {
    const { actor, clock } = createAuthActor({ random: constantRandom(0.5) });

    actor.send(signInEvent.create({ phoneNumber: "+1234567890" }));
    clock.advance(2000);
    expect(matches(actor, "loggedIn")).toBe(true);

    actor.send(authEvents.SIGN_OUT);
    expect({
      matches: matches(actor, "signingOut"),
      user: actor.context.user,
      phoneNumber: actor.context.phoneNumber,
    }).toEqual({ matches: true, user: undefined, phoneNumber: undefined });

    clock.advance(500);
    expect(matches(actor, "loggedOut")).toBe(true);
  });

  it("returns to signingIn when RETRY fires from signInError", () => {
    // First call: sign-in fails; second call: sign-in succeeds
    const { actor, clock } = createAuthActor({ random: sequencedRandom([0.05, 0.5]) });

    actor.send(signInEvent.create({ phoneNumber: "+1234567890" }));
    clock.advance(2000);
    expect(matches(actor, "signInError")).toBe(true);

    actor.send(authEvents.RETRY);
    expect(matches(actor, "signingIn")).toBe(true);

    clock.advance(2000);
    expect(matches(actor, "loggedIn")).toBe(true);
  });

  it("updates the phone number when SIGN_IN fires again from signInError", () => {
    const { actor, clock } = createAuthActor({ random: sequencedRandom([0.05, 0.5]) });

    actor.send(signInEvent.create({ phoneNumber: "+1234567890" }));
    clock.advance(2000);
    expect(matches(actor, "signInError")).toBe(true);

    actor.send(signInEvent.create({ phoneNumber: "+1111111111" }));
    expect(matches(actor, "signingIn")).toBe(true);

    clock.advance(2000);
    expect({ matches: matches(actor, "loggedIn"), phoneNumber: actor.context.phoneNumber }).toEqual(
      {
        matches: true,
        phoneNumber: "+1111111111",
      },
    );
  });

  it("keeps context consistent across the full flow", () => {
    const { actor, clock } = createAuthActor({ random: constantRandom(0.5) });

    expect({
      user: actor.context.user,
      phoneNumber: actor.context.phoneNumber,
      error: actor.context.error,
    }).toEqual({
      user: undefined,
      phoneNumber: undefined,
      error: undefined,
    });

    actor.send(signInEvent.create({ phoneNumber: "+1234567890" }));
    expect({ user: actor.context.user, phoneNumber: actor.context.phoneNumber }).toEqual({
      user: undefined,
      phoneNumber: "+1234567890",
    });

    clock.advance(2000);
    expect(actor.context.user).toBeDefined();

    actor.send(authEvents.SIGN_OUT);
    expect({ user: actor.context.user, phoneNumber: actor.context.phoneNumber }).toEqual({
      user: undefined,
      phoneNumber: undefined,
    });

    clock.advance(500);
    expect(matches(actor, "loggedOut")).toBe(true);
  });

  it("sets loggedOut only after the full 500ms in signingOut", () => {
    const { actor, clock } = createAuthActor({ random: constantRandom(0.5) });

    actor.send(signInEvent.create({ phoneNumber: "+1234567890" }));
    clock.advance(2000);

    actor.send(authEvents.SIGN_OUT);
    expect(matches(actor, "signingOut")).toBe(true);

    clock.advance(250);
    expect(matches(actor, "signingOut")).toBe(true);

    clock.advance(250);
    expect(matches(actor, "loggedOut")).toBe(true);
  });
});
