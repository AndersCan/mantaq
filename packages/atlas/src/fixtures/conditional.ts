import { Actor, event, state } from "@mantaq/core";

const idle = state("idle")();
const approved = state("approved")();
const rejected = state("rejected")();
const review = event("review")<{ amount: number }>();

/** Target depends on payload, so the synthetic traversal cannot determine it. */
export function createConditionalActor() {
  return Actor({
    inputs: [review],
    states: [idle, approved, rejected],
    initial: idle,
    setup: (m) => {
      m.on(idle, {
        eventRef: review,
        handler: (e) => ({ state: (e.payload?.amount ?? 0) > 100 ? rejected : approved }),
      });
    },
  });
}
