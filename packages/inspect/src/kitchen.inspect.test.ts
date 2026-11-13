import { inspectModule } from "./inspect.ts";
import { expect, test } from "vite-plus/test";

const file = new URL("./fixtures/kitchen.ts", import.meta.url).pathname;

test("fuzz drives the returned pool: its states and the cooks' states get hits", async () => {
  const result = await inspectModule(file, { load: (path) => import(path) });
  const machine = result.machines[0]!;
  const hits = (id: string) => machine.states.find((each) => each.id === id)?.coverage?.hits ?? 0;
  expect(hits("orders.workersBusy")).toBeGreaterThan(0);
  expect(hits("cooks.working")).toBeGreaterThan(0);
  // The pool's event types are not in this file, so fuzz has no payload samples for them; no other warning names the inbox.
  const other = result.warnings
    .filter((each) => each.includes("orders."))
    .filter((each) => !each.includes("fuzz sent orders.") && !each.includes("fuzz never reached"));
  expect(other).toEqual([]);
}, 60_000);
