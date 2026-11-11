import { VirtualClock } from "@mantaq/core";
import { createPool } from "@mantaq/sugar";

/** A team inbox: two workers behind one inbox, built with `createPool`. */
export function createTeamInbox({ clock = VirtualClock() }: { clock?: VirtualClock } = {}) {
  return createPool<string, "team">({
    name: "team",
    workers: 2,
    run: () => Promise.resolve(),
    clock,
  });
}
