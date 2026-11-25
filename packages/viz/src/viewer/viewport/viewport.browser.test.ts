import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import type { Browser } from "playwright";
import { chromium } from "playwright";
import { createServer } from "vite";
import type { viewportOf } from "./viewport.ts";
import type { ViteDevServer } from "vite";

declare global {
  interface Window {
    viewportOf?: typeof viewportOf;
  }
}

let server: ViteDevServer;
let browser: Browser;
let origin = "";

beforeAll(async () => {
  server = await createServer({
    root: import.meta.dirname,
    configFile: false,
    logLevel: "silent",
    server: { port: 0, host: "127.0.0.1", watch: { ignored: ["**/*"] } },
  });
  await server.listen();
  origin = server.resolvedUrls?.local[0] ?? "";
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser.close();
  await server.close();
});

/** A bordered, padded scroll container like the viewer's canvas, with a drawing whose width reads the zoom. */
const PAGE = `
  <style>
    body { margin: 40px; }
    #canvas { width: 400px; height: 300px; overflow: auto; border: 5px solid; padding: 24px; }
    #canvas svg { display: block; width: calc(var(--viz-zoom) * 1000px); height: auto; }
  </style>
  <div id="canvas"><svg viewBox="0 0 1000 800"></svg></div>
`;

test("zoomAt keeps the drawing's point under the pointer put on a real scroll container", async () => {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(origin);
  await page.setContent(PAGE);
  await page.addScriptTag({
    type: "module",
    content: 'import { viewportOf } from "/viewport.ts"; window.viewportOf = viewportOf;',
  });
  await page.waitForFunction(() => window.viewportOf !== undefined);
  const drift = await page.evaluate(() => {
    const create = window.viewportOf;
    const canvas = document.querySelector<HTMLElement>("#canvas");
    const drawing = canvas?.querySelector("svg") ?? undefined;
    if (create === undefined || canvas === null || drawing === undefined) return [];
    const viewport = create(canvas, { drawing: () => drawing });
    canvas.scrollTo({ left: 200, top: 150, behavior: "instant" });
    const pointer = { x: 210, y: 180 };
    function underPointer(): { x: number; y: number } {
      const rect = drawing?.getBoundingClientRect() ?? new DOMRect();
      const { scale } = viewport.state();
      return { x: (pointer.x - rect.left) / scale, y: (pointer.y - rect.top) / scale };
    }
    const moved: Array<{ scale: number; put: boolean }> = [];
    for (const scale of [2.5, 0.75, 4, 1]) {
      const before = underPointer();
      viewport.zoomAt(pointer, { scale });
      const after = underPointer();
      const put =
        Math.abs(after.x - before.x) * scale < 1 && Math.abs(after.y - before.y) * scale < 1;
      moved.push({ scale: viewport.state().scale, put });
    }
    return moved;
  });
  expect(drift).toEqual([
    { scale: 2.5, put: true },
    { scale: 0.75, put: true },
    { scale: 4, put: true },
    { scale: 1, put: true },
  ]);
  await page.close();
}, 60_000);
