/**
 * PINNED FIXTURE — dense-60 (connectivity stress).
 * FIXTURE_VERSION: 1
 *
 * 60 states in a cyclic mesh: every state has two outgoing transitions
 * (`next` → successor, `skip` → successor+2). 60 nodes / 120 edges — the
 * dense case for layout performance and visual noise.
 */

import { Actor, VirtualClock, state, event } from "@mantaq/core";

const refs = Array.from({ length: 60 }, (_, i) => state(`node${String(i).padStart(3, "0")}`)());

export const next = event("next")();
const skip = event("skip")();

export function createDenseActor(clock?: VirtualClock) {
  const c = clock ?? new VirtualClock();
  const actor = new Actor({
    inputs: [next, skip],
    states: refs,
    initial: refs[0],
    clock: c,
    context: { position: 0 },
    setup: (m) => {
      for (let i = 0; i < 60; i += 1) {
        const from = refs[i];
        const n = refs[(i + 1) % 60];
        const s = refs[(i + 2) % 60];
        m.on(from, next, (ev, opts) => {
          const ctx = opts.context.get();
          ctx.position = (ctx.position + 1) % 60;
          opts.context.set(ctx);
          return { state: n };
        });
        m.on(from, skip, (ev, opts) => {
          const ctx = opts.context.get();
          ctx.position = (ctx.position + 2) % 60;
          opts.context.set(ctx);
          return { state: s };
        });
      }
    },
  });
  return { actor, clock: c };
}
