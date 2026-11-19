/** `tallParts` again, with a preview file so the Step panel has a Screen tab. */
import { Actor, event, machine, state } from "@mantaq/core";

const idle = state("idle")();
const go = event("go")();
const hub = state("hub")();
const leaves = Array.from({ length: 20 }, (_, i) => state(`leaf${i}`)());
const goes = Array.from({ length: 20 }, (_, i) => event(`go${i}`)());

function small(clock: Parameters<Parameters<typeof machine>[1]["create"]>[0]["clock"]) {
  return Actor({ clock, inputs: [go], states: [idle], initial: idle, setup: () => {} });
}

export const tallScreenParts = machine("tallScreenParts", {
  create: ({ clock }) => ({
    actor: small(clock),
    tall: Actor({
      clock,
      inputs: goes,
      states: [hub, ...leaves],
      initial: hub,
      setup: (m) => {
        leaves.forEach((leaf, i) => {
          m.on(hub, { event: goes[i]!, to: [leaf], handler: () => ({ state: leaf }) });
        });
      },
    }),
    other: small(clock),
  }),
});
