import type { Clock } from "@mantaq/core";

import { createPool } from "@mantaq/sugar";

/** A pool built away from the file that exports it. */
export function buildQueue(clock: Clock) {
  return createPool<string, "jobs">({
    name: "jobs",
    workers: 2,
    run: () => Promise.resolve(),
    clock,
  });
}
