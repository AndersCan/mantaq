/**
 * Actor reimplementation of xstate auth machine.
 *
 * Mapping from xstate v5 → actor system:
 *   - States → state() refs
 *   - Events → event() refs
 *   - Context → mutable actor context
 *   - `invoke: fromPromise` → effect that emits internal done/error events
 *   - `invoke: fromCallback` (setInterval) → effect with clock.setInterval
 *   - `assign` actions → direct context mutation in transitions
 *   - `after: { 500 }` → effect with clock.setTimeout
 *   - Child actor output → internal events emitted from effects
 *
 * Key difference: xstate's `invoke` spawns child actors; here effects handle
 * the same logic inline. monitorAuthState is duplicated across states via
 * effects (matching xstate's per-state invoke).
 */

import { describe, it, expect, vi } from "vite-plus/test";
import { Actor, VirtualClock } from "@mantaq/core";
import { state } from "@mantaq/core";
import { event } from "@mantaq/core";
import { matches, withTimeout } from "@mantaq/sugar";

interface User {
  uid: string;
  email: string;
  phone?: string;
}

// ── States ──────────────────────────────────────────────────────────
const checkingAuthState = state("checkingAuth")();
const loggedOutState = state("loggedOut")();
const signingInState = state("signingIn")();
const loggedInState = state("loggedIn")();
const signingOutState = state("signingOut")();
const signInErrorState = state("signInError")();

// ── Input events (external) ─────────────────────────────────────────
const signInEvent = event("SIGN_IN")<{ phoneNumber: string }>();
const signOutEvent = event("SIGN_OUT")();
const retryEvent = event("RETRY")();

// ── Internal events (from effects) ──────────────────────────────────
const userSignedInEvent = event("USER_SIGNED_IN")<{ user: User }>();
const signInDoneEvent = event("SIGN_IN_DONE")<{ user: User }>();
const signInErrorEvent = event("SIGN_IN_ERROR")<{ error: string }>();
const monitorTickEvent = event("MONITOR_TICK")();

// ── Context ─────────────────────────────────────────────────────────
type AuthContext = {
  user?: User;
  phoneNumber?: string;
  error?: string;
};

// ── Effects ─────────────────────────────────────────────────────────
// monitorAuthState: fromCallback with setInterval — simulated session check
// Clock only has setTimeout, so we recurse manually
const monitorAuthStateEffect: InstanceType<typeof Actor>["options"]["effects"][string] = [
  ({ signal, emit, clock }) => {
    let id: number;
    const tick = () => {
      if (signal.aborted) return;
      emit(monitorTickEvent.create(undefined));
      id = clock.setTimeout(5000, tick);
    };
    id = clock.setTimeout(5000, tick);
    signal.addEventListener("abort", () => clock.clearTimeout(id));
  },
];

// signInWithPhone: fromPromise — simulate Firebase phone auth
const signInWithPhoneEffect: InstanceType<typeof Actor>["options"]["effects"][string] = [
  ({ signal, context, emit, clock }) => {
    clock.setTimeout(2000, () => {
      if (signal.aborted) return;
      if (Math.random() > 0.1) {
        const user: User = {
          uid: `user-${Date.now()}`,
          email: `user${Date.now()}@example.com`,
          phone: (context as AuthContext).phoneNumber,
        };
        emit(signInDoneEvent.create({ user }));
      } else {
        emit(signInErrorEvent.create({ error: "Sign in failed" }));
      }
    });
  },
];

// signingOut effect: after 500ms → loggedOut (clearUser happens on entry, not here)
const signingOutEffect: InstanceType<typeof Actor>["options"]["effects"][string] = [
  (input) => withTimeout(500, input, () => signingOutDoneEvent.create(undefined)),
];

const signingOutDoneEvent = event("SIGNING_OUT_DONE")();

// ── Actor factory ───────────────────────────────────────────────────
function createAuthActor(clock?: VirtualClock) {
  const c = clock ?? new VirtualClock();

  const actor = new Actor({
    inputs: [signInEvent, signOutEvent, retryEvent],
    outputs: [],
    internal: [
      userSignedInEvent,
      signInDoneEvent,
      signInErrorEvent,
      monitorTickEvent,
      signingOutDoneEvent,
    ],
    states: [
      checkingAuthState,
      loggedOutState,
      signingInState,
      loggedInState,
      signingOutState,
      signInErrorState,
    ],
    initial: checkingAuthState,
    clock: c,
    context: {} as AuthContext,
    effects: {
      checkingAuth: monitorAuthStateEffect,
      loggedIn: monitorAuthStateEffect,
      signingIn: signInWithPhoneEffect,
      signingOut: signingOutEffect,
    },
    transitions: {
      Any: {
        MONITOR_TICK: () => ({}),
      },
      checkingAuth: {
        SIGN_IN: (event, { context }) => {
          context.phoneNumber = event.phoneNumber;
          return { state: signingInState };
        },
      },
      loggedOut: {
        SIGN_IN: (event, { context }) => {
          context.phoneNumber = event.phoneNumber;
          return { state: signingInState };
        },
      },
      signingIn: {
        SIGN_IN_DONE: (event, { context }) => {
          context.user = event.user;
          return { state: loggedInState };
        },
        SIGN_IN_ERROR: (event, { context }) => {
          context.error = event.error;
          return { state: signInErrorState };
        },
      },
      loggedIn: {
        SIGN_OUT: (_event, { context }) => {
          context.user = undefined;
          context.phoneNumber = undefined;
          return { state: signingOutState };
        },
      },
      signingOut: {
        SIGNING_OUT_DONE: () => ({ state: loggedOutState }),
      },
      signInError: {
        RETRY: () => ({ state: signingInState }),
        SIGN_IN: (event, { context }) => {
          context.phoneNumber = event.phoneNumber;
          return { state: signingInState };
        },
      },
    },
  });

  return { actor, clock: c };
}

// ── Tests ───────────────────────────────────────────────────────────
describe("auth actor (reimplementation of xstate machine)", () => {
  let mathRandomSpy: ReturnType<typeof vi.spyOn>;

  it("starts in checkingAuth, monitor ticks ignored", () => {
    const { actor, clock } = createAuthActor();
    expect(matches(actor, "checkingAuth")).toBe(true);

    clock.advance(5000);
    expect(matches(actor, "checkingAuth")).toBe(true);
  });

  it("SIGN_IN from checkingAuth → signingIn → loggedIn (success)", () => {
    mathRandomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { actor, clock } = createAuthActor();

    actor.send(signInEvent.create({ phoneNumber: "+1234567890" }));
    expect(matches(actor, "signingIn")).toBe(true);
    expect(actor.context.phoneNumber).toBe("+1234567890");

    clock.advance(2000);
    expect(matches(actor, "loggedIn")).toBe(true);
    expect(actor.context.user).toBeDefined();
    expect(actor.context.user?.phone).toBe("+1234567890");
    mathRandomSpy.mockRestore();
  });

  it("SIGN_IN failure → signInError", () => {
    mathRandomSpy = vi.spyOn(Math, "random").mockReturnValue(0.05);
    const { actor, clock } = createAuthActor();

    actor.send(signInEvent.create({ phoneNumber: "+1234567890" }));
    clock.advance(2000);
    expect(matches(actor, "signInError")).toBe(true);
    expect(actor.context.error).toBe("Sign in failed");
    mathRandomSpy.mockRestore();
  });

  it("SIGN_IN from loggedOut → signingIn → loggedIn", () => {
    mathRandomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { actor, clock } = createAuthActor();

    actor.send(signInEvent.create({ phoneNumber: "+1234567890" }));
    clock.advance(2000);
    expect(matches(actor, "loggedIn")).toBe(true);

    actor.send(signOutEvent);
    clock.advance(500);
    expect(matches(actor, "loggedOut")).toBe(true);

    actor.send(signInEvent.create({ phoneNumber: "+0987654321" }));
    expect(matches(actor, "signingIn")).toBe(true);
    expect(actor.context.phoneNumber).toBe("+0987654321");

    clock.advance(2000);
    expect(matches(actor, "loggedIn")).toBe(true);
    mathRandomSpy.mockRestore();
  });

  it("SIGN_OUT from loggedIn → signingOut → loggedOut after 500ms", () => {
    mathRandomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { actor, clock } = createAuthActor();

    actor.send(signInEvent.create({ phoneNumber: "+1234567890" }));
    clock.advance(2000);
    expect(matches(actor, "loggedIn")).toBe(true);

    actor.send(signOutEvent);
    expect(matches(actor, "signingOut")).toBe(true);
    expect(actor.context.user).toBeUndefined();
    expect(actor.context.phoneNumber).toBeUndefined();

    clock.advance(500);
    expect(matches(actor, "loggedOut")).toBe(true);
    mathRandomSpy.mockRestore();
  });

  it("RETRY from signInError → signingIn", () => {
    mathRandomSpy = vi.spyOn(Math, "random");
    // First call: sign-in fails; second call: sign-in succeeds
    mathRandomSpy.mockReturnValueOnce(0.05).mockReturnValueOnce(0.5);
    const { actor, clock } = createAuthActor();

    actor.send(signInEvent.create({ phoneNumber: "+1234567890" }));
    clock.advance(2000);
    expect(matches(actor, "signInError")).toBe(true);

    actor.send(retryEvent);
    expect(matches(actor, "signingIn")).toBe(true);

    clock.advance(2000);
    expect(matches(actor, "loggedIn")).toBe(true);
    mathRandomSpy.mockRestore();
  });

  it("SIGN_IN from signInError → signingIn (with new number)", () => {
    mathRandomSpy = vi.spyOn(Math, "random");
    mathRandomSpy.mockReturnValueOnce(0.05).mockReturnValueOnce(0.5);
    const { actor, clock } = createAuthActor();

    actor.send(signInEvent.create({ phoneNumber: "+1234567890" }));
    clock.advance(2000);
    expect(matches(actor, "signInError")).toBe(true);

    actor.send(signInEvent.create({ phoneNumber: "+1111111111" }));
    expect(matches(actor, "signingIn")).toBe(true);
    expect(actor.context.phoneNumber).toBe("+1111111111");

    clock.advance(2000);
    expect(matches(actor, "loggedIn")).toBe(true);
    mathRandomSpy.mockRestore();
  });

  it("context accumulates correctly across full flow", () => {
    mathRandomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { actor, clock } = createAuthActor();

    expect(actor.context.user).toBeUndefined();
    expect(actor.context.phoneNumber).toBeUndefined();
    expect(actor.context.error).toBeUndefined();

    actor.send(signInEvent.create({ phoneNumber: "+1234567890" }));
    expect(actor.context.phoneNumber).toBe("+1234567890");

    clock.advance(2000);
    expect(actor.context.user).toBeDefined();

    actor.send(signOutEvent);
    expect(actor.context.user).toBeUndefined();
    expect(actor.context.phoneNumber).toBeUndefined();

    clock.advance(500);
    expect(matches(actor, "loggedOut")).toBe(true);
    mathRandomSpy.mockRestore();
  });

  it("signingOut effect aborts if state changes before timeout", () => {
    mathRandomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { actor, clock } = createAuthActor();

    actor.send(signInEvent.create({ phoneNumber: "+1234567890" }));
    clock.advance(2000);

    actor.send(signOutEvent);
    expect(matches(actor, "signingOut")).toBe(true);

    clock.advance(250);
    expect(matches(actor, "signingOut")).toBe(true);

    clock.advance(250);
    expect(matches(actor, "loggedOut")).toBe(true);
    mathRandomSpy.mockRestore();
  });
});
