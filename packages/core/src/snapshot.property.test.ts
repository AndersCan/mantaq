import { Actor, VirtualClock, state, event } from "./index.ts";
import { fc, runProperty } from "@mantaq/pbt";
import { test, describe } from "vite-plus/test";

/**
 * A handler/subscriber explosion is a programmer bug, i.e. an assert-style bad
 * state, so the containment paths below use a guard-shaped throw helper.
 */
function isErrorBomb(message: string): never {
  throw new Error(message);
}

describe("Snapshot context isolation property tests", () => {
  test("the delivered context is a deep copy that keeps live state isolated (#226)", () => {
    runProperty(
      fc.record({
        initial: fc.integer({ min: -1000, max: 1000 }),
        set: fc.integer({ min: -1000, max: 1000 }),
      }),
      ({ initial, set }) => {
        const idle = state("idle")();
        const trigger = event("GO")();
        const actor = Actor({
          clock: VirtualClock(),
          inputs: [trigger],
          states: [idle],
          initial: idle,
          context: { n: initial },
          setup: (m) => {
            m.on(idle, {
              eventRef: trigger,
              handler: (_e, { context }) => {
                context.set({ n: set });
                return {};
              },
            });
          },
        });
        const snap = actor.snapshot();
        if (snap.context.n !== initial) return false;
        /**
         * The delivered context is a copy, not the live reference: mutating it
         * must never reach the live actor context (issue #226).
         */
        snap.context.n = 99999;
        if (actor.context.n !== initial) return false;
        return true;
      },
    );
  });

  test("unchanged context keeps a stable reference; changed context gets a fresh copy (#226)", () => {
    runProperty(fc.integer({ min: -1000, max: 1000 }), (n) => {
      const idle = state("idle")();
      const trigger = event("GO")();
      const set = event("SET")();
      const actor = Actor({
        clock: VirtualClock(),
        inputs: [trigger, set],
        states: [idle],
        initial: idle,
        context: { n },
        setup: (m) => {
          m.on(idle, { eventRef: trigger, handler: () => ({ state: idle }) }); // state/event only, no context change
          m.on(idle, {
            eventRef: set,
            handler: (_e, { context }) => {
              context.set({ n: n + 1 });
              return {};
            },
          });
        },
      });
      const a = actor.snapshot().context;
      actor.send(trigger.create()); // state-only transition
      const b = actor.snapshot().context;
      /**
       * unchanged context keeps the same reference
       * context change
       */
      if (b !== a) return false;
      actor.send(set.create());
      const c = actor.snapshot().context;
      if (c === b) return false; // changed context gets a new reference
      if (c.n !== n + 1) return false;
      // Mutating the fresh copy must not leak into the cached or live context.
      c.n = 99999;
      if (b.n !== n) return false;
      if (actor.context.n !== n + 1) return false;
      return true;
    });
  });

  test("error.context is a deep copy that keeps the live context isolated (#226)", () => {
    runProperty(fc.integer({ min: -1000, max: 1000 }), (n) => {
      const idle = state("idle")();
      const bad = event("BAD")();
      const actor = Actor({
        clock: VirtualClock(),
        inputs: [bad],
        states: [idle],
        initial: idle,
        context: { n },
        setup: (m) => {
          m.onAny({ eventRef: bad, handler: () => isErrorBomb("boom") });
        },
      });
      actor.send(bad.create());
      const snap = actor.snapshot();
      const errorView = snap.error;
      if (errorView === undefined) return false;
      const errorContext = errorView.context;
      if (typeof errorContext !== "object" || errorContext === null || !("n" in errorContext))
        return false;
      if (errorContext.n !== n) return false;
      errorContext.n = 99999;
      if (actor.context.n !== n) return false; // live untouched
      const freshSnap = actor.snapshot();
      if (freshSnap.error === undefined) return false;
      const freshContext = freshSnap.error.context;
      if (typeof freshContext !== "object" || freshContext === null || !("n" in freshContext))
        return false;
      if (freshContext.n !== n) return false; // next snapshot fresh
      return true;
    });
  });
});
