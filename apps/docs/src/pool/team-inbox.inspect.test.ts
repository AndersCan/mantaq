import { designErrors, inspectModule } from "@mantaq/inspect";
import { expect, test } from "vite-plus/test";

const file = new URL("./team-inbox.ts", import.meta.url).pathname;

test("the Pool page's machine has no design errors and no payload warnings", async () => {
  const result = await inspectModule(file, { load: (path) => import(path) });
  expect(designErrors(result.machines[0]!)).toEqual([]);
  // Fuzz sends worker ids at random, so it never makes a report come from a running worker while nothing is free.
  expect(result.warnings).toEqual([
    "teamInbox: fuzz never reached: workWaiting -team.ITEMS_FAILED-> workersBusy, workersBusy -team.ITEMS_FAILED-> workWaiting (ran 2000 iterations, stopped: iteration cap). Raise fuzz.timeLimitMs / iterations or add a named run to `tests`.",
  ]);
}, 60_000);
