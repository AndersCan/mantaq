import { inspectModule } from "@mantaq/inspect";
import { expect, test } from "vite-plus/test";

const file = new URL("./kitchen.ts", import.meta.url).pathname;

test("the kitchen on the Pool page draws the inbox as a part and the workers as a map", async () => {
  const result = await inspectModule(file, { load: (path) => import(path) });
  expect(result.machines[0]?.actors).toEqual(["orders"]);
  expect(result.machines[0]?.maps).toEqual(["cooks"]);
}, 60_000);

test("COOKS_WANTED takes a count and shrinks the cooks once the dishes are done", async () => {
  const result = await inspectModule(file, { load: (path) => import(path) });
  const wanted = result.machines[0]?.events.find((each) => each.id === "COOKS_WANTED");
  expect(wanted?.payload?.map((field) => field.name)).toEqual(["count"]);
}, 60_000);
