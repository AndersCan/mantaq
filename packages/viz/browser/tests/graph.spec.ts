/**
 * Fixture gallery — structural assertions + golden screenshots.
 *
 * Structural gate (all platforms): every fixture renders its full node set,
 * the active node tracks the live path, edges are finite, nodes never
 * overlap, and the error contract holds.
 *
 * Golden gate (linux only): `toHaveScreenshot` baselines are committed under
 * __snapshots__/linux/; darwin/win32 baselines are gitignored, so the gate is
 * skipped there (screenshots are pixel-diffed by CI).
 */

import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { fixtureList } from "../fixtures/index.ts";

const isLinux = process.platform === "linux";

interface NodeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function openFixture(
  page: Page,
  fixtureId: string,
  theme: "light" | "dark" = "light",
): Promise<void> {
  await page.goto(`/?fixture=${fixtureId}&theme=${theme}`);
  await expect(page.getByTestId("fixture-label")).toBeVisible();
  await expect(page.getByTestId(`fixture-link-${fixtureId}`)).toHaveClass(/active/);
  await expect(page.getByTestId("flow-ready")).toHaveAttribute("data-ready", "true");
}

async function readNodeRects(page: Page): Promise<{ id: string; rect: NodeRect }[]> {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(".react-flow__node"));
    return nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      const id = node.querySelector("[data-node-id]")?.getAttribute("data-node-id") ?? "";
      return { id, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
    });
  });
}

for (const fixture of fixtureList) {
  test.describe(`fixture: ${fixture.id}`, () => {
    test("structural contract", async ({ page }) => {
      await openFixture(page, fixture.id);

      const canvas = page.locator("[data-node-count]");
      await expect(canvas).toHaveAttribute("data-node-count", String(fixture.declares.nodeCount));
      await expect(canvas).toHaveAttribute("data-edge-count", String(fixture.declares.edgeCount));

      if (fixture.errorAtMount) {
        await expect(canvas).toHaveAttribute("data-error", "true");
        await expect(page.getByRole("alert")).toBeVisible();
        await expect(page.locator(".react-flow__node")).toHaveCount(0);
        return;
      }

      await expect(canvas).not.toHaveAttribute("data-error", "true");

      // Full node id set, no stragglers.
      const renderedIds = await page
        .locator("[data-node-id]")
        .evaluateAll((els) => els.map((el) => el.getAttribute("data-node-id")).sort());
      expect(renderedIds).toEqual([...fixture.declares.nodeIds].sort());

      // Active-path truth (plan §9.5.1): the rendered [data-active] set
      // equals the live path flattened across regions.
      const active = page.locator('[data-active="true"]');
      const path = await page.evaluate(() => window.__viz?.getPath() ?? []);
      expect(path.length).toBeGreaterThan(0);
      const activeIds = await active.evaluateAll((els) =>
        els.map((el) => el.getAttribute("data-node-id")).sort(),
      );
      expect(activeIds).toEqual([...path].sort());

      // Finite geometry + no node-node overlap.
      const placed = await readNodeRects(page);
      expect(placed.length).toBe(fixture.declares.nodeCount);
      for (const { rect } of placed) {
        expect(Number.isFinite(rect.x)).toBe(true);
        expect(Number.isFinite(rect.y)).toBe(true);
        expect(rect.width).toBeGreaterThan(0);
        expect(rect.height).toBeGreaterThan(0);
      }
      for (let i = 0; i < placed.length; i += 1) {
        for (let j = i + 1; j < placed.length; j += 1) {
          const a = placed[i].rect;
          const b = placed[j].rect;
          const overlaps =
            a.x < b.x + b.width &&
            b.x < a.x + a.width &&
            a.y < b.y + b.height &&
            b.y < a.y + a.height;
          expect(overlaps, `${placed[i].id} overlaps ${placed[j].id}`).toBe(false);
        }
      }

      // All nodes inside the viewport (fitView contract). Only enforced for
      // graphs that can actually fit: at minZoom 0.2 a LR layout holds about
      // 26 columns of 180px nodes in a 1280px viewport — deeper graphs
      // (chain-50, dense-60) legitimately overflow and scroll.
      const viewport = page.viewportSize();
      if (viewport && fixture.declares.nodeCount <= 26) {
        for (const { id, rect } of placed) {
          expect(rect.x, `${id} left`).toBeGreaterThanOrEqual(-1);
          expect(rect.y, `${id} top`).toBeGreaterThanOrEqual(-1);
          expect(rect.x + rect.width, `${id} right`).toBeLessThanOrEqual(viewport.width + 1);
          expect(rect.y + rect.height, `${id} bottom`).toBeLessThanOrEqual(viewport.height + 1);
        }
      }
    });

    for (const theme of fixture.themes) {
      test(`golden ${theme}`, async ({ page }) => {
        test.skip(!isLinux, "golden baselines committed for linux only");
        await openFixture(page, fixture.id, theme);
        await expect(page).toHaveScreenshot(`${fixture.id}-${theme}.png`);
      });
    }
  });
}
