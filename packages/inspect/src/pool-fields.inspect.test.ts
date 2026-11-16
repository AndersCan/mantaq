import { inspectModule } from "./inspect.ts";
import { expect, test } from "vite-plus/test";

const file = new URL("./fixtures/pool.ts", import.meta.url).pathname;

test("a pool returned as is offers its events' fields, so Context can set item and count", async () => {
  const result = await inspectModule(file, { load: (path) => import(path) });
  const fieldsOf = (id: string) =>
    result.machines[0]?.events.find((each) => each.id === id)?.payload?.map((field) => field.name);
  expect(fieldsOf("team.ITEM_ARRIVED")).toEqual(["item"]);
  expect(fieldsOf("team.WORKERS_RESIZED")).toEqual(["count"]);
}, 60_000);
