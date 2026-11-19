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
    plugins: [
      mantaqViz({
        machines: ["tall-screen-parts.ts", "tall-screen-parts.preview.ts"],
        fuzz: { iterations: 3000 },
      }),
    ],
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

test("with the Screen tab open, a step inside an opened machine keeps the new state above the taller Step panel", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${origin}/__mantaq/?machine=tallScreenParts`);
  await page.locator('g.part[data-part="tall"]').click();
  await page.locator('svg[data-zoom="tall"]').waitFor();
  await page.getByRole("tab", { name: "Screen" }).waitFor();
  await page.locator('g.edge[data-to="tall.leaf19"]').dispatchEvent("click");
  await page.locator('g.state.current[data-node-id="tall.leaf19"]').waitFor();
  const shown = await page.evaluate(() => {
    const bar = document.querySelector(".viz-bar")?.getBoundingClientRect().bottom ?? 0;
    const panel = document.querySelector(".panel")?.getBoundingClientRect().top ?? innerHeight;
    const rect = document.querySelector("g.state.current")?.getBoundingClientRect();
    return { bar, panel, top: rect?.top, bottom: rect?.bottom };
  });
  expect(shown.top).toBeGreaterThanOrEqual(shown.bar);
  expect(shown.bottom).toBeLessThanOrEqual(shown.panel);
  await page.close();
}, 60_000);
