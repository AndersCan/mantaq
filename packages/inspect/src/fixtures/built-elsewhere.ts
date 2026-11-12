import { VirtualClock } from "@mantaq/core";
import { buildQueue } from "./built-elsewhere-parts.ts";

/** A queue whose events are not registered in this file. */
export function createJobs({ clock = VirtualClock() }: { clock?: VirtualClock } = {}) {
  return buildQueue(clock);
}
