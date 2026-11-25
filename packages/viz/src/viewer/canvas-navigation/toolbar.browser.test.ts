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
  }
}

let server: ViteDevServer;
let browser: Browser;
let origin = "";
let cacheDir = "";

beforeAll(async () => {
  // Its own dependency cache: another Vite in the same run that bundles dagre would make this one's copy outdated (a 504).
  cacheDir = mkdtempSync(join(tmpdir(), "viz-toolbar-"));
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
const tall = new URLSearchParams(location.search).has("tall");
for (const [index, name] of names.slice(1).entries()) edges.push(edgeOf(tall ? "cart" : names[index], { event: "to" + name, to: name }));
const machine = machineOf({ states, edges });
const { driver, sent } = walkDriver(machine, { guarded: new Set() });
const diagramOnly = new URLSearchParams(location.search).has("diagram-only");
mountViewer(document.querySelector("#viewer"), { schemaVersion: 1, machines: [machine] }, { driver, diagramOnly });
window.sent = sent;
`;

interface ViewerPageOptions {
  /** "diagram": the viewer opens with Diagram only, so Show controls draws it all again. */
  shows?: "all" | "diagram";
  /** "tall": every arrow leaves `cart`, so the drawing runs down, not across. */
  drawing?: "wide" | "tall";
}

async function viewerPage(options: ViewerPageOptions = {}): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const query = new URLSearchParams();
  if (options.shows === "diagram") query.set("diagram-only", "");
  if (options.drawing === "tall") query.set("tall", "");
  const search = query.toString();
  await page.goto(`${origin}?${search}`);
  await page.setContent(
    '<link rel="stylesheet" href="/viewer.css"><style>body { margin: 16px; min-height: 3000px; }</style><div id="viewer"></div>',
  );
  await page.addScriptTag({ type: "module", content: VIEWER });
  await page.getByRole("group", { name: "machine shop" }).waitFor();
  return page;
}

interface Shown {
  /** The percent the toolbar shows. */
  percent: string;
  /** The drawn width over the viewBox width, as a percent. */
  drawn: number;
  /** How far the canvas and the page are scrolled together. */
  scroll: { x: number; y: number };
}

function shownOf(page: Page): Promise<Shown> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>(".canvas");
    const graph = canvas?.querySelector("svg.graph");
    const natural = Number(graph?.getAttribute("viewBox")?.split(" ")[2]);
    const width = graph?.getBoundingClientRect().width ?? 0;
    return {
      percent: document.querySelector(".zoom-percent")?.textContent ?? "",
      drawn: Math.round((width / natural) * 100),
      scroll: { x: (canvas?.scrollLeft ?? 0) + scrollX, y: (canvas?.scrollTop ?? 0) + scrollY },
    };
  });
}

interface ToolsLook {
  select: string | undefined;
  move: string | undefined;
  /** The cursor over the pressed tool: a click on it changes nothing. */
  pressedCursor: string;
}

function toolsLook(page: Page): Promise<ToolsLook> {
  return page.evaluate(() => {
    const select = document.querySelector('[data-viz-tool="select"]');
    const move = document.querySelector('[data-viz-tool="hand"]');
    const pressed = document.querySelector('[data-viz-tool][aria-pressed="true"]');
    return {
      select: select?.getAttribute("aria-pressed") ?? undefined,
      move: move?.getAttribute("aria-pressed") ?? undefined,
      pressedCursor: pressed ? getComputedStyle(pressed).cursor : "",
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

function sentCount(page: Page): Promise<number | undefined> {
  return page.evaluate(() => window.sent?.length);
}

test("Move, then a drag on an arrow pans and sends nothing; Select brings the arrow clicks back", async () => {
  const page = await viewerPage();
  const titles = {
    select: await page.getByRole("button", { name: "Select" }).getAttribute("title"),
    move: await page.getByRole("button", { name: "Move" }).getAttribute("title"),
  };
  const opened = await toolsLook(page);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Move" }).click();
  const moving = await toolsLook(page);
  const label = await labelOf(page, { to: "address" });
  const before = await shownOf(page);
  await page.mouse.move(label.x, label.y);
  await page.mouse.down();
  await page.mouse.move(label.x - 120, label.y - 40, { steps: 4 });
  await page.mouse.up();
  const after = await shownOf(page);
  const again = await labelOf(page, { to: "address" });
  await page.mouse.click(again.x, again.y);
  const movedSent = await sentCount(page);
  await page.getByRole("button", { name: "Select" }).click();
  const selecting = await toolsLook(page);
  await page.mouse.click(again.x, again.y);
  const selectSent = await sentCount(page);
  expect({
    titles,
    opened,
    moving,
    moved: { x: after.scroll.x - before.scroll.x, y: after.scroll.y - before.scroll.y },
    movedSent,
    selecting,
    selectSent,
  }).toEqual({
    titles: { select: "Select (V)", move: "Move (H): drag to pan" },
    opened: { select: "true", move: "false", pressedCursor: "default" },
    moving: { select: "false", move: "true", pressedCursor: "default" },
    moved: { x: 120, y: 40 },
    movedSent: 0,
    selecting: { select: "true", move: "false", pressedCursor: "default" },
    selectSent: 1,
  });
  await page.close();
}, 60_000);

test("Zoom in, Zoom out and Fit change the drawn size and the percent; the zoom buttons turn off at the limits", async () => {
  const page = await viewerPage();
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  const zoomOut = page.getByRole("button", { name: "Zoom out" });
  const fit = page.getByRole("button", { name: "Zoom to fit" });
  const opened = await shownOf(page);
  await page.getByRole("group", { name: "machine shop" }).click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("Shift+Digit0");
  const seen: Array<{ percent: string; drawn: number }> = [];
  for (const button of [zoomIn, zoomOut, zoomOut, zoomOut, zoomOut, zoomOut]) {
    await button.click();
    const { percent, drawn } = await shownOf(page);
    seen.push({ percent, drawn });
  }
  const smallest = { zoomOut: await zoomOut.isDisabled(), zoomIn: await zoomIn.isDisabled() };
  await fit.click();
  const fitted = await shownOf(page);
  const fitOff = await fit.isDisabled();
  for (const _ of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    if (await zoomIn.isEnabled()) await zoomIn.click();
  }
  const largest = {
    percent: (await shownOf(page)).percent,
    zoomOut: await zoomOut.isDisabled(),
    zoomIn: await zoomIn.isDisabled(),
  };
  expect({
    opened: opened.percent === `${opened.drawn}%`,
    seen,
    smallest,
    fitted: { percent: fitted.percent === `${fitted.drawn}%`, grew: fitted.drawn > 10 },
    fitOff,
    largest,
  }).toEqual({
    opened: true,
    seen: [
      { percent: "150%", drawn: 150 },
      { percent: "100%", drawn: 100 },
      { percent: "75%", drawn: 75 },
      { percent: "50%", drawn: 50 },
      { percent: "25%", drawn: 25 },
      { percent: "10%", drawn: 10 },
    ],
    smallest: { zoomOut: true, zoomIn: false },
    fitted: { percent: true, grew: true },
    fitOff: true,
    largest: { percent: "800%", zoomOut: false, zoomIn: true },
  });
  await page.close();
}, 60_000);

test("the percent follows a Ctrl+wheel zoom and the zoom keys", async () => {
  const page = await viewerPage();
  const opened = await shownOf(page);
  const label = await labelOf(page, { to: "review" });
  await page.mouse.move(label.x, label.y);
  await page.keyboard.down("Control");
  for (const _ of [1, 2, 3]) await page.mouse.wheel(0, -40);
  await page.keyboard.up("Control");
  const wheeled = await shownOf(page);
  await page.keyboard.press("Control+Minus");
  const keyed = await shownOf(page);
  expect({
    wheeled: wheeled.percent === `${wheeled.drawn}%`,
    keyed: keyed.percent === `${keyed.drawn}%`,
    changed: [opened.percent !== wheeled.percent, wheeled.percent !== keyed.percent],
  }).toEqual({ wheeled: true, keyed: true, changed: [true, true] });
  await page.close();
}, 60_000);

test("the tool and the percent hold across a step, and when Show controls draws the viewer again", async () => {
  const page = await viewerPage({ shows: "diagram" });
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Move" }).click();
  const zoomed = await shownOf(page);
  await labelOf(page, { to: "address" });
  // With Move a click on an arrow pans; Enter on it still sends.
  await page.evaluate(() => {
    document.querySelector<SVGGElement>('.graph g.edge[data-to="address"]')?.focus();
  });
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => document.querySelector('g.state.current[data-node-id="address"]') !== null,
  );
  const stepped = { shown: await shownOf(page), tools: await toolsLook(page) };
  await page.getByRole("button", { name: "Show controls" }).click();
  await page.getByRole("tab", { name: "Step" }).waitFor();
  const redrawn = { shown: await shownOf(page), tools: await toolsLook(page) };
  const moving = { select: "false", move: "true", pressedCursor: "default" };
  expect({
    sent: await sentCount(page),
    stepped: { percent: stepped.shown.percent, tools: stepped.tools },
    redrawn: { percent: redrawn.shown.percent, tools: redrawn.tools },
  }).toEqual({
    sent: 1,
    stepped: { percent: zoomed.percent, tools: moving },
    redrawn: { percent: zoomed.percent, tools: moving },
  });
  await page.close();
}, 60_000);

test("from the keyboard, Fit and a zoom limit turn the button off but keep focus on it, so the keys still act", async () => {
  const page = await viewerPage();
  const fit = page.getByRole("button", { name: "Zoom to fit" });
  await fit.focus();
  await page.keyboard.press("Enter");
  const fitted = {
    off: await fit.isDisabled(),
    title: await fit.getAttribute("title"),
    focused: await fit.evaluate((button) => document.activeElement === button),
  };
  await page.keyboard.press("h");
  const tools = await toolsLook(page);
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  await zoomIn.focus();
  for (const _ of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) await page.keyboard.press("Enter");
  const largest = {
    percent: (await shownOf(page)).percent,
    off: await zoomIn.isDisabled(),
    title: await zoomIn.getAttribute("title"),
    focused: await zoomIn.evaluate((button) => document.activeElement === button),
  };
  await page.keyboard.press("Control+Minus");
  expect({ fitted, tools: tools.move, largest, after: (await shownOf(page)).percent }).toEqual({
    fitted: {
      off: true,
      title: "Zoom to fit (Shift+1): the whole diagram fits already",
      focused: true,
    },
    tools: "true",
    largest: {
      percent: "800%",
      off: true,
      title: "Zoom in: 800% is the largest zoom",
      focused: true,
    },
    after: "600%",
  });
  await page.close();
}, 60_000);

test("in full screen the bar stays in view while a canvas zoomed in scrolls", async () => {
  const page = await viewerPage();
  await page.getByRole("button", { name: "Full screen" }).click();
  await page.getByRole("button", { name: "Exit full screen" }).waitFor();
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  for (const _ of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    if (await zoomIn.isEnabled()) await zoomIn.click();
  }
  const top = await page.evaluate(() => {
    const viewer = document.querySelector<HTMLElement>("#viewer");
    viewer?.scrollTo({ top: viewer.scrollHeight, behavior: "instant" });
    const bar = document.querySelector(".viz-bar")?.getBoundingClientRect() ?? new DOMRect();
    return { scrolled: (viewer?.scrollTop ?? 0) > 200, barTop: Math.round(bar.top) };
  });
  const exit = await page.getByRole("button", { name: "Exit full screen" }).boundingBox();
  expect({ top, exitShown: exit !== null && exit.y >= 0 && exit.y < 100 }).toEqual({
    top: { scrolled: true, barTop: 0 },
    exitShown: true,
  });
  await page.close();
}, 60_000);

test("in full screen, Fit puts the whole drawing below the bar", async () => {
  const page = await viewerPage({ drawing: "tall" });
  await page.getByRole("button", { name: "Full screen" }).click();
  await page.getByRole("button", { name: "Exit full screen" }).waitFor();
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  for (const _ of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    if (await zoomIn.isEnabled()) await zoomIn.click();
  }
  await page.evaluate(() => {
    const viewer = document.querySelector<HTMLElement>("#viewer");
    viewer?.scrollTo({ top: viewer.scrollHeight, behavior: "instant" });
  });
  await page.getByRole("button", { name: "Zoom to fit" }).click();
  const placed = await page.evaluate(() => {
    const bar = document.querySelector(".viz-bar")?.getBoundingClientRect() ?? new DOMRect();
    const graph = document.querySelector(".canvas svg.graph")?.getBoundingClientRect();
    const drawing = graph ?? new DOMRect();
    return {
      belowBar: drawing.top >= bar.bottom - 1,
      inWindow: drawing.bottom <= innerHeight + 1,
    };
  });
  expect(placed).toEqual({ belowBar: true, inWindow: true });
  await page.close();
}, 60_000);
