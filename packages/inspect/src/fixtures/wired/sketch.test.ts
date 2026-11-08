import { createSketchActor } from "./sketch.ts";
import { expect, test } from "vite-plus/test";

test("the sketch starts idle", () => {
  expect(createSketchActor().state.name).toBe("idle");
});
