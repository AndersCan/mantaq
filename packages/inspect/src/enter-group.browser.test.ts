import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import type { Browser, Page } from "playwright";
import { chromium } from "playwright";
import { createServer } from "vite";
import { join } from "node:path";
import { mantaqViz } from "./vite.ts";
import type { ViteDevServer } from "vite";

let server: ViteDevServer;
let browser: Browser;
let origin = "";

beforeAll(async () => {
  server = await createServer({
    root: join(import.meta.dirname, "fixtures"),
    configFile: false,
    logLevel: "silent",
    server: { port: 0, host: "127.0.0.1", watch: { ignored: ["**/*"] } },
    plugins: [mantaqViz({ machines: ["grouped.ts"], fuzz: false })],
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === "object" ? (address?.port ?? 0) : 0;
  origin = `http://127.0.0.1:${port}`;
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser.close();
  await server.close();
});

/** The drawn nodes marked current, the path above the canvas and the `?focus=` of the address bar. */
async function where(page: Page) {
  const path = page.getByRole("navigation", { name: "Path" });
  const crumbs =
    (await path.count()) === 0 ? [] : await path.getByRole("listitem").allTextContents();
  const current = await page.evaluate(() => {
    const ids: string[] = [];
    for (const node of document.querySelectorAll(".graph g.current[data-node-id]")) {
      ids.push(node.getAttribute("data-node-id") ?? "");
    }
    return ids;
  });
  const focus = await page.evaluate(() => new URLSearchParams(location.search).getAll("focus"));
  return { crumbs, current, focus };
}

test("a group is entered, walked inside by its arrows until one leaves it, left by crumb and Escape, and reopened from a link", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${origin}/__mantaq/?machine=grouped`);
  await page.getByRole("button", { name: "enter group payment", exact: true }).click();
  await page.getByRole("button", { name: "grouped", exact: true }).waitFor();
  const entered = await where(page);
  await page
    .getByRole("button", { name: "inCart on checkout to chargingCard", exact: true })
    .click();
  await page
    .getByRole("button", { name: "chargingCard on charged to confirming", exact: true })
    .click();
  const inside = await where(page);
  await page
    .getByRole("button", { name: "confirming on confirmed to packing", exact: true })
    .click();
  await page.getByText("The walk is in packing, outside group payment.").waitFor();
  const left = await where(page);
  await page.getByRole("button", { name: "grouped", exact: true }).click();
  await page.getByRole("button", { name: "enter group payment", exact: true }).waitFor();
  const back = await where(page);
  await page.getByRole("button", { name: "enter group payment", exact: true }).click();
  await page.getByRole("button", { name: "grouped", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "enter group payment", exact: true }).waitFor();
  const escaped = await where(page);
  await page.goto(`${origin}/__mantaq/?machine=grouped&step=checkout&focus=%40payment`);
  await page
    .getByRole("button", { name: "chargingCard on charged to confirming", exact: true })
    .waitFor();
  expect({ entered, inside, left, back, escaped, linked: await where(page) }).toStrictEqual({
    entered: { crumbs: ["grouped", "payment"], current: ["inCart"], focus: ["@payment"] },
    inside: { crumbs: ["grouped", "payment"], current: ["confirming"], focus: ["@payment"] },
    left: { crumbs: ["grouped", "payment"], current: ["packing"], focus: ["@payment"] },
    back: { crumbs: [], current: ["@shipping"], focus: [] },
    escaped: { crumbs: [], current: ["@shipping"], focus: [] },
    linked: { crumbs: ["grouped", "payment"], current: ["chargingCard"], focus: ["@payment"] },
  });
  await page.close();
}, 60_000);
