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

describe("Snapshot live context property tests", () => {
  test("in-place edits keep snapshot().context === actor.context and untouched items by reference", () => {
    runProperty(
      fc.record({
        items: fc.array(fc.integer({ min: -1000, max: 1000 }), { minLength: 1, maxLength: 8 }),
        edits: fc.array(fc.nat(), { maxLength: 8 }),
      }),
      ({ items, edits }) => {
        const idle = state("idle")();
        const rename = event("RENAME")<{ at: number }>();
        const actor = Actor({
          clock: VirtualClock(),
          inputs: [rename],
          states: [idle],
          initial: idle,
          context: { items: items.map((n) => ({ n })) },
          setup: (m) => {
            m.on(idle, {
              event: rename,
              handler: (e, { context }) => {
                const target = context.get().items[e.payload.at];
                if (target !== undefined) target.n += 1;
                context.set(context.get());
                return {};
              },
            });
          },
        });
        const before = [...actor.context.items];
        const touched = new Set<number>();
        for (const edit of edits) {
          const at = edit % items.length;
          touched.add(at);
          actor.send(rename.create({ at }));
          if (actor.snapshot().context !== actor.context) return false;
        }
        const after = actor.snapshot().context.items;
        return before.every((item, i) => after[i] === item);
      },
    );
  });

  test("replacement handlers keep untouched items by reference", () => {
    runProperty(
      fc.record({
        items: fc.array(fc.integer({ min: -1000, max: 1000 }), { minLength: 2, maxLength: 8 }),
        at: fc.nat(),
        n: fc.integer({ min: -1000, max: 1000 }),
      }),
      ({ items, at, n }) => {
        const idle = state("idle")();
        const edit = event("EDIT")<{ id: number; n: number }>();
        const actor = Actor({
          clock: VirtualClock(),
          inputs: [edit],
          states: [idle],
          initial: idle,
          context: { items: items.map((v, id) => ({ id, n: v })) },
          setup: (m) => {
            m.on(idle, {
              event: edit,
              handler: (e, { context }) => {
                const c = context.get();
                context.set({
                  ...c,
                  items: c.items.map((i) => (i.id === e.payload.id ? { ...i, n: e.payload.n } : i)),
                });
                return {};
              },
            });
          },
        });
        const id = at % items.length;
        const before = actor.snapshot().context.items;
        actor.send(edit.create({ id, n }));
        const after = actor.snapshot().context.items;
        return before.every((item, i) => (i === id ? after[i] !== item : after[i] === item));
      },
    );
  });

  test("error.context is the context reference from before the failing event", () => {
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
          m.onAny({ event: bad, handler: () => isErrorBomb("boom") });
        },
      });
      const before = actor.context;
      actor.send(bad.create());
      const errorView = actor.snapshot().error;
      return errorView !== undefined && errorView.context === before;
    });
  });
});
