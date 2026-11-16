import { Either } from "@mantaq/utils";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { openViz } from "./harness.ts";
import type { VizHarness } from "./harness.ts";

const docs = join(import.meta.dirname, "../../../apps/docs/src");

async function withViz(file: string, run: (viz: VizHarness) => Promise<void>): Promise<void> {
  const opened = await openViz({ file });
  const viz = Either.getRight(opened);
  if (viz === undefined) throw new Error(String(Either.getLeft(opened)));
  try {
    await run(viz);
  } finally {
    await viz.close();
  }
}

test("a blocked arrow's Left names the event once", async () => {
  await withViz(join(docs, "tutorial/meal-06.ts"), async (viz) => {
    expect(Either.getLeft(await viz.send("eat"))).toBe("eat is blocked: plates is 0");
  });
}, 60_000);

test("sendTo a region does not press another region's arrow", async () => {
  await withViz(join(docs, "content/docs/photo-upload.ts"), async (viz) => {
    const wrong = await viz.sendTo({ region: "network" }, "photoPicked", { fileName: "cat.jpg" });
    expect(Either.getLeft(wrong)).toBe(
      "no button for photoPicked: region network is in online, which offers: connectionLost.",
    );
    expect(await viz.regions()).toEqual({ network: "online", upload: "waitingForPhoto" });
  });
}, 60_000);

test("a worker's missing event names the worker's state and its row's events", async () => {
  await withViz(join(docs, "content/docs/photo-queue.ts"), async (viz) => {
    await viz.send("photoAdded", { photoId: "p1" });
    const wrong = await viz.sendTo({ map: "photos", key: "p1" }, "retryPressed");
    expect(Either.getLeft(wrong)).toBe(
      "no button for retryPressed: photos[p1] is in sendingPhoto, which offers: uploadConfirmed, uploadFailed.",
    );
  });
}, 60_000);

test("sendTo a worker sends its payload, names a blocked arrow, and a root event leaves the picked worker", async () => {
  await withViz(join(docs, "content/docs/photo-queue.ts"), async (viz) => {
    await viz.send("photoAdded", { photoId: "p1" });
    await viz.send("photoAdded", { photoId: "p2" });
    const sent = await viz.sendTo({ map: "photos", key: "p2" }, "uploadFailed");
    expect(Either.getRight(sent)?.state).toBeDefined();
    expect((await viz.children()).map((child) => `${child.key} ${child.state}`)).toEqual([
      "p1 sendingPhoto",
      "p2 waitingForRetry",
    ]);
    const root = await viz.send("photoAdded", { photoId: "p3" });
    expect(Either.getLeft(root)).toBeUndefined();
    expect((await viz.children()).map((child) => child.key)).toEqual(["p1", "p2", "p3"]);
  });
}, 60_000);
