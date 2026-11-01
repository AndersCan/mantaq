/**
 * Exports of every shape machine discovery must tell apart: factories taking
 * a clock, `{ clock }` options or nothing, an actor instance, and exports
 * that are not machines.
 */
import { Actor, RealClock, VirtualClock, event, state } from "@mantaq/core";
import type { Clock } from "@mantaq/core";

const closed = state("closed")();
const opened = state("opened")().final();
const open = event("open")<{
  by: "key" | "code";
  code?: string;
  tags: string[];
  at: { floor: number; urgent: boolean };
}>();
const knock = event("knock")();

function door(clock: Clock) {
  return Actor({
    clock,
    inputs: [open, knock],
    states: [closed, opened],
    initial: closed,
    setup: (m) => {
      m.on(closed, {
        event: open,
        to: [opened],
        handler: (e) => (e.payload.by === "code" ? { state: opened } : {}),
      });
      m.on(closed, { event: knock, handler: () => ({}) });
    },
  });
}

export function createDoorActor(clock: VirtualClock = VirtualClock()) {
  return door(clock);
}

export function createGate(options: { clock?: VirtualClock } = {}) {
  const clock = options.clock ?? VirtualClock();
  return { actor: door(clock), clock };
}

/** Runs on wall time: drawn, but cannot be fuzzed. */
export const createRealDoor = () => door(RealClock());

export const sharedDoor = createDoorActor();

export function createNamedDoor(name: string) {
  return { name, actor: door(VirtualClock()) };
}

export function notAMachine(): number {
  return 1;
}
