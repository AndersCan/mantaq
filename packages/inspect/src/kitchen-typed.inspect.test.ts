import { VirtualClock } from "@mantaq/core";
import { createDriver } from "./drive.ts";
import { createKitchen } from "./fixtures/kitchen-typed.ts";
import { inspectModule } from "./inspect.ts";
import { expect, test } from "vite-plus/test";

function kitchen() {
  const clock = VirtualClock();
  const made = createKitchen({ clock });
  return { actor: made.actor, clock, made };
}

const file = new URL("./fixtures/kitchen-typed.ts", import.meta.url).pathname;

test("the returned pool's events carry their payload fields, so the Context tab can ask for them", async () => {
  const result = await inspectModule(file, { load: (path) => import(path) });
  const fieldsOf = (id: string) =>
    result.machines[0]?.events.find((each) => each.id === id)?.payload?.map((field) => field.name);
  expect(fieldsOf("orders.WORKERS_RESIZED")).toEqual(["count"]);
  expect(fieldsOf("orders.ITEM_ARRIVED")).toEqual(["item"]);
  expect(fieldsOf("ORDER_PLACED")).toEqual(["dish"]);
  expect(fieldsOf("orders.RUN_SUCCEEDED")).toBeUndefined();
}, 60_000);

test("the resize arrow's field, sent as the Context tab sends it, leaves one cook", async () => {
  const result = await inspectModule(file, { load: (path) => import(path) });
  const field = result.machines[0]?.events
    .find((each) => each.id === "orders.WORKERS_RESIZED")
    ?.payload?.find((each) => each.name === "count");
  const driver = createDriver({ id: "kitchen", create: kitchen }, { effectMode: "real" });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const order = { kind: "event", event: "ORDER_PLACED", payload: { dish: "soup" } } as const;
  driver.step(order);
  driver.step(order);
  await tick();
  driver.step({
    kind: "event",
    event: "orders.WORKERS_RESIZED",
    payload: { count: field?.sample ?? null },
    actor: { region: "orders" },
  });
  driver.step({ kind: "advance", ms: 1000 });
  await tick();
  const live = driver.step({ kind: "advance", ms: 0 });
  expect(live.children.map((each) => each.key)).toEqual(["w1"]);
  expect(live.regions["orders"]).toBe("orders.allWorkersFree");
}, 60_000);
