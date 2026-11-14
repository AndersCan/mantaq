import { inspectModule } from "./inspect.ts";
import { expect, test } from "vite-plus/test";

const file = new URL("./fixtures/kitchen.ts", import.meta.url).pathname;

test("fuzz drives the returned pool: its states and the cooks' states get hits", async () => {
  const result = await inspectModule(file, { load: (path) => import(path) });
  const machine = result.machines[0]!;
  const hits = (id: string) => machine.states.find((each) => each.id === id)?.coverage?.hits ?? 0;
  expect(hits("orders.workersBusy")).toBeGreaterThan(0);
  expect(hits("cooks.working")).toBeGreaterThan(0);
  // The pool's event types are not in this file, so fuzz has no samples for them; the returned part's own page checks them.
  expect(result.warnings.filter((each) => each.includes("orders."))).toEqual([]);
}, 60_000);
