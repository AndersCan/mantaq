import { inspectFile, machineBrief } from "@mantaq/inspect";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

test("the counter model's brief", async () => {
  const { machines } = await inspectFile(
    fileURLToPath(new URL("./counter-model.ts", import.meta.url)),
  );
  await expect(machines.map(machineBrief).join("\n")).toMatchFileSnapshot("./counter-brief.md");
});
