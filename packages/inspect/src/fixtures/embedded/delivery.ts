/** A delivery scans the parcel at pickup and again at the door, with the same scan machine. */
import { Actor, event, machine, state } from "@mantaq/core";
import type { Snapshot } from "@mantaq/core";
import { embed } from "@mantaq/sugar";
import { scan } from "./scan.ts";

/** The parcel is scanned at pickup. */
const pickingUp = state("pickingUp")();
/** The parcel is on its way. */
const onTheWay = state("onTheWay")();
/** The parcel is scanned at the door. */
const handingOver = state("handingOver")();
/** The parcel reached its owner. */
const delivered = state("delivered")().final();
/** The parcel goes back to the sender. */
const returned = state("returned")().final();

/** The van reached the door. */
const arrive = event("arrive")();
/** The scan read the label. */
const scanPassed = event("scanPassed")();
/** The scan could not read the label. */
const scanFailed = event("scanFailed")();
/** The scan machine broke. */
const scanBroke = event("scanBroke")();
/** The courier reports the label as unreadable; the running scan takes it. */
const misread = event("misread")();
/** The scan changed; carries its snapshot. */
const scanChanged = event("scanChanged")<Snapshot>();

interface DeliveryContext {
  /** The last snapshot of the running scan. */
  scan: Snapshot | undefined;
}

const noScan: DeliveryContext = { scan: undefined };

export const delivery = machine("delivery", {
  create: ({ clock }) =>
    Actor({
      inputs: [arrive, misread],
      internal: [scanPassed, scanFailed, scanBroke, scanChanged],
      states: [pickingUp, onTheWay, handingOver, delivered, returned],
      initial: pickingUp,
      context: noScan,
      clock,
      setup: (builder) => {
        const endings = {
          machine: scan,
          done: { scanned: scanPassed, rejected: scanFailed },
          error: scanBroke,
          forward: [misread],
          snapshot: scanChanged,
          keep: "scan",
        } as const;
        embed(builder, { in: pickingUp, ...endings });
        embed(builder, { in: handingOver, ...endings });
        builder.on(pickingUp, {
          event: scanPassed,
          to: [onTheWay],
          handler: () => ({ state: onTheWay }),
        });
        builder.on(onTheWay, {
          event: arrive,
          to: [handingOver],
          handler: () => ({ state: handingOver }),
        });
        builder.on(handingOver, {
          event: scanPassed,
          to: [delivered],
          handler: () => ({ state: delivered }),
        });
        for (const scanning of [pickingUp, handingOver]) {
          builder.on(scanning, {
            event: scanChanged,
            handler: (changed, { context }) => context.set({ scan: changed.payload }),
          });
          builder.on(scanning, {
            event: scanFailed,
            to: [returned],
            handler: () => ({ state: returned }),
          });
          builder.on(scanning, {
            event: scanBroke,
            to: [returned],
            handler: () => ({ state: returned }),
          });
        }
      },
    }),
});
