/**
 * PINNED FIXTURE — chain-50 (deep chain).
 * FIXTURE_VERSION: 1
 *
 * 50 states in a single linear chain — dagre must produce a tall, thin
 * layout without crossing. Long chain = timeline/trace stress later.
 */

import { Actor, VirtualClock, state, event } from "@mantaq/core";

const names = Array.from({ length: 50 }, (_, i) => `step${String(i).padStart(2, "0")}`);
const refs = names.map((name) => state(name)());
const last = refs[49].final();
const states = [...refs.slice(0, 49), last];

export const next = event("next")();

export function createChainActor(clock?: VirtualClock) {
  const c = clock ?? new VirtualClock();
  const actor = new Actor({
    inputs: [next],
    states,
    initial: refs[0],
    clock: c,
    context: { position: 0 },
    setup: (m) => {
      for (let i = 0; i < 49; i += 1) {
        const from = refs[i];
        const to = i === 48 ? last : refs[i + 1];
        m.on(from, next, (ev, opts) => {
          const ctx = opts.context.get();
          ctx.position = i + 1;
          opts.context.set(ctx);
          return { state: to };
        });
      }
    },
  });
  return { actor, clock: c };
}
