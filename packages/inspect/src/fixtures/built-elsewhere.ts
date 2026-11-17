import { machine } from "@mantaq/core";
import { buildQueue } from "./built-elsewhere-parts.ts";

/** A queue whose events are not registered in this file. */
export const jobs = machine("jobs", {
  create: () => {
    return buildQueue();
  },
});
