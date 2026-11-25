import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import type { Browser } from "playwright";
import { chromium } from "playwright";
import { createServer } from "vite";
import { join } from "node:path";
import { mantaqViz } from "../vite.ts";
import type { ViteDevServer } from "vite";

let server: ViteDevServer;
let browser: Browser;
let origin = "";

beforeAll(async () => {
  server = await createServer({
    root: join(import.meta.dirname, "..", "fixtures"),
    configFile: false,
    logLevel: "silent",
    server: { port: 0, host: "127.0.0.1", watch: { ignored: ["**/*"] } },
    plugins: [mantaqViz({ machines: ["embedded/delivery.ts"], fuzz: false })],
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

test("inside the running scan, a forwarded arrow steps delivery and the scan then shows a note", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${origin}/__mantaq/?machine=delivery&focus=pickingUp`);
  const path = page.getByRole("navigation", { name: "Machines opened" });
  await path.getByRole("button", { name: "scan" }).waitFor();
  const reading = page.getByRole("button", { name: "state reading", exact: true });
  const before = await reading.getAttribute("class");
  const read = page.getByRole("button", { name: "reading on read to scanned", exact: true });
  const locked = await read.getAttribute("aria-description");
  await page
    .getByRole("button", { name: "reading on misread to rejected", exact: true })
    .dispatchEvent("click");
  const note = page.getByText("scan runs only while delivery is in pickingUp.");
  await note.waitFor();
  expect({
    current: before?.split(" ").includes("current"),
    locked,
    steps: await page.evaluate(() => new URLSearchParams(location.search).getAll("step")),
    note: await note.textContent(),
    after: (await reading.getAttribute("class"))?.split(" ").includes("current"),
  }).toStrictEqual({
    current: true,
    locked: "read is internal to scan: only scan sends it.",
    steps: ["misread"],
    note: "scan runs only while delivery is in pickingUp. It is in returned now, so scan is shown without its state.",
    after: false,
  });
  await page.close();
}, 60_000);
