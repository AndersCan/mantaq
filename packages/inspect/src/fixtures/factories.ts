/**
 * Exports of every shape machine discovery must tell apart: factories taking
 * a clock, `{ clock }` options or nothing, an actor instance, and exports
 * that are not machines.
 */
import { Actor, VirtualClock, event, machine, state } from "@mantaq/core";
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

function doorOn(clock: Clock) {
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

export const door = machine("door", {
  create: ({ clock }) => doorOn(clock),
});

export const gate = machine("gate", {
  create: ({ clock }) => ({ actor: doorOn(clock), clock }),
});

/** Not a machine: a plain function that returns an actor is never discovered. */
export function createLegacyDoor(clock: VirtualClock = VirtualClock()) {
  return doorOn(clock);
}

/** Not a machine: a bare actor cannot be recreated, so it is never discovered. */
export const sharedDoor = doorOn(VirtualClock());

export function notAMachine(): number {
  return 1;
}
