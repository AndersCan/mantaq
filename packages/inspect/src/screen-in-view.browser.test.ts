import { mantaqViz } from "./vite.ts";
import { join } from "node:path";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";

let server: ViteDevServer;
let browser: Browser;
let origin = "";

beforeAll(async () => {
  server = await createServer({
    root: join(import.meta.dirname, "fixtures"),
    configFile: false,
    logLevel: "silent",
    server: { port: 0, host: "127.0.0.1", watch: { ignored: ["**/*"] } },
    plugins: [mantaqViz({ machines: ["tall.ts", "tall.preview.ts"], fuzz: { iterations: 3000 } })],
  });
  await server.listen();
  const address = server.httpServer?.address();
  origin = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;
  browser = await chromium.launch({ executablePath: process.env["CHROMIUM_PATH"] || undefined });
}, 60_000);

afterAll(async () => {
  await browser.close();
  await server.close();
});

test("shows the Screen of a state far down a tall graph inside a 1400x800 window", async () => {
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  await page.goto(`${origin}/__mantaq/?machine=tall`);
  await page.getByRole("tab", { name: "Screen" }).click();
  await page.locator('g[data-node-id="leaf18"]').first().click();
  const frame = page.frameLocator("iframe");
  await frame.getByText("chain is at leaf18").waitFor();
  // The tab panel scrolls and clips: a frame taller than it is cut off even when its own box is in the window.
  const shown = await page.evaluate(() => {
    const box = document.querySelector("iframe")?.getBoundingClientRect();
    const clip = document.querySelector(".tab-panel")?.getBoundingClientRect();
    if (box === undefined || clip === undefined) return { inWindow: false, inPanel: false };
    return {
      inWindow: box.top >= 0 && box.bottom <= innerHeight,
      inPanel: box.top >= clip.top && box.bottom <= clip.bottom,
    };
  });
  expect(shown).toEqual({ inWindow: true, inPanel: true });
  await page.close();
}, 60_000);

test("the Screen tab is exempt from the Step panel's quarter-window cap", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${origin}/__mantaq/?machine=tall`);
  await page.getByRole("tab", { name: "Screen" }).click();
  const height = await page.evaluate(
    () => document.querySelector("iframe")?.getBoundingClientRect().height ?? 0,
  );
  expect(height).toBeGreaterThan(800 / 4);
  await page.close();
}, 60_000);

test("an arrow's ? and a click on an arrow that cannot be sent leave the page where it is", async () => {
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  await page.goto(`${origin}/__mantaq/?machine=tall`);
  const scrollY = () => page.evaluate(() => window.scrollY);
  const clickCentre = async (target: ReturnType<typeof page.locator>) => {
    const box = await target.boundingBox();
    if (box === null) throw new Error("no box");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };
  const clickPath = (id: string) =>
    page.evaluate((edgeId) => {
      const path = document.querySelector<SVGPathElement>(
        `g[data-edge-id="${edgeId}"] path:not(.hit)`,
      );
      const matrix = path?.getScreenCTM();
      if (path === null || path === undefined || matrix === null || matrix === undefined) {
        return { x: 0, y: 0 };
      }
      const point = path.getPointAtLength(path.getTotalLength() * 0.6);
      return { x: point.x * matrix.a + matrix.e, y: point.y * matrix.d + matrix.f };
    }, id);
  const help = page.locator('[data-details-edge="hub-go17-leaf17"]');
  await help.scrollIntoViewIfNeeded();
  const helpBefore = await scrollY();
  await clickCentre(help);
  await page.waitForTimeout(300);
  expect(await scrollY()).toBe(helpBefore);
  const send = await clickPath("hub-go17-leaf17");
  await page.mouse.click(send.x, send.y);
  await page.locator('g[data-edge-id="hub-go15-leaf15"]').scrollIntoViewIfNeeded();
  const refusedBefore = await scrollY();
  const refused = await clickPath("hub-go15-leaf15");
  await page.mouse.click(refused.x, refused.y);
  await page.waitForTimeout(300);
  expect(await scrollY()).toBe(refusedBefore);
  const label = { name: "hub on go15 to leaf15", exact: true };
  expect({
    arrows: await page.getByLabel(label.name, { exact: true }).count(),
    buttons: await page.getByRole("button", label).count(),
  }).toEqual({ arrows: 1, buttons: 0 });
  await page.close();
}, 60_000);
