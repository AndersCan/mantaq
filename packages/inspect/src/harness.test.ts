import { Either } from "@mantaq/utils";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { openViz, type VizHarness } from "./harness.ts";

const docs = (file: string) =>
  join(import.meta.dirname, "../../../apps/docs/src/content/docs", file);
const checkout = docs("checkout.ts");

// one harness per test, closed in finally
async function withViz<T>(
  file: string,
  machineOrRun: string | ((viz: VizHarness) => Promise<T>),
  maybeRun?: (viz: VizHarness) => Promise<T>,
): Promise<T> {
  const machine = typeof machineOrRun === "string" ? machineOrRun : undefined;
  const run = typeof machineOrRun === "string" ? maybeRun! : machineOrRun;
  const opened = await openViz({ file, machine });
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
      expect.objectContaining({ kind: "unreachableState", state: "refunding" }),
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

const fixture = (file: string) => join(import.meta.dirname, "fixtures", file);

test("an event the state ignores is a result, not an error", async () => {
  await withViz(checkout, async (viz) => {
    const result = await viz.send("submitShipping");
    expect(Either.getRight(result)).toEqual({ state: "basicInfo", outcome: "ignored" });
  });
}, 60_000);

test("says why the form refused a payload", async () => {
  await withViz(fixture("factories.ts"), "door", async (viz) => {
    const result = await viz.send("open", { by: "key", tags: "[oops" });
    expect(Either.getLeft(result)).toBe("open was not sent: Not sent: tags is not valid JSON.");
  });
}, 60_000);

test("says when an event takes no payload", async () => {
  await withViz(fixture("harness-empty.ts"), async (viz) => {
    const result = await viz.send("ping", { some: 1 });
    expect(Either.getLeft(result)).toBe("ping takes no payload.");
  });
}, 60_000);

test("fills a choice field and sends a payload with the custom box", async () => {
  await withViz(fixture("fields.ts"), async (viz) => {
    const choice = await viz.send("choose", { validFor: "1h" });
    expect(Either.getRight(choice)).toEqual({ state: "idle", outcome: "stay" });
    const custom = await viz.send("touch", { anything: 1 });
    expect(Either.getRight(custom)).toEqual({ state: "idle", outcome: "stay" });
  });
}, 60_000);

test("close is idempotent and send after close is a Left", async () => {
  const opened = await openViz({ file: checkout });
  const viz = Either.getRight(opened);
  if (viz === undefined) {
    throw new Error(String(Either.getLeft(opened)));
  }
  await viz.close();
  await viz.close();
  expect(Either.getLeft(await viz.send("back"))).toBe("harness is closed");
}, 60_000);

test("a failed open leaves no temp directory behind", async () => {
  const count = () => readdirSync(tmpdir()).filter((n) => n.startsWith("mantaq-harness-")).length;
  const before = count();
  const result = await openViz({ file: join(tmpdir(), "does-not-exist.ts") });
  expect(Either.getLeft(result)).toBe("does-not-exist.ts has no machine the inspector can read.");
  expect(count()).toBe(before);
}, 60_000);

test("says when an export is not live", async () => {
  const result = await openViz({ file: fixture("factories.ts"), machine: "realDoor" });
  expect(Either.getLeft(result)).toMatch(/^realDoor is not live: /);
}, 60_000);

test("collects console errors", async () => {
  await withViz(fixture("harness-odd.ts"), async (viz) => {
    await viz.send("noisy");
    expect(viz.problems()).toEqual(["harness-noise"]);
  });
}, 60_000);

test("an uncaught error in the page lands in problems", async () => {
  await withViz(fixture("harness-odd.ts"), async (viz) => {
    await viz.send("crash");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(viz.problems().join("\n")).toContain("harness-crash");
  });
}, 60_000);

test("submitPayment waits in submitting with its three reports", async () => {
  await withViz(checkout, async (viz) => {
    const state = async (event: string) =>
      Either.getRight(await viz.send(event))?.state ?? `no ${event}`;
    expect(await state("submitBasicInfo")).toBe("shippingAddress");
    expect(await state("submitShipping")).toBe("payment");
    expect(await state("submitPayment")).toBe("submitting");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await viz.state()).toBe("submitting");
    expect(await viz.waiting()).toEqual([
      { effect: "chargeCard", reports: ["paymentOk", "paymentFail", "paymentTimeout"] },
    ]);
    expect(await viz.text()).toContain("In submitting, waiting for chargeCard");
    expect(await state("paymentFail")).toBe("error");
    expect(await state("back")).toBe("payment");
    expect(await state("submitPayment")).toBe("submitting");
    expect(await state("paymentTimeout")).toBe("error");
    expect(await state("back")).toBe("payment");
    expect(await state("submitPayment")).toBe("submitting");
    expect(await state("paymentOk")).toBe("success");
    expect(viz.problems()).toEqual([]);
  });
}, 60_000);

test("the planted-bug machine shows six findings and replays the dead end", async () => {
  await withViz(docs("checkout-with-bugs.ts"), async (viz) => {
    const findings = viz.findings();
    expect(findings).toHaveLength(6);
    expect(findings.map((each) => each.title)).toEqual([
      "back in payment throws",
      'payment was reached with {"address":""}',
      "paymentDeclined is a dead end",
      "refunded can never be reached",
      "refunding can never be reached",
      "cancelOrder is declared but no state handles it",
    ]);
    const deadEnd = findings.find((each) => each.kind === "deadEnd")!;
    expect(Either.getRight(await viz.replay(deadEnd))).toEqual({ state: "paymentDeclined" });
    expect(await viz.state()).toBe("paymentDeclined");
    const refunded = findings.find((each) => each.state === "refunded")!;
    expect(refunded.steps ?? []).toEqual([]);
    expect(Either.getLeft(await viz.replay(refunded))).toBe(
      "refunded can never be reached has nothing to replay.",
    );
    const text = await viz.text();
    for (const old of [
      "Handler throws",
      "Never-see context reached",
      "Must-see context missed",
      "Event nobody handles",
      "Dead end",
      "Unreachable state",
    ]) {
      expect(text).not.toContain(old);
    }
    expect(viz.problems()).toEqual([]);
  });
}, 60_000);

test("fills a choice field shown as a row of buttons", async () => {
  const answer = join(import.meta.dirname, "fixtures", "answer.ts");
  await withViz(answer, async (viz) => {
    const asked = await viz.send("ask", { code: "c1", album: "Trip" });
    expect(Either.getRight(asked)).toEqual({ state: "waitingForAnswer", outcome: "transition" });
    const answered = await viz.send("answered", { code: "c1", answer: "declined" });
    expect(Either.getRight(answered)).toEqual({ state: "declined", outcome: "transition" });
  });
}, 60_000);
