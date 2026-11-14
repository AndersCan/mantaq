import { inspectModule } from "@mantaq/inspect";
import { expect, test } from "vite-plus/test";

const file = new URL("./kitchen.ts", import.meta.url).pathname;

test("the kitchen on the Pool page draws the inbox as a part and the workers as a map", async () => {
  const result = await inspectModule(file, { load: (path) => import(path) });
  expect(result.machines[0]?.actors).toEqual(["orders"]);
  expect(result.machines[0]?.maps).toEqual(["cooks"]);
}, 60_000);
