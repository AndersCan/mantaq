import { VirtualClock } from "@mantaq/core";
import { sketch } from "./sketch.ts";
import { expect, test } from "vite-plus/test";

test("the sketch starts idle", () => {
  expect(sketch.create({ clock: VirtualClock() }).state.name).toBe("idle");
});
