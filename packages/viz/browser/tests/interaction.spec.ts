/**
 * Interaction tests — drive the mounted actor through `window.__viz` and
 * assert the UI follows the live path (plan §9.3).
 */

import { test, expect } from "@playwright/test";

test("traffic-light: bridge send advances the active node", async ({ page }) => {
  await page.goto("/?fixture=traffic-light&theme=light");
  await expect(page.getByTestId("flow-ready")).toHaveAttribute("data-ready", "true");

  // Pre-scripted 21 ticks land back on red.
  await expect(page.locator('[data-active="true"]')).toHaveAttribute("data-node-id", "red");

  await page.evaluate(() => window.__viz?.send("tick"));
  await expect(page.locator('[data-active="true"]')).toHaveAttribute("data-node-id", "green");
  await expect(page.evaluate(() => window.__viz?.getPath())).resolves.toEqual(["green"]);

  await page.evaluate(() => window.__viz?.send("tick"));
  await expect(page.locator('[data-active="true"]')).toHaveAttribute("data-node-id", "yellow");
});

test("checkout: send + advance completes the machine", async ({ page }) => {
  await page.goto("/?fixture=checkout&theme=light");
  await expect(page.getByTestId("flow-ready")).toHaveAttribute("data-ready", "true");

  // Pre-scripted to payment.
  await expect(page.locator('[data-active="true"]')).toHaveAttribute("data-node-id", "payment");

  // submitPayment → submitting (spawns an 800ms timeout + a resolved promise).
  await page.evaluate(() =>
    window.__viz?.send("submitPayment", { cardNumber: "1111222233334444" }),
  );
  await expect(page.locator('[data-active="true"]')).toHaveAttribute("data-node-id", "submitting");

  // Both paymentOk (microtask) and submittingDone (timer) lead to success.
  await page.evaluate(() => window.__viz?.advance(800));
  await expect(page.locator('[data-active="true"]')).toHaveAttribute("data-node-id", "success");
});

test("self-loop: bridge send keeps the same active node", async ({ page }) => {
  await page.goto("/?fixture=self-loop&theme=light");
  await expect(page.getByTestId("flow-ready")).toHaveAttribute("data-ready", "true");

  await expect(page.locator('[data-active="true"]')).toHaveAttribute("data-node-id", "wait");
  await page.evaluate(() => window.__viz?.send("loop"));
  await expect(page.locator('[data-active="true"]')).toHaveAttribute("data-node-id", "wait");
});

test("saga: advance walks the happy path to completed", async ({ page }) => {
  await page.goto("/?fixture=saga&theme=light");
  await expect(page.getByTestId("flow-ready")).toHaveAttribute("data-ready", "true");

  // Pre-scripted START → mid-flight in the first step.
  await expect(page.locator('[data-active="true"]')).toHaveAttribute(
    "data-node-id",
    "reservingInventory",
  );

  // 100 + 200 + 150 + 50ms across the four saga steps.
  await page.evaluate(() => window.__viz?.advance(500));
  await expect(page.locator('[data-active="true"]')).toHaveAttribute("data-node-id", "completed");
  await expect(page.evaluate(() => window.__viz?.getPath())).resolves.toEqual(["completed"]);
});

test("auth: sign-in advances to loggedIn, sign-out returns to loggedOut", async ({ page }) => {
  await page.goto("/?fixture=auth&theme=light");
  await expect(page.getByTestId("flow-ready")).toHaveAttribute("data-ready", "true");

  // Pre-scripted SIGN_IN (deterministic success roll) → mid-flight.
  await expect(page.locator('[data-active="true"]')).toHaveAttribute("data-node-id", "signingIn");

  await page.evaluate(() => window.__viz?.advance(2000));
  await expect(page.locator('[data-active="true"]')).toHaveAttribute("data-node-id", "loggedIn");

  await page.evaluate(() => window.__viz?.send("signOut"));
  await expect(page.locator('[data-active="true"]')).toHaveAttribute("data-node-id", "signingOut");

  await page.evaluate(() => window.__viz?.advance(500));
  await expect(page.locator('[data-active="true"]')).toHaveAttribute("data-node-id", "loggedOut");
});

test("connection-manager: health region follows forwarded checks", async ({ page }) => {
  await page.goto("/?fixture=connection-manager&theme=light");
  await expect(page.getByTestId("flow-ready")).toHaveAttribute("data-ready", "true");

  // Pre-scripted CONNECT → connecting with the health region unknown.
  await expect(page.evaluate(() => window.__viz?.getPath())).resolves.toEqual([
    "connecting",
    "health.unknown",
  ]);

  // Connect establishes after 2000ms.
  await page.evaluate(() => window.__viz?.advance(2000));
  await expect(page.evaluate(() => window.__viz?.getPath())).resolves.toEqual([
    "connected",
    "health.unknown",
  ]);

  // Unhealthy check: the root forwards to the region and falls back.
  await page.evaluate(() => window.__viz?.send("healthCheckResult", { healthy: false }));
  await expect(page.evaluate(() => window.__viz?.getPath())).resolves.toEqual([
    "reconnecting",
    "health.degraded",
  ]);

  // Backoff (1000ms at retryCount 0) re-establishes the connection.
  await page.evaluate(() => window.__viz?.advance(1000));
  await expect(page.evaluate(() => window.__viz?.getPath())).resolves.toEqual([
    "connected",
    "health.degraded",
  ]);
});

test("websocket: reconnect cycle walks connecting → connected → reconnecting", async ({ page }) => {
  await page.goto("/?fixture=websocket&theme=light");
  await expect(page.getByTestId("flow-ready")).toHaveAttribute("data-ready", "true");

  // Pre-scripted CONNECT → connecting (500ms connect pending).
  await expect(page.locator('[data-active="true"]')).toHaveAttribute("data-node-id", "connecting");

  await page.evaluate(() => window.__viz?.advance(500));
  await expect(page.locator('[data-active="true"]')).toHaveAttribute("data-node-id", "connected");

  // Force reconnect: backoff (1000ms at retryCount 0) → connecting → connected.
  await page.evaluate(() => window.__viz?.send("forceReconnect"));
  await expect(page.locator('[data-active="true"]')).toHaveAttribute(
    "data-node-id",
    "reconnecting",
  );

  await page.evaluate(() => window.__viz?.advance(1000));
  await expect(page.locator('[data-active="true"]')).toHaveAttribute("data-node-id", "connecting");

  await page.evaluate(() => window.__viz?.advance(500));
  await expect(page.locator('[data-active="true"]')).toHaveAttribute("data-node-id", "connected");
});

test("cache: put evicts, get misses, purge returns to ready", async ({ page }) => {
  await page.goto("/?fixture=cache&theme=light");
  await expect(page.getByTestId("flow-ready")).toHaveAttribute("data-ready", "true");

  // Pre-scripted PUT a,b,c past capacity 2 → full → evicted → ready.
  await expect(page.evaluate(() => window.__viz?.getPath())).resolves.toEqual(["ready", "tier.l1"]);

  // 4th put over capacity: full → eviction settles synchronously.
  await page.evaluate(() => window.__viz?.send("put", { key: "d", value: 4 }));
  await expect(page.evaluate(() => window.__viz?.getPath())).resolves.toEqual(["ready", "tier.l1"]);

  // "a" was evicted — the get is a miss but stays in ready.
  await page.evaluate(() => window.__viz?.send("get", { key: "a" }));
  await expect(page.evaluate(() => window.__viz?.getPath())).resolves.toEqual(["ready", "tier.l1"]);

  // Purge: purging effect emits purgeDone synchronously → ready.
  await page.evaluate(() => window.__viz?.send("purge"));
  await expect(page.evaluate(() => window.__viz?.getPath())).resolves.toEqual(["ready", "tier.l1"]);
});

test("undo-redo: undo/redo drain stacks, editing → idle both ways", async ({ page }) => {
  await page.goto("/?fixture=undo-redo&theme=light");
  await expect(page.getByTestId("flow-ready")).toHaveAttribute("data-ready", "true");

  // Pre-scripted inserts "h" then "i" → editing with a two-entry undo stack.
  await expect(page.locator('[data-active="true"]')).toHaveAttribute("data-node-id", "editing");

  // Undo twice: stack drains → idle.
  await page.evaluate(() => window.__viz?.send("undo"));
  await expect(page.locator('[data-active="true"]')).toHaveAttribute("data-node-id", "editing");
  await page.evaluate(() => window.__viz?.send("undo"));
  await expect(page.locator('[data-active="true"]')).toHaveAttribute("data-node-id", "idle");

  // Redo twice: stack drains → idle.
  await page.evaluate(() => window.__viz?.send("redo"));
  await expect(page.locator('[data-active="true"]')).toHaveAttribute("data-node-id", "editing");
  await page.evaluate(() => window.__viz?.send("redo"));
  await expect(page.locator('[data-active="true"]')).toHaveAttribute("data-node-id", "idle");

  // A fresh insert leaves editing.
  await page.evaluate(() => window.__viz?.send("insertText", { text: "x", at: 2 }));
  await expect(page.locator('[data-active="true"]')).toHaveAttribute("data-node-id", "editing");
});
