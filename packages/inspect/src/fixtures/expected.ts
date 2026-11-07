/**
 * A counter with expectations next to it: the fuzzer reaches three bumps (a
 * never-see), and cannot reach a negative count (a must-see).
 */
import type { Expectations } from "../expectations.ts";
import { Actor, VirtualClock, event, state } from "@mantaq/core";

const idle = state("idle")();
const counting = state("counting")();
const done = state("done")().final();

const begin = event("begin")();
const bump = event("bump")();
const tag = event("tag")<{ note: string }>();
const finish = event("finish")();

export function createExpectedActor(clock: VirtualClock = VirtualClock()) {
  const initialContext: { count: number; note?: string } = { count: 0 };
  return Actor({
    inputs: [begin, bump, tag, finish],
    internal: [],
    states: [idle, counting, done],
    initial: idle,
    clock,
    context: initialContext,
    setup: (m) => {
      m.on(idle, { event: begin, to: [counting], handler: () => ({ state: counting }) });
      m.on(counting, {
        event: bump,
        to: [counting],
        handler: (_event, { context }) => {
          context.set({ count: context.get().count + 1 });
          return { state: counting };
        },
      });
      m.on(counting, {
        event: tag,
        to: [counting],
        handler: (received, { context }) => {
          context.set({ ...context.get(), note: received.payload.note });
          return { state: counting };
        },
      });
      m.on(counting, { event: finish, to: [done], handler: () => ({ state: done }) });
    },
  });
}

export const expectedExpectations: Expectations<typeof createExpectedActor> = {
  counting: { neverSee: [{ count: 3 }], mustSee: [{ count: -1 }] },
};
