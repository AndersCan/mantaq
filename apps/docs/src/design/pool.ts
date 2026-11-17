/** A pool for the design page: one inbox and three workers, to show the pool view. */
import { machine } from "@mantaq/core";
import { createPool } from "@mantaq/sugar";

export const designPoolMachine = machine("designPool", {
  create: () => {
    return createPool<string, "team">({
      name: "team",
      workers: 3,
      run: () => Promise.resolve(),
    });
  },
});
