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
    plugins: [mantaqViz({ machines: ["tall-parts.ts"], fuzz: { iterations: 3000 } })],
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

test("a step inside an opened machine keeps the new state between the name bar and the Step panel", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${origin}/__mantaq/?machine=tallParts`);
  await page.locator('g.part[data-part="tall"]').click();
  await page.locator('svg[data-zoom="tall"]').waitFor();
  const band = () =>
    page.evaluate(() => {
      const bar = document.querySelector(".viz-bar")?.getBoundingClientRect().bottom ?? 0;
      const panel = document.querySelector(".panel")?.getBoundingClientRect().top ?? innerHeight;
      const at = (selector: string) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect !== undefined && rect.top >= bar && rect.bottom <= panel;
      };
      return { hub: at('g.state[data-node-id="tall.hub"]'), leaf: at("g.state.current") };
    });
  expect((await band()).hub).toBe(true);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  const point = await page.evaluate(() => {
    const path = document.querySelector<SVGPathElement>(
      'g.edge[data-to="tall.leaf19"] path:not(.hit)',
    );
    path?.scrollIntoView({ block: "center", behavior: "instant" });
    const matrix = path?.getScreenCTM();
    if (!path || !matrix) return { x: 0, y: 0 };
    const at = path.getPointAtLength(path.getTotalLength() * 0.6);
    return { x: at.x * matrix.a + matrix.e, y: at.y * matrix.d + matrix.f };
  });
  await page.mouse.click(point.x, point.y);
  await page.locator('g.state.current[data-node-id="tall.leaf19"]').waitFor();
  expect((await band()).leaf).toBe(true);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.getByRole("button", { name: "Reset" }).click();
  await page.locator('g.state.current[data-node-id="tall.hub"]').waitFor();
  expect((await band()).hub).toBe(true);
  await page.close();
}, 60_000);
