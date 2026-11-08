import { Either } from "@mantaq/utils";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { openViz, type VizHarness } from "./harness.ts";

const docs = (file: string) =>
  join(import.meta.dirname, "../../../apps/docs/src/content/docs", file);
const checkout = docs("checkout.ts");

// one harness per test, closed in finally
async function withViz<T>(file: string, run: (viz: VizHarness) => Promise<T>): Promise<T> {
  const opened = await openViz({ file });
  const viz = Either.getRight(opened);
  if (viz === undefined) {
    throw new Error(String(Either.getLeft(opened)));
  }
  try {
    return await run(viz);
  } finally {
    await viz.close();
  }
}

test("opens the docs checkout and sends events by name", async () => {
  await withViz(checkout, async (viz) => {
    expect(await viz.state()).toBe("basicInfo");
    const first = await viz.send("submitBasicInfo", { email: "ana@example.com", name: "Ana" });
    expect(Either.getRight(first)).toEqual({ state: "shippingAddress", outcome: "transition" });
    const second = await viz.send("submitShipping");
    expect(Either.getRight(second)).toEqual({ state: "payment", outcome: "transition" });
    expect(viz.problems()).toEqual([]);
  });
}, 60_000);

test("says what is offered when an event is not", async () => {
  await withViz(checkout, async (viz) => {
    const result = await viz.send("paymentOk");
    expect(Either.getLeft(result)).toMatch(
      /^no button for paymentOk: checkout is in basicInfo, which offers: /,
    );
  });
}, 60_000);

test("names the fields when one is wrong", async () => {
  await withViz(checkout, async (viz) => {
    const result = await viz.send("submitBasicInfo", { phone: "1" });
    expect(Either.getLeft(result)).toBe("submitBasicInfo has no field phone. Fields: email, name.");
  });
}, 60_000);

test("names the machines when the id is wrong", async () => {
  const result = await openViz({ file: checkout, machine: "chekout" });
  expect(Either.getLeft(result)).toBe('no machine "chekout" in checkout.ts. Found: checkout.');
}, 60_000);

test("reads findings from the built document", async () => {
  await withViz(docs("checkout-with-bugs.ts"), async (viz) => {
    expect(viz.findings()).toContainEqual(
      expect.objectContaining({ kind: "unreachableState", state: "archived" }),
    );
  });
}, 60_000);

test("takes a screenshot", async () => {
  await withViz(checkout, async (viz) => {
    const bytes = await viz.screenshot();
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const dir = mkdtempSync(join(tmpdir(), "shot-"));
    try {
      const path = join(dir, "a.png");
      await viz.screenshot(path);
      expect(existsSync(path)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}, 60_000);

test("waiting is empty where no effect waits", async () => {
  await withViz(checkout, async (viz) => {
    expect(await viz.waiting()).toEqual([]);
  });
}, 60_000);
