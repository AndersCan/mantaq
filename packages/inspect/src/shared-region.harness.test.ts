import { Either } from "@mantaq/utils";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { openViz } from "./harness.ts";

test("regions() names the state, not the shared node standing for it", async () => {
  const opened = await openViz({ file: join(import.meta.dirname, "fixtures/shared-region.ts") });
  const viz = Either.getRight(opened);
  if (viz === undefined) throw new Error(String(Either.getLeft(opened)));
  try {
    expect(await viz.regions()).toEqual({ steps: "a" });
    expect(Either.getLeft(await viz.sendTo({ region: "steps" }, "next"))).toBeUndefined();
    expect(await viz.regions()).toEqual({ steps: "b" });
    expect(Either.getLeft(await viz.sendTo({ region: "steps" }, "stop"))).toBeUndefined();
    expect(await viz.regions()).toEqual({ steps: "d" });
  } finally {
    await viz.close();
  }
}, 60_000);
