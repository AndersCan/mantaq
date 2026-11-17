/** Context and payload fields of every input kind the live page asks for. */
import { Actor, event, machine, state } from "@mantaq/core";

interface LinkContext {
  /** The album. */
  folderId: string;
  validFor: "10m" | "1h";
  count: number;
  enabled: boolean;
  flags?: { a: boolean };
  fn: () => void;
}

const idle = state("idle")();
const done = state("done")();

const choose = event("choose")<{
  /** How long it lasts. */
  validFor: "10m" | "1h";
  code?: string;
}>();
const submit = event("submit")<{ code: string }>();
const touch = event("touch")();

export const fields = machine("fields", {
  create: ({ clock }) => {
    const initialContext: LinkContext = {
      folderId: "f1",
      validFor: "10m",
      count: 0,
      enabled: true,
      fn: () => undefined,
    };
    return Actor({
      inputs: [choose, submit, touch],
      states: [idle, done],
      initial: idle,
      clock,
      context: initialContext,
      setup: (m) => {
        m.on(idle, { event: choose, handler: () => ({}) });
        m.on(idle, { event: submit, to: [done], handler: () => ({ state: done }) });
        m.on(idle, { event: touch, handler: () => ({}) });
      },
    });
  },
});
