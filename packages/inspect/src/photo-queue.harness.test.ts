import { Either } from "@mantaq/utils";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { openViz } from "./harness.ts";

const photoQueue = join(import.meta.dirname, "../../../apps/docs/src/content/docs/photo-queue.ts");

test("drives the children of the docs photo queue", async () => {
  const opened = await openViz({ file: photoQueue });
  const viz = Either.getRight(opened);
  if (viz === undefined) throw new Error(String(Either.getLeft(opened)));
  try {
    expect(await viz.children()).toEqual([]);
    await viz.send("photoAdded", { photoId: "p1" });
    await viz.send("photoAdded", { photoId: "p2" });
    expect(await viz.children()).toEqual([
      { map: "photos", key: "p1", state: "sendingPhoto" },
      { map: "photos", key: "p2", state: "sendingPhoto" },
    ]);
    const p1 = { map: "photos", key: "p1" };
    await viz.sendTo(p1, "uploadFailed");
    expect((await viz.children())[0]?.state).toBe("waitingForRetry");
    await viz.sendTo(p1, "retryPressed");
    await viz.sendTo(p1, "uploadConfirmed");
    expect(await viz.children()).toEqual([
      { map: "photos", key: "p1", state: "photoSent" },
      { map: "photos", key: "p2", state: "sendingPhoto" },
    ]);
    await viz.send("queueCleared");
    expect(await viz.children()).toEqual([]);
    expect(await viz.state()).toBe("showingEmptyQueue");
    expect(viz.findings()).toEqual([]);
    const wrong = await viz.sendTo({ map: "photos", key: "p9" }, "uploadConfirmed");
    expect(Either.getLeft(wrong)).toBe('no child "p9" in "photos" of photoQueue. Children: .');
    expect(viz.problems()).toEqual([]);
  } finally {
    await viz.close();
  }
}, 60_000);
