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
