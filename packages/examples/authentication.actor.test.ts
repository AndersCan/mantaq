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
import { Actor, VirtualClock, event } from "@mantaq/core";
import type { EffectInput } from "@mantaq/core";
import { matches, withTimeout, states, events } from "@mantaq/sugar";

interface User {
  uid: string;
  email: string;
  phone?: string;
}

// ── States ──────────────────────────────────────────────────────────
const s = states("checkingAuth", "loggedOut", "signingIn", "loggedIn", "signingOut", "signInError");

// ── Input events (external) ─────────────────────────────────────────
const signInEvent = event("SIGN_IN")<{ phoneNumber: string }>();

// ── Internal events (from effects) ──────────────────────────────────
const userSignedInEvent = event("USER_SIGNED_IN")<{ user: User }>();
const signInDoneEvent = event("SIGN_IN_DONE")<{ user: User }>();
const signInErrorEvent = event("SIGN_IN_ERROR")<{ error: string }>();
const e = events("SIGN_OUT", "RETRY", "MONITOR_TICK", "SIGNING_OUT_DONE");

// ── Context ─────────────────────────────────────────────────────────
type AuthContext = {
  user?: User;
  phoneNumber?: string;
  error?: string;
};

// ── Effects ─────────────────────────────────────────────────────────
// monitorAuthState: fromCallback with setInterval — simulated session check
// Clock only has setTimeout, so we recurse manually
const monitorAuthStateEffect = (input: EffectInput<AuthContext>) => {
  let id: number;
  const tick = () => {
    if (signal.aborted) return;
    input.emit(e.MONITOR_TICK.create(undefined));
    id = input.clock.setTimeout(5000, tick);
  };
  const { signal } = input;
  id = input.clock.setTimeout(5000, tick);
  signal.addEventListener("abort", () => input.clock.clearTimeout(id));
};

// signInWithPhone: fromPromise — simulate Firebase phone auth
const signInWithPhoneEffect = (input: EffectInput<AuthContext>) => {
  input.clock.setTimeout(2000, () => {
    if (input.signal.aborted) return;
    if (Math.random() > 0.1) {
      const user: User = {
        uid: `user-${Date.now()}`,
        email: `user${Date.now()}@example.com`,
        phone: input.context.phoneNumber,
      };
      input.emit(signInDoneEvent.create({ user }));
    } else {
      input.emit(signInErrorEvent.create({ error: "Sign in failed" }));
    }
  });
};

// signingOut effect: after 500ms → loggedOut (clearUser happens on entry, not here)
const signingOutEffect = (input: EffectInput<AuthContext>) =>
  withTimeout(500, input, () => e.SIGNING_OUT_DONE.create(undefined));

// ── Actor factory ───────────────────────────────────────────────────
function createAuthActor(clock?: VirtualClock) {
  const c = clock ?? new VirtualClock();

  const actor = new Actor({
    inputs: [signInEvent, e.SIGN_OUT, e.RETRY],
    outputs: [],
    internal: [
      userSignedInEvent,
      signInDoneEvent,
      signInErrorEvent,
      e.MONITOR_TICK,
      e.SIGNING_OUT_DONE,
    ],
    states: [s.checkingAuth, s.loggedOut, s.signingIn, s.loggedIn, s.signingOut, s.signInError],
    initial: s.checkingAuth,
    clock: c,
    context: {} as AuthContext,
    setup: (m) => {
      m.effect(s.checkingAuth, monitorAuthStateEffect);
      m.effect(s.loggedIn, monitorAuthStateEffect);
      m.effect(s.signingIn, signInWithPhoneEffect);
      m.effect(s.signingOut, signingOutEffect);
      m.onAny(e.MONITOR_TICK, () => ({}));
      m.on(s.checkingAuth, signInEvent, (event, opts) => {
        opts!.context.phoneNumber = event.phoneNumber;
        return { state: s.signingIn };
      });
      m.on(s.loggedOut, signInEvent, (event, opts) => {
        opts!.context.phoneNumber = event.phoneNumber;
        return { state: s.signingIn };
      });
      m.on(s.signingIn, signInDoneEvent, (event, opts) => {
        opts!.context.user = event.user;
        return { state: s.loggedIn };
      });
      m.on(s.signingIn, signInErrorEvent, (event, opts) => {
        opts!.context.error = event.error;
        return { state: s.signInError };
      });
      m.on(s.loggedIn, e.SIGN_OUT, (_event, opts) => {
        opts!.context.user = undefined;
        opts!.context.phoneNumber = undefined;
        return { state: s.signingOut };
      });
      m.on(s.signingOut, e.SIGNING_OUT_DONE, () => ({ state: s.loggedOut }));
      m.on(s.signInError, e.RETRY, () => ({ state: s.signingIn }));
      m.on(s.signInError, signInEvent, (event, opts) => {
        opts!.context.phoneNumber = event.phoneNumber;
        return { state: s.signingIn };
      });
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

    actor.send(e.SIGN_OUT);
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

    actor.send(e.SIGN_OUT);
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

    actor.send(e.RETRY);
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

    actor.send(e.SIGN_OUT);
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

    actor.send(e.SIGN_OUT);
    expect(matches(actor, "signingOut")).toBe(true);

    clock.advance(250);
    expect(matches(actor, "signingOut")).toBe(true);

    clock.advance(250);
    expect(matches(actor, "loggedOut")).toBe(true);
    mathRandomSpy.mockRestore();
  });
});
