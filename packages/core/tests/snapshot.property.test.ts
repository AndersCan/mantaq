import { test, describe } from "vite-plus/test";
import { fc, runProperty } from "@mantaq/pbt";
import { Actor, VirtualClock, state, event } from "../src/index.ts";

describe("Snapshot context isolation property tests", () => {
  test("delivered context is a deep copy isolated from live state (#226)", () => {
    runProperty(
      fc.record({
        initial: fc.integer({ min: -1000, max: 1000 }),
        set: fc.integer({ min: -1000, max: 1000 }),
      }),
      ({ initial, set }) => {
        const idle = state("idle")();
        const go = event("GO")();
        const actor = new Actor({
          clock: new VirtualClock(),
          inputs: [go],
          states: [idle],
          initial: idle,
          context: { n: initial },
          setup: (m) => {
            m.on(idle, go, (_e, { context }) => {
              context.set({ n: set });
              return {};
            });
          },
        });
        const snap = actor.snapshot();
        if (snap.context.n !== initial) return false;
        // The delivered context is a copy, not the live reference: mutating it
        // must never reach the live actor context (issue #226).
        (snap.context as { n: number }).n = 99999;
        if (actor.context.n !== initial) return false;
        return true;
      },
    );
  });

  test("unchanged context keeps a stable reference; changed context gets a fresh copy (#226)", () => {
    runProperty(fc.integer({ min: -1000, max: 1000 }), (n) => {
      const idle = state("idle")();
      const go = event("GO")();
      const set = event("SET")();
      const actor = new Actor({
        clock: new VirtualClock(),
        inputs: [go, set],
        states: [idle],
        initial: idle,
        context: { n },
        setup: (m) => {
          m.on(idle, go, () => ({ state: idle })); // state/event only, no context change
          m.on(idle, set, (_e, { context }) => {
            context.set({ n: n + 1 });
            return {};
          });
        },
      });
      const a = actor.snapshot().context;
      actor.send(go.create()); // state-only transition
      const b = actor.snapshot().context;
      if (b !== a) return false; // unchanged context keeps the same reference
      actor.send(set.create()); // context change
      const c = actor.snapshot().context;
      if (c === b) return false; // changed context gets a new reference
      if (c.n !== n + 1) return false;
      // Mutating the fresh copy must not leak into the cached or live context.
      (c as { n: number }).n = 99999;
      if (b.n !== n) return false;
      if (actor.context.n !== n + 1) return false;
      return true;
    });
  });

  test("error.context is a deep copy isolated from live context (#226)", () => {
    runProperty(fc.integer({ min: -1000, max: 1000 }), (n) => {
      const idle = state("idle")();
      const bad = event("BAD")();
      const actor = new Actor({
        clock: new VirtualClock(),
        inputs: [bad],
        states: [idle],
        initial: idle,
        context: { n },
        setup: (m) => {
          m.onAny(bad, () => {
            throw new Error("boom");
          });
        },
      });
      actor.send(bad.create());
      const snap = actor.snapshot();
      if (snap.error === undefined) return false;
      if ((snap.error.context as { n: number }).n !== n) return false;
      (snap.error.context as { n: number }).n = 99999;
      if (actor.context.n !== n) return false; // live untouched
      if ((actor.snapshot().error!.context as { n: number }).n !== n) return false; // next snapshot fresh
      return true;
    });
  });
});
