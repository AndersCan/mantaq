import { Either } from "@mantaq/utils";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { openViz } from "./harness.ts";

const photoUpload = join(
  import.meta.dirname,
  "../../../apps/docs/src/content/docs/photo-upload.ts",
);

test("drives the regions of the docs photo upload", async () => {
  const opened = await openViz({ file: photoUpload });
  const viz = Either.getRight(opened);
  if (viz === undefined) throw new Error(String(Either.getLeft(opened)));
  try {
    expect(await viz.regions()).toEqual({ network: "online", upload: "waitingForPhoto" });
    const picked = await viz.sendTo({ region: "upload" }, "photoPicked", { fileName: "cat.jpg" });
    expect(Either.getRight(picked)?.outcome).toBe("transition");
    expect(await viz.regions()).toEqual({ network: "online", upload: "sendingPhoto" });
    expect(await viz.state()).toBe("showingUploadScreen");
    await viz.sendTo({ region: "network" }, "connectionLost");
    expect((await viz.regions())["network"]).toBe("offline");
    await viz.sendTo({ region: "upload" }, "uploadConfirmed");
    expect(await viz.state()).toBe("showingUploadedPhoto");
    expect(viz.findings()).toEqual([]);
    const wrong = await viz.sendTo({ region: "uplod" }, "photoPicked");
    expect(Either.getLeft(wrong)).toBe(
      'no region "uplod" in photoUpload. Regions: network, upload.',
    );
    expect(viz.problems()).toEqual([]);
  } finally {
    await viz.close();
  }
}, 60_000);
