import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import type { Browser } from "playwright";
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
    plugins: [mantaqViz({ machines: ["clean.ts"], fuzz: false })],
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

interface ServedState {
  id: string;
}

/** The served document plus `outer`, whose `handlingRequest` embeds `clean`, and `other`, a copy of `clean`. */
async function embedDocument(): Promise<unknown> {
  const served = await fetch(`${origin}/__mantaq/viz.json`);
  const viz = await served.json();
  const [clean] = viz.machines;
  const states = clean.states.map((state: ServedState) =>
    state.id === "handlingRequest" ? { ...state, machine: "clean" } : state,
  );
  const outer = { ...clean, id: "outer", states };
  return { ...viz, machines: [clean, outer, { ...clean, id: "other" }] };
}

/** Skipped: the live page no longer keeps embedded machines, and the state-groups work rewrites this test. */
test.skip("enter opens the embedded machine, a link keeps it open, and Escape leaves", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const viz = await embedDocument();
  await page.route("**/__mantaq/viz.json", (route) => route.fulfill({ json: viz }));
  function focusInAddress(): Promise<string[]> {
    return page.evaluate(() => new URLSearchParams(location.search).getAll("focus"));
  }
  await page.goto(`${origin}/__mantaq/`);
  const picker = page.getByRole("navigation", { name: "Machines", exact: true });
  await picker.getByRole("button", { name: "outer" }).waitFor();
  const listed = await picker.getByRole("button").allTextContents();
  await page.getByRole("button", { name: "enter machine clean" }).click();
  const path = page.getByRole("navigation", { name: "Machines opened" });
  await path.getByRole("button", { name: "clean" }).waitFor();
  const entered = {
    path: await path.getByRole("button").allTextContents(),
    focus: await focusInAddress(),
  };
  await page.reload();
  await path.getByRole("button", { name: "clean" }).focus();
  await page.keyboard.press("Escape");
  await path.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "enter machine clean" }).waitFor();
  expect({ listed, entered, left: await focusInAddress() }).toStrictEqual({
    listed: ["outer", "other"],
    entered: { path: ["outer", "clean"], focus: ["handlingRequest"] },
    left: [],
  });
  await page.close();
}, 60_000);
