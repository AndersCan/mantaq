import { inspectModule } from "@mantaq/inspect";
import { expect, test } from "vite-plus/test";

const file = new URL("./door-lock.ts", import.meta.url).pathname;

test("the Test it form starts with the door code, so Send opens the door", async () => {
  const result = await inspectModule(file, { load: (path) => import(path) });
  const json = JSON.stringify(result.machines[0]);
  const at = json.indexOf('"name":"code"');
  expect(at).toBeGreaterThan(-1);
  expect(json.slice(at, at + 400)).toContain('"sample":"1234"');
}, 60_000);
