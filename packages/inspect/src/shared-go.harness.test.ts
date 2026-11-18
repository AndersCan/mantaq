import { Either } from "@mantaq/utils";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { openViz } from "./harness.ts";

test("sends an event whose arrow three states share", async () => {
  const opened = await openViz({ file: join(import.meta.dirname, "fixtures/shared-go.ts") });
  const viz = Either.getRight(opened);
  if (viz === undefined) throw new Error(String(Either.getLeft(opened)));
  try {
    expect(Either.getRight(await viz.send("begin"))).toEqual({ state: "a", outcome: "transition" });
    expect(Either.getRight(await viz.send("next"))).toEqual({ state: "b", outcome: "transition" });
    expect(Either.getRight(await viz.send("go"))).toEqual({ state: "home", outcome: "transition" });
  } finally {
    await viz.close();
  }
}, 60_000);
