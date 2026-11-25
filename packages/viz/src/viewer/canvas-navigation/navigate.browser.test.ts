import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import type { Browser, Page } from "playwright";
import { mkdtempSync, rmSync } from "node:fs";
import { browserTestEnv } from "../viewport/env.ts";
import { chromium } from "playwright";
import { createServer } from "vite";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ViteDevServer } from "vite";

declare global {
  interface Window {
    /** The steps the viewer's driver got. */
    sent?: unknown[];
    /** Whether each keydown that reached the window was cancelled. */
    held?: boolean[];
  }
}

let server: ViteDevServer;
let browser: Browser;
let origin = "";
let cacheDir = "";

beforeAll(async () => {
  // Its own dependency cache: another Vite in the same run that bundles dagre would make this one's copy outdated (a 504).
  cacheDir = mkdtempSync(join(tmpdir(), "viz-navigate-"));
  server = await createServer({
    root: join(import.meta.dirname, ".."),
    configFile: false,
    cacheDir,
    optimizeDeps: { include: ["@dagrejs/dagre"] },
    logLevel: "silent",
    server: { port: 0, host: "127.0.0.1", watch: { ignored: ["**/*"] } },
  });
  await server.listen();
  origin = server.resolvedUrls?.local[0] ?? "";
  browser = await chromium.launch({ executablePath: browserTestEnv().chromiumPath });
}, 60_000);

afterAll(async () => {
  await browser.close();
  await server.close();
  rmSync(cacheDir, { recursive: true, force: true });
});

/** A shop order that runs through ten states, one event each, so its drawing runs wide. */
const VIEWER = `
import { mountViewer } from "/viewer.ts";
import { edgeOf, machineOf, stateOf } from "/groups/shop-machines.ts";
import { walkDriver } from "/groups/walk-driver.ts";
const names = ["cart", "address", "shipping", "payment", "review", "paid", "picked", "packed", "shipped", "delivered"];
const states = names.map((name, index) => stateOf(name, { initial: index === 0 }));
const edges = [edgeOf("__initial__", { event: "", to: "cart", kind: "initial" })];
for (const [index, name] of names.slice(1).entries()) edges.push(edgeOf(names[index], { event: "to" + name, to: name }));
const machine = machineOf({ states, edges });
const { driver, sent } = walkDriver(machine, { guarded: new Set() });
const diagramOnly = new URLSearchParams(location.search).has("diagram-only");
mountViewer(document.querySelector("#viewer"), { schemaVersion: 1, machines: [machine] }, { driver, diagramOnly });
window.sent = sent;
`;

interface ViewerPageOptions {
  /** "diagram": the viewer opens with Diagram only, so Show controls draws it all again. */
  shows?: "all" | "diagram";
}

/** A page with an input above the viewer, the viewer's sheet, and the shop order mounted. */
async function viewerPage(options: ViewerPageOptions = {}): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.goto(options.shows === "diagram" ? `${origin}?diagram-only` : origin);
  await page.setContent(
    '<link rel="stylesheet" href="/viewer.css"><style>body { margin: 16px; min-height: 3000px; }</style><input id="outside" aria-label="Outside"><div id="viewer"></div>',
  );
  await page.addScriptTag({ type: "module", content: VIEWER });
  await page.getByRole("group", { name: "machine shop" }).waitFor();
  return page;
}

interface Drawn {
  /** `--viz-zoom` on the canvas. */
  scale: number;
  /** The drawn width over the viewBox width. */
  shown: number;
  sizing: string | undefined;
  tool: string | undefined;
  pan: string | undefined;
  /** How far the canvas and the page are scrolled together. */
  scroll: { x: number; y: number };
}

function drawn(page: Page): Promise<Drawn> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>(".canvas");
    const graph = canvas?.querySelector("svg.graph");
    const natural = Number(graph?.getAttribute("viewBox")?.split(" ")[2]);
    return {
      scale: Number(canvas?.style.getPropertyValue("--viz-zoom")),
      shown: (graph?.getBoundingClientRect().width ?? 0) / natural,
      sizing: canvas?.dataset["sizing"],
      tool: canvas?.dataset["tool"],
      pan: canvas?.dataset["pan"],
      scroll: { x: (canvas?.scrollLeft ?? 0) + scrollX, y: (canvas?.scrollTop ?? 0) + scrollY },
    };
  });
}

interface LabelOptions {
  /** The state the arrow goes to. */
  to: string;
}

/** The center of the label of the arrow into the state, in client coordinates, scrolled to the middle of the canvas. */
function labelOf(page: Page, options: LabelOptions): Promise<{ x: number; y: number }> {
  return page.evaluate((name) => {
    const label = document.querySelector(`.graph g.edge[data-to="${name}"] text`);
    label?.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const rect = label?.getBoundingClientRect() ?? new DOMRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, options.to);
}

/** A point 30% along the line of the arrow into the state, away from its label, in client coordinates. */
function lineOf(page: Page, options: LabelOptions): Promise<{ x: number; y: number }> {
  return page.evaluate((name) => {
    const line = document.querySelector<SVGPathElement>(
      `.graph g.edge[data-to="${name}"] path.hit`,
    );
    const matrix = line?.getScreenCTM();
    if (!line || !matrix) return { x: 0, y: 0 };
    const at = line.getPointAtLength(line.getTotalLength() * 0.3);
    return { x: at.x * matrix.a + matrix.e, y: at.y * matrix.d + matrix.f };
  }, options.to);
}

/** A point on the canvas away from the drawing's elements: its top-left corner, inside the padding of the drawing. */
function emptySpot(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const rect = document.querySelector(".canvas")?.getBoundingClientRect() ?? new DOMRect();
    return { x: rect.left + 4, y: rect.top + 4 };
  });
}

async function zoomTo300(page: Page): Promise<void> {
  const spot = await emptySpot(page);
  await page.mouse.click(spot.x, spot.y);
  await page.keyboard.press("Shift+Digit0");
  for (const _ of [1.5, 2, 3]) await page.keyboard.press("Control+Equal");
}

test("the viewer opens at the fitted width, and the scale it reports is the width drawn", async () => {
  const page = await viewerPage();
  const opened = await drawn(page);
  expect({ sizing: opened.sizing, tool: opened.tool }).toEqual({
    sizing: "fitted",
    tool: "select",
  });
  expect(opened.shown).toBeCloseTo(opened.scale, 3);
  await zoomTo300(page);
  const zoomed = await drawn(page);
  expect({ scale: zoomed.scale, sizing: zoomed.sizing }).toEqual({ scale: 3, sizing: "chosen" });
  expect(zoomed.shown).toBeCloseTo(3, 3);
  await page.close();
}, 60_000);

test("Ctrl+wheel zooms with the point under the pointer staying put; a plain wheel scrolls", async () => {
  const page = await viewerPage();
  const pointer = await labelOf(page, { to: "review" });
  await page.mouse.move(pointer.x, pointer.y);
  const opened = await drawn(page);
  const under = await page.evaluate((at) => {
    const rect =
      document.querySelector(".canvas svg.graph")?.getBoundingClientRect() ?? new DOMRect();
    return { x: (at.x - rect.left) / rect.width, y: (at.y - rect.top) / rect.height };
  }, pointer);
  await page.keyboard.down("Control");
  for (const _ of [1, 2, 3, 4, 5, 6]) await page.mouse.wheel(0, -40);
  await page.keyboard.up("Control");
  const zoomed = await drawn(page);
  const kept = await page.evaluate(
    (given) => {
      const rect =
        document.querySelector(".canvas svg.graph")?.getBoundingClientRect() ?? new DOMRect();
      const x = rect.left + given.under.x * rect.width;
      const y = rect.top + given.under.y * rect.height;
      return Math.max(Math.abs(x - given.pointer.x), Math.abs(y - given.pointer.y));
    },
    { under, pointer },
  );
  expect(zoomed.scale).toBeGreaterThan(opened.scale * 2);
  // The page and the canvas each round their scroll to a pixel.
  expect(kept).toBeLessThan(1.5);
  await page.mouse.wheel(0, 120);
  await page.waitForFunction((before) => scrollY > before, zoomed.scroll.y);
  expect((await drawn(page)).scale).toBe(zoomed.scale);
  await page.close();
}, 60_000);

test("the keys zoom in, out, to 100% and to fit, pick the tools, and do nothing from a field outside", async () => {
  const page = await viewerPage();
  const spot = await emptySpot(page);
  await page.mouse.click(spot.x, spot.y);
  const seen: Array<{ scale: number; tool: string | undefined }> = [];
  for (const key of ["Shift+Digit0", "Control+Equal", "Control+Minus", "Control+Minus", "h"]) {
    await page.keyboard.press(key);
    const now = await drawn(page);
    seen.push({ scale: now.scale, tool: now.tool });
  }
  await page.keyboard.press("v");
  await page.evaluate(() => {
    window.held = [];
    window.addEventListener("keydown", (event) => window.held?.push(event.defaultPrevented));
  });
  await page.keyboard.down("Control");
  for (const _ of [1, 2, 3]) await page.keyboard.down("Equal");
  await page.keyboard.up("Equal");
  await page.keyboard.up("Control");
  const held = await page.evaluate(() => window.held?.slice(1));
  const heldScale = (await drawn(page)).scale;
  await page.keyboard.press("Shift+Digit1");
  const fitted = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>(".canvas");
    const rect = canvas?.querySelector("svg.graph")?.getBoundingClientRect() ?? new DOMRect();
    return { tool: canvas?.dataset["tool"], fits: rect.width <= (canvas?.clientWidth ?? 0) + 1 };
  });
  await page.getByRole("textbox", { name: "Outside" }).focus();
  const before = await drawn(page);
  await page.keyboard.press("Shift+Digit0");
  await page.keyboard.press("Control+Equal");
  const after = await drawn(page);
  expect({ seen, held, heldScale, fitted, unchanged: after.scale === before.scale }).toEqual({
    seen: [
      { scale: 1, tool: "select" },
      { scale: 1.5, tool: "select" },
      { scale: 1, tool: "select" },
      { scale: 0.75, tool: "select" },
      { scale: 0.75, tool: "hand" },
    ],
    held: [true, true, true],
    heldScale: 2,
    fitted: { tool: "select", fits: true },
    unchanged: true,
  });
  await page.close();
}, 60_000);

test("Space and a drag pan the canvas with grab cursors and send nothing; Space still presses a focused tab", async () => {
  const page = await viewerPage();
  await zoomTo300(page);
  const start = await labelOf(page, { to: "payment" });
  await page.mouse.move(start.x, start.y);
  const before = await drawn(page);
  await page.keyboard.down("Space");
  const held = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>(".canvas");
    return { pan: canvas?.dataset["pan"], cursor: canvas ? getComputedStyle(canvas).cursor : "" };
  });
  await page.mouse.down();
  await page.mouse.move(start.x - 150, start.y - 60, { steps: 5 });
  const cursor = await page.evaluate(() => {
    const canvas = document.querySelector(".canvas");
    return canvas ? getComputedStyle(canvas).cursor : "";
  });
  await page.mouse.up();
  await page.keyboard.up("Space");
  const after = await drawn(page);
  const sent = await page.evaluate(() => window.sent?.length);
  await page.getByRole("tab", { name: "Details" }).focus();
  await page.keyboard.press("Space");
  const tab = await page.getByRole("tab", { name: "Details" }).getAttribute("aria-selected");
  const pan = (await drawn(page)).pan;
  expect({
    held,
    cursor,
    moved: { x: after.scroll.x - before.scroll.x, y: after.scroll.y - before.scroll.y },
    pan: after.pan,
    sent,
    tab,
    panAfterTab: pan,
  }).toEqual({
    held: { pan: "held", cursor: "grab" },
    cursor: "grabbing",
    moved: { x: 150, y: 60 },
    pan: undefined,
    sent: 0,
    tab: "true",
    panAfterTab: undefined,
  });
  await page.close();
}, 60_000);

test("with the Hand tool a drag on an arrow pans, a click on it sends nothing, and nothing in the drawing takes the pointer", async () => {
  const page = await viewerPage();
  await zoomTo300(page);
  await page.keyboard.press("h");
  const label = await labelOf(page, { to: "address" });
  const before = await drawn(page);
  await page.mouse.move(label.x, label.y);
  await page.mouse.down();
  await page.mouse.move(label.x - 120, label.y, { steps: 4 });
  await page.mouse.up();
  const after = await drawn(page);
  const again = await labelOf(page, { to: "address" });
  const hit = await page.evaluate((at) => {
    const element = document.elementFromPoint(at.x, at.y);
    const canvas = document.querySelector(".canvas");
    return {
      canvas: element === canvas,
      cursor: canvas ? getComputedStyle(canvas).cursor : "",
    };
  }, again);
  await page.mouse.click(again.x, again.y);
  const line = await lineOf(page, { to: "address" });
  const lineHit = await page.evaluate(
    (at) => document.elementFromPoint(at.x, at.y) === document.querySelector(".canvas"),
    line,
  );
  await page.mouse.click(line.x, line.y);
  const handSent = await page.evaluate(() => window.sent?.length);
  const outside = page.getByRole("textbox", { name: "Outside" });
  await outside.focus();
  await page.mouse.click(again.x, again.y);
  await page.keyboard.press("v");
  const typed = { value: await outside.inputValue(), tool: (await drawn(page)).tool };
  await page.mouse.click(again.x, again.y);
  const selectSent = await page.evaluate(() => window.sent?.length);
  expect({
    moved: after.scroll.x - before.scroll.x,
    hit,
    lineHit,
    handSent,
    typed,
    selectSent,
  }).toEqual({
    moved: 120,
    hit: { canvas: true, cursor: "grab" },
    lineHit: true,
    handSent: 0,
    typed: { value: "", tool: "select" },
    selectSent: 1,
  });
  await page.close();
}, 60_000);

test("the zoom holds after a step and a resize, and the step keeps the new state in view", async () => {
  const page = await viewerPage();
  await zoomTo300(page);
  const label = await labelOf(page, { to: "address" });
  await page.mouse.click(label.x, label.y);
  await page.waitForFunction(
    () => document.querySelector('g.state.current[data-node-id="address"]') !== null,
  );
  const stepped = await drawn(page);
  const shown = await page.evaluate(() => {
    const canvas = document.querySelector(".canvas")?.getBoundingClientRect() ?? new DOMRect();
    const state =
      document.querySelector("g.state.current")?.getBoundingClientRect() ?? new DOMRect();
    const across = state.left >= canvas.left && state.right <= canvas.right;
    const down = state.top >= 0 && state.bottom <= innerHeight;
    return across && down;
  });
  await page.setViewportSize({ width: 700, height: 700 });
  await page.waitForFunction(() => document.querySelector(".canvas")?.clientWidth !== undefined);
  const resized = await drawn(page);
  expect({ stepped: stepped.scale, sizing: stepped.sizing, shown, resized: resized.scale }).toEqual(
    {
      stepped: 3,
      sizing: "chosen",
      shown: true,
      resized: 3,
    },
  );
  await page.close();
}, 60_000);

test("the zoom and the tool hold when the viewer draws a new canvas", async () => {
  const page = await viewerPage({ shows: "diagram" });
  await zoomTo300(page);
  await page.keyboard.press("h");
  await page.getByRole("button", { name: "Show controls" }).click();
  await page.getByRole("tab", { name: "Step" }).waitFor();
  const shown = await drawn(page);
  expect({
    scale: shown.scale,
    drawn: Number(shown.shown.toFixed(3)),
    sizing: shown.sizing,
    tool: shown.tool,
  }).toEqual({
    scale: 3,
    drawn: 3,
    sizing: "chosen",
    tool: "hand",
  });
  await page.close();
}, 60_000);

test("after a click on an arrow, Space and a drag pan instead of pressing the arrow that focus moved to", async () => {
  const page = await viewerPage();
  await zoomTo300(page);
  const label = await labelOf(page, { to: "address" });
  await page.mouse.click(label.x, label.y);
  await page.waitForFunction(
    () => document.querySelector('g.state.current[data-node-id="address"]') !== null,
  );
  const focused = await page.evaluate(
    () => document.activeElement?.closest(".graph") !== null && document.activeElement !== null,
  );
  const spot = await emptySpot(page);
  await page.mouse.move(spot.x + 200, spot.y + 40);
  const before = await drawn(page);
  await page.keyboard.down("Space");
  await page.mouse.down();
  await page.mouse.move(spot.x + 100, spot.y + 40, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  const after = await drawn(page);
  const sent = await page.evaluate(() => window.sent?.length);
  expect({ focused, sent, moved: after.scroll.x - before.scroll.x }).toEqual({
    focused: true,
    sent: 1,
    moved: 100,
  });
  await page.close();
}, 60_000);

test("on a page the reader has not touched, Space scrolls the page and Ctrl+= is the browser's, also over the canvas", async () => {
  const page = await viewerPage();
  const spot = await emptySpot(page);
  await page.mouse.move(spot.x + 100, spot.y + 40);
  const opened = await drawn(page);
  await page.keyboard.press("Space");
  await page.waitForFunction(() => scrollY > 0);
  await page.keyboard.press("Control+Equal");
  const untouched = await drawn(page);
  const now = await emptySpot(page);
  await page.mouse.click(now.x, now.y);
  await page.keyboard.press("Control+Equal");
  const touched = await drawn(page);
  expect({
    untouched: untouched.scale === opened.scale,
    touched: touched.scale > opened.scale,
  }).toEqual({
    untouched: true,
    touched: true,
  });
  await page.close();
}, 60_000);

test("a pinch out from low on the canvas keeps the canvas under the pointer and every step in the viewer", async () => {
  const page = await viewerPage();
  const box = await page.evaluate(() => {
    const rect = document.querySelector(".canvas")?.getBoundingClientRect() ?? new DOMRect();
    return { x: rect.left + rect.width / 2, y: rect.bottom - 10, height: rect.height };
  });
  await page.evaluate(() => {
    window.held = [];
    window.addEventListener("wheel", (event) => window.held?.push(event.defaultPrevented));
  });
  await page.mouse.move(box.x, box.y);
  await page.keyboard.down("Control");
  for (const _ of [1, 2, 3, 4, 5, 6, 7, 8]) await page.mouse.wheel(0, 40);
  await page.keyboard.up("Control");
  const after = await page.evaluate(() => ({
    held: window.held,
    height: document.querySelector(".canvas")?.getBoundingClientRect().height ?? 0,
  }));
  const zoomed = await drawn(page);
  expect({
    held: after.held,
    kept: after.height >= box.height - 1,
    smaller: zoomed.scale < 0.5,
  }).toEqual({
    held: [true, true, true, true, true, true, true, true],
    kept: true,
    smaller: true,
  });
  await page.close();
}, 60_000);
