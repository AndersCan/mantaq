/** A delivery scans the parcel at pickup and again at the door, with the same scan machine. */
import { Actor, event, machine, state } from "@mantaq/core";
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

export const delivery = machine("delivery", {
  create: ({ clock }) =>
    Actor({
      inputs: [arrive],
      internal: [scanPassed, scanFailed, scanBroke],
      states: [pickingUp, onTheWay, handingOver, delivered, returned],
      initial: pickingUp,
      clock,
      setup: (builder) => {
        const endings = {
          machine: scan,
          done: { scanned: scanPassed, rejected: scanFailed },
          error: scanBroke,
        };
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
