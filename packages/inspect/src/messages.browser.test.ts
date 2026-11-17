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
    plugins: [mantaqViz({ machines: ["lost-message.ts"], fuzz: { iterations: 300 } })],
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

test("a message between two machines is a dotted line, and an arrow's click still wins", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${origin}/__mantaq/?machine=checkout`);
  await page.locator("g.edge").first().waitFor();
  expect(await page.locator(".load-error").count()).toBe(0);
  const lines = await page.locator("g.message").evaluateAll((groups) =>
    groups.map((group) => ({
      from: group.getAttribute("data-message-from"),
      to: group.getAttribute("data-message-to"),
      text: group.querySelectorAll("text").length,
      arrow: group.querySelectorAll("path[marker-end]").length,
      dashed: getComputedStyle(group.querySelector("path") as Element).strokeDasharray !== "none",
    })),
  );
  expect(lines).toEqual([
    { from: "waitingForPayment", to: "payment.ready", text: 0, arrow: 1, dashed: true },
    { from: "gaveUp", to: "payment.charging", text: 0, arrow: 1, dashed: true },
  ]);
  expect(await page.locator("g.edge").count()).toBe(6);
  await page.screenshot({ path: process.env["MESSAGES_SHOT"] ?? "/tmp/messages-checkout.png" });

  const click = await page.evaluate(() => {
    const path = document.querySelector<SVGPathElement>(
      'g[data-edge-id="browsing-PAY_CLICKED-waitingForPayment"] path:not(.hit)',
    );
    const matrix = path?.getScreenCTM();
    if (path === null || path === undefined || matrix === null || matrix === undefined) return null;
    const at = path.getPointAtLength(path.getTotalLength() * 0.6);
    const point = new DOMPoint(at.x, at.y).matrixTransform(matrix);
    return { x: point.x, y: point.y };
  });
  if (click === null) throw new Error("no PAY_CLICKED arrow");
  await page.mouse.click(click.x, click.y);
  await page
    .getByText("Then checkout sent PAYMENT_STARTED to payment: ready → charging")
    .first()
    .waitFor();
  await page.close();
}, 60_000);
