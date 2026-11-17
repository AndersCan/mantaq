import { Actor, event, machine, state } from "@mantaq/core";
import { childActor } from "./child.ts";

const idle = state("idle")();
const loading = state("loading")();
const fetch = event("fetch")();
const loaded = event("loaded")();

/** A parent with its own states named like the child's; it documents none of them. */
export const parent = machine("parent", {
  create: () =>
    Math.random() > 2
      ? childActor()
      : Actor({
          inputs: [fetch],
          internal: [loaded],
          states: [idle, loading],
          initial: idle,
          setup: (m) => {
            m.on(idle, { event: fetch, to: [loading], handler: () => ({ state: loading }) });
            m.effect(loading, { name: "fetch", sends: [loaded], fn: () => undefined });
            m.on(loading, { event: loaded, to: [idle], handler: () => ({ state: idle }) });
          },
        }),
});
