/** A pool for the design page: one inbox and three workers, to show a `×n` box in the system view. */
import { VirtualClock } from "@mantaq/core";
import { createPool } from "@mantaq/sugar";

export function createDesignPool({ clock = VirtualClock() }: { clock?: VirtualClock } = {}) {
  return createPool<string, "team">({
    name: "team",
    workers: 3,
    run: () => Promise.resolve(),
    clock,
  });
}
