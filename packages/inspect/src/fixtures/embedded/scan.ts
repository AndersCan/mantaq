/** A parcel scan: the reader takes 100 ms, or the parcel is misread. */
import { Actor, event, machine, state } from "@mantaq/core";
import { withTimeout } from "@mantaq/sugar";

/** The reader is reading the label. */
const reading = state("reading")();
/** The label was read. */
const scanned = state("scanned")().final();
/** The label could not be read. */
const rejected = state("rejected")().final();

/** The reader finished. */
const read = event("read")();
/** Someone reports the label as unreadable. */
const misread = event("misread")();

export const scan = machine("scan", {
  create: ({ clock }) =>
    Actor({
      inputs: [misread],
      internal: [read],
      states: [reading, scanned, rejected],
      initial: reading,
      clock,
      setup: (builder) => {
        builder.effect(reading, {
          name: "reader",
          sends: [read],
          fn: (input) => withTimeout(100, { input, event: () => read.create() }),
        });
        builder.on(reading, { event: read, to: [scanned], handler: () => ({ state: scanned }) });
        builder.on(reading, {
          event: misread,
          to: [rejected],
          handler: () => ({ state: rejected }),
        });
      },
    }),
});
