import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import type { Browser, Page } from "playwright";
import { chromium } from "playwright";
import { createServer } from "vite";
import type { Point } from "./zoom.ts";
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
  // Classic scrollbars, as desktop Chrome on Windows and Linux draws them: they take room from the canvas.
  browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
}, 60_000);

afterAll(async () => {
  await browser.close();
  await server.close();
});

interface Layout {
  /** The page's style for `#canvas` and its drawing, whose width reads the zoom. */
  css: string;
  /** Where the page and the canvas are scrolled before the first zoom. */
  scroll: { page: Point; canvas: Point };
  /** The scale set before the zooms that are measured. */
  initial: number;
  pointer: Point;
  scales: number[];
}

const DRAWING =
  "#canvas svg { display: block; width: calc(var(--viz-zoom) * 1000px); height: auto; }";

/** A page with the layout's canvas, a 1000 by 800 drawing in it, and `viewportOf` on `window`. */
async function pageWith(css: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(origin);
  await page.setContent(
    `<style>body { margin: 40px; } ${DRAWING} ${css}</style><div id="canvas"><svg viewBox="0 0 1000 800"></svg></div>`,
  );
  await page.addScriptTag({
    type: "module",
    content: 'import { viewportOf } from "/viewport.ts"; window.viewportOf = viewportOf;',
  });
  await page.waitForFunction(() => window.viewportOf !== undefined);
  return page;
}

/** For each zoom, whether the drawing's point under the pointer stayed within a pixel on screen. */
async function zoomsPut(layout: Layout): Promise<Array<{ scale: number; put: boolean }>> {
  const page = await pageWith(layout.css);
  const moved = await page.evaluate((given) => {
    const create = window.viewportOf;
    const canvas = document.querySelector<HTMLElement>("#canvas");
    const drawing = canvas?.querySelector("svg") ?? undefined;
    if (create === undefined || canvas === null || drawing === undefined) return [];
    const viewport = create(canvas, { drawing: () => drawing });
    viewport.zoomAt(given.pointer, { scale: given.initial });
    window.scrollTo({ left: given.scroll.page.x, top: given.scroll.page.y, behavior: "instant" });
    canvas.scrollTo({
      left: given.scroll.canvas.x,
      top: given.scroll.canvas.y,
      behavior: "instant",
    });
    function underPointer(): Point {
      const rect = drawing?.getBoundingClientRect() ?? new DOMRect();
      const { scale } = viewport.state();
      return { x: (given.pointer.x - rect.left) / scale, y: (given.pointer.y - rect.top) / scale };
    }
    const put: Array<{ scale: number; put: boolean }> = [];
    for (const scale of given.scales) {
      const before = underPointer();
      viewport.zoomAt(given.pointer, { scale });
      const after = underPointer();
      const close =
        Math.abs(after.x - before.x) * scale < 1 && Math.abs(after.y - before.y) * scale < 1;
      put.push({ scale: viewport.state().scale, put: close });
    }
    return put;
  }, layout);
  await page.close();
  return moved;
}

test("zoomAt keeps the point under the pointer put in a bordered, padded canvas that scrolls both ways", async () => {
  const moved = await zoomsPut({
    css: "#canvas { width: 400px; height: 300px; overflow: auto; border: 5px solid; padding: 24px; }",
    scroll: { page: { x: 0, y: 0 }, canvas: { x: 200, y: 150 } },
    initial: 1,
    pointer: { x: 210, y: 180 },
    scales: [2.5, 0.75, 4, 1],
  });
  expect(moved).toEqual([
    { scale: 2.5, put: true },
    { scale: 0.75, put: true },
    { scale: 4, put: true },
    { scale: 1, put: true },
  ]);
}, 60_000);

test("zoomAt scrolls the page for what a canvas with no height limit cannot", async () => {
  const moved = await zoomsPut({
    css: "body { min-height: 3000px; } #canvas { width: 400px; overflow: auto; }",
    scroll: { page: { x: 0, y: 300 }, canvas: { x: 200, y: 0 } },
    initial: 1,
    pointer: { x: 210, y: 180 },
    scales: [2.5, 0.75, 4, 1],
  });
  expect(moved).toEqual([
    { scale: 2.5, put: true },
    { scale: 0.75, put: true },
    { scale: 4, put: true },
    { scale: 1, put: true },
  ]);
}, 60_000);

test("zoomAt keeps the point of a centered drawing that grows past the canvas", async () => {
  const moved = await zoomsPut({
    css: "#canvas { width: 400px; height: 300px; overflow: auto; } #canvas svg { margin: 0 auto; }",
    scroll: { page: { x: 0, y: 0 }, canvas: { x: 0, y: 0 } },
    initial: 0.25,
    pointer: { x: 190, y: 140 },
    scales: [1, 2],
  });
  expect(moved).toEqual([
    { scale: 1, put: true },
    { scale: 2, put: true },
  ]);
}, 60_000);

test("a long pinch of small steps keeps the first point under the pointer within a pixel", async () => {
  const page = await pageWith(
    "#canvas { width: 400px; height: 300px; overflow: auto; } #canvas svg { margin: 0 auto; }",
  );
  const drift = await page.evaluate(() => {
    const create = window.viewportOf;
    const canvas = document.querySelector<HTMLElement>("#canvas");
    const drawing = canvas?.querySelector("svg") ?? undefined;
    if (create === undefined || canvas === null || drawing === undefined) return Infinity;
    const viewport = create(canvas, { drawing: () => drawing });
    const pointer = { x: 173.3, y: 151.7 };
    viewport.zoomAt(pointer, { scale: 0.5 });
    function rect(): DOMRect {
      return drawing?.getBoundingClientRect() ?? new DOMRect();
    }
    const start = { x: (pointer.x - rect().left) / 0.5, y: (pointer.y - rect().top) / 0.5 };
    let largest = 0;
    for (const factor of [
      ...Array.from({ length: 80 }, () => 1.03),
      ...Array.from({ length: 80 }, () => 1 / 1.03),
    ]) {
      viewport.zoomAt(pointer, { scale: viewport.state().scale * factor, kind: "pinch" });
      const { scale } = viewport.state();
      const shown = { x: rect().left + start.x * scale, y: rect().top + start.y * scale };
      largest = Math.max(largest, Math.abs(shown.x - pointer.x), Math.abs(shown.y - pointer.y));
    }
    return largest;
  });
  expect(drift).toBeLessThan(1);
  await page.close();
}, 60_000);

test("panBy scrolls the page for what a canvas with no height limit cannot", async () => {
  const page = await pageWith(
    "body { min-height: 3000px; } #canvas { width: 400px; overflow: auto; }",
  );
  const scrolled = await page.evaluate(() => {
    const create = window.viewportOf;
    const canvas = document.querySelector<HTMLElement>("#canvas");
    const drawing = canvas?.querySelector("svg") ?? undefined;
    if (create === undefined || canvas === null || drawing === undefined) return undefined;
    create(canvas, { drawing: () => drawing }).panBy({ x: 120, y: 100 });
    return {
      canvas: { x: canvas.scrollLeft, y: canvas.scrollTop },
      page: { x: scrollX, y: scrollY },
    };
  });
  expect(scrolled).toEqual({ canvas: { x: 120, y: 0 }, page: { x: 0, y: 100 } });
  await page.close();
}, 60_000);

test("zoomAt keeps the point when the zoom out makes the page shorter than its scroll", async () => {
  const moved = await zoomsPut({
    css: 'body::after { content: ""; display: block; height: 1000px; } #canvas { width: 200px; overflow: auto; }',
    scroll: { page: { x: 0, y: 800 }, canvas: { x: 400, y: 0 } },
    initial: 1,
    pointer: { x: 140, y: 20 },
    scales: [0.25, 1],
  });
  expect(moved).toEqual([
    { scale: 0.25, put: true },
    { scale: 1, put: true },
  ]);
}, 60_000);

test("zooming in a canvas with a fixed height leaves the page where it was", async () => {
  const page = await pageWith(
    "body { min-height: 4000px; } #canvas { width: 400px; height: 300px; overflow: auto; margin-top: 600px; }",
  );
  const pageScroll = await page.evaluate(() => {
    const create = window.viewportOf;
    const canvas = document.querySelector<HTMLElement>("#canvas");
    const drawing = canvas?.querySelector("svg") ?? undefined;
    if (create === undefined || canvas === null || drawing === undefined) return [];
    const viewport = create(canvas, { drawing: () => drawing });
    window.scrollTo({ left: 0, top: 500, behavior: "instant" });
    const seen = [];
    viewport.zoomAt({ x: 430, y: 430 }, { scale: 0.25 });
    seen.push(scrollY);
    viewport.zoomIn();
    viewport.zoomIn();
    viewport.zoomOut();
    seen.push(scrollY);
    viewport.fit();
    seen.push(scrollY);
    return seen;
  });
  expect(pageScroll).toEqual([500, 500, 500]);
  await page.close();
}, 60_000);

test("on a page that scrolls, zoomIn keeps the center of the canvas on screen put and fit shows the drawing's top-left", async () => {
  const page = await pageWith(
    "body { min-height: 3000px; } #canvas { width: 400px; overflow: auto; }",
  );
  const seen = await page.evaluate(() => {
    const create = window.viewportOf;
    const canvas = document.querySelector<HTMLElement>("#canvas");
    const drawing = canvas?.querySelector("svg") ?? undefined;
    if (create === undefined || canvas === null || drawing === undefined) return undefined;
    const viewport = create(canvas, { drawing: () => drawing });
    window.scrollTo({ left: 0, top: 300, behavior: "instant" });
    const center = { x: 240, y: 270 };
    function underCenter(): Point {
      const rect = drawing?.getBoundingClientRect() ?? new DOMRect();
      const { scale } = viewport.state();
      return { x: (center.x - rect.left) / scale, y: (center.y - rect.top) / scale };
    }
    const before = underCenter();
    viewport.zoomIn();
    const after = underCenter();
    const scale = viewport.state().scale;
    const centerPut =
      Math.abs(after.x - before.x) * scale < 1 && Math.abs(after.y - before.y) * scale < 1;
    viewport.fit();
    const rect = drawing.getBoundingClientRect();
    return { centerPut, topLeftShown: Math.abs(rect.left - 40) < 1 && Math.abs(rect.top) < 1 };
  });
  expect(seen).toEqual({ centerPut: true, topLeftShown: true });
  await page.close();
}, 60_000);

test("fit brings the drawing back on screen on a page that scrolls, also when the scale is already the fit scale", async () => {
  const page = await pageWith(
    "body { min-height: 3000px; } #canvas { width: 400px; overflow: auto; margin-top: 300px; }",
  );
  const tops = await page.evaluate(() => {
    const create = window.viewportOf;
    const canvas = document.querySelector<HTMLElement>("#canvas");
    const drawing = canvas?.querySelector("svg") ?? undefined;
    if (create === undefined || canvas === null || drawing === undefined) return [];
    const viewport = create(canvas, {
      drawing: () => drawing,
      fitBox: () => ({ width: 400, height: 500 }),
    });
    const seen = [];
    for (let press = 0; press < 2; press += 1) {
      window.scrollTo({ left: 0, top: 900, behavior: "instant" });
      viewport.fit();
      seen.push(Math.abs(drawing.getBoundingClientRect().top) < 1);
    }
    return seen;
  });
  expect(tops).toEqual([true, true]);
  await page.close();
}, 60_000);

test("panBy leaves an axis alone where the page hides its overflow", async () => {
  const page = await pageWith(
    "body { overflow-x: hidden; min-height: 3000px; } body::before { content: ''; display: block; width: 3000px; height: 1px; } #canvas { width: 400px; height: 300px; overflow: auto; }",
  );
  const scrolled = await page.evaluate(() => {
    const create = window.viewportOf;
    const canvas = document.querySelector<HTMLElement>("#canvas");
    const drawing = canvas?.querySelector("svg") ?? undefined;
    if (create === undefined || canvas === null || drawing === undefined) return undefined;
    create(canvas, { drawing: () => drawing }).panBy({ x: 5000, y: 5000 });
    return { page: { x: scrollX, y: scrollY } };
  });
  expect(scrolled?.page.x).toBe(0);
  await page.close();
}, 60_000);
