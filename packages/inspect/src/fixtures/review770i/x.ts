import { Actor as CoreActor, event, state } from "@mantaq/core";

const idle = state("idle")();
const done = state("done")();
const go = event("go")();

/** An app's own type that happens to be called Actor; not the core one. */
export interface Actor {
  name: string;
}

/** A helper the root calls for a stage name; the root never runs xActor. */
export function stage(): Actor {
  return { name: "x" };
}

export function xActor() {
  return CoreActor({
    inputs: [go],
    internal: [],
    states: [idle, done],
    initial: idle,
    setup: (m) => {
      /** X finishes at once. */
      m.on(idle, { event: go, to: [done], handler: () => ({ state: done }) });
    },
  });
}
