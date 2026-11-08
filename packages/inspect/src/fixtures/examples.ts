/** Payload fields with `@example` tags, fitting and not. */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

const idle = state("idle")();
const done = state("done")();

const save = event("save")<{
  /**
   * Where to reach them.
   * @example ana@example.com
   */
  email: string;
  /** @example "Ana Lima" */
  name: string;
  /** @example abc */
  amount: number;
  /** @example b */
  tier: "a" | "b";
  note: string;
}>();

export function createExamplesActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
    inputs: [save],
    states: [idle, done],
    initial: idle,
    clock,
    context: {},
    setup: (m) => {
      m.on(idle, { event: save, to: [done], handler: () => ({ state: done }) });
    },
  });
}
