import { Actor, VirtualClock, event, state } from "@mantaq/core";

const idle = state("idle")();
const running = state("running")();
const orphan = state("orphan")();
const go = event("go")();

export function createOrphanActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
    clock,
    inputs: [go],
    states: [idle, running, orphan],
    initial: idle,
    setup: (m) => {
      m.on(idle, { event: go, to: [running], handler: () => ({ state: running }) });
    },
  });
}
