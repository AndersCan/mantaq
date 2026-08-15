import { test, expect } from "@playwright/test";

/* Phase 0 smoke — the stub page renders and is screenshotable. Replaced by
 * the fixture gallery specs in Phase 1. */
test("stub page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("stub")).toBeVisible();
  await expect(page.getByTestId("stub")).toHaveText(/phase 0/);
  await expect(page).toHaveScreenshot("stub.png");
});
