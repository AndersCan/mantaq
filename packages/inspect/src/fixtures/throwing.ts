/** A handler that throws on a payload the type allows: fuzzing reports it as an error. */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

const idle = state("idle")();
const picked = state("picked")();

const pick = event("pick")<{ side: "a" | "b" }>();

export function createThrowingActor(clock: VirtualClock = VirtualClock()) {
  const routes: Record<string, { next: typeof picked }> = { a: { next: picked } };
  return Actor({
    inputs: [pick],
    internal: [],
    states: [idle, picked],
    initial: idle,
    clock,
    setup: (m) => {
      m.on(idle, {
        event: pick,
        to: [picked],
        handler: (e) => ({ state: routes[e.payload.side]!.next }),
      });
      m.on(picked, { event: pick, to: [idle], handler: () => ({ state: idle }) });
    },
  });
}
