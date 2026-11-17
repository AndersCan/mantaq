import { Actor, event, state } from "@mantaq/core";

/** Child: waits for its upload. */
const idle = state("idle")();
/** Child: uploading the file. */
const loading = state("loading")();
const go = event("go")();
const done = event("done")();

export function childActor() {
  return Actor({
    inputs: [go],
    internal: [done],
    states: [idle, loading],
    initial: idle,
    setup: (m) => {
      m.on(idle, { event: go, to: [loading], handler: () => ({ state: loading }) });
      /** Child: uploads the file to the server. */
      m.effect(loading, { name: "upload", sends: [done], fn: () => undefined });
    },
  });
}
