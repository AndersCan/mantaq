import { RealClock } from "@mantaq/core";
import type { Clock } from "@mantaq/core";
import { createPool } from "@mantaq/sugar";

function wait(options: { clock: Clock; ms: number; signal: AbortSignal }): Promise<void> {
  const { clock, ms, signal } = options;
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    clock.setTimeout(ms, { cb: resolve, signal });
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

/** A team inbox: one inbox and three workers. Each item takes one second to run. */
export function createTeamInbox({ clock = RealClock() }: { clock?: Clock } = {}) {
  return createPool<string, "team">({
    name: "team",
    workers: 3,
    run: (_items, { signal }) => wait({ clock, ms: 1000, signal }),
    clock,
  });
}
