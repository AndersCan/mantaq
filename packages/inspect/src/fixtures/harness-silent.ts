/** An effect that declares no `sends`: the harness reports it waiting with no reports. */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

const idle = state("idle")();
const busy = state("busy")();
const start = event("start")();

export function createSilentActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
    inputs: [start],
    states: [idle, busy],
    initial: idle,
    clock,
    setup: (m) => {
      m.on(idle, { event: start, to: [busy], handler: () => ({ state: busy }) });
      m.effect(busy, { name: "quiet", fn: () => undefined });
    },
  });
}
