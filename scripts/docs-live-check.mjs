// Opens each Getting started page of the built docs site (apps/docs/dist) in Chromium
// and checks its diagram runs live: a current state, a moving next arrow where the
// diagram has arrows, on events a click on `eat` moves the walk to `full`, and on guards a
// click on `eat` at 0 plates says why under the diagram, on timers
// `cook`, then the `overcooked` arrow (a click sends it now), brings the walk back to `hungry`.
// Run after the docs build: node scripts/docs-live-check.mjs
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "apps/docs/dist");
const base = "/mantaq/";
const pages = [
  "getting-started/",
  "getting-started/second-state/",
  "getting-started/events/",
  "getting-started/final-states/",
  "getting-started/context/",
  "getting-started/guards/",
  "getting-started/effects/",
  "getting-started/timers/",
  "getting-started/regions/",
];
if (!existsSync(join(dist, "index.html"))) {
  console.error("docs-live-check: apps/docs/dist is missing; build the docs first");
  process.exit(1);
}

const { serve } = await import("../packages/inspect/src/check-site.ts");
const { server, origin } = await serve(dist, base);

const require = createRequire(join(root, "packages/inspect/package.json"));
const { chromium } = require("playwright");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const failures = [];

for (const page of pages) {
  const tab = await browser.newPage();
  const errors = [];
  tab.on("pageerror", (error) => errors.push(error.message));
  await tab.goto(`${origin}${base}${page}`);
  const graph = tab.locator(".mantaq-tutorial .graph");
  try {
    await graph.first().waitFor({ timeout: 10_000 });
    await tab.locator(".mantaq-tutorial g.state.current").first().waitFor({ timeout: 3_000 });
  } catch {
    failures.push(`${page}: no current state is marked, so the diagram does not run live`);
    await tab.close();
    continue;
  }
  const edges = await tab.locator(".mantaq-tutorial g.edge").count();
  const next = await tab.locator(".mantaq-tutorial g.edge.next").count();
  if (edges > 0 && next === 0) failures.push(`${page}: the diagram has arrows but no next arrow`);
  if (page === "getting-started/events/") {
    await tab.locator(".mantaq-tutorial g.edge.next").first().dispatchEvent("click");
    await tab.waitForTimeout(200);
    const after = await tab
      .locator(".mantaq-tutorial g.state.current")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-node-id")));
    if (after.join() !== "full") failures.push(`${page}: clicking eat leaves the walk in ${after}`);
  }
  if (page === "getting-started/guards/") {
    await tab
      .locator('.mantaq-tutorial g.edge[data-edge-id="hungry-eat-full"]')
      .dispatchEvent("click");
    await tab.waitForTimeout(200);
    const said = await tab.locator(".mantaq-tutorial .viz-main > .blocked-note").textContent();
    const controls = await tab.locator(".mantaq-tutorial [data-show-controls]").count();
    if (said !== "eat is blocked: plates is 0" || controls === 0) {
      failures.push(
        `guards: clicking eat at 0 plates says "${said}", not "eat is blocked: plates is 0"`,
      );
    }
  }
  if (page === "getting-started/timers/") {
    const edge = (id) => tab.locator(`.mantaq-tutorial g.edge.next[data-edge-id="${id}"]`);
    const current = () =>
      tab
        .locator(".mantaq-tutorial g.state.current")
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-node-id")));
    await edge("hungry-cook-cooking").dispatchEvent("click");
    await tab.waitForTimeout(200);
    await edge("cooking-overcooked-hungry").dispatchEvent("click");
    await tab.waitForTimeout(200);
    const after = await current();
    if (after.join() !== "hungry") {
      failures.push(
        `timers: clicking overcooked after cook does not return the walk to hungry (current: ${after})`,
      );
    }
  }
  for (const error of errors) failures.push(`${page}: page error: ${error}`);
  await tab.close();
}

const pool = await browser.newPage();
await pool.goto(
  `${origin}${base}sugar/pool/?machine=teamInbox&run=Four%20items%2C%20three%20workers`,
);
try {
  await pool.locator(".viz g.state.current").first().waitFor({ timeout: 10_000 });
  const inside = await pool
    .locator(".viz")
    .first()
    .evaluate((viz) => {
      const canvas = viz.querySelector(".canvas").getBoundingClientRect();
      const box = viz.querySelector('g[data-node-id="workWaiting"]').getBoundingClientRect();
      return box.left >= canvas.left && box.right <= canvas.right;
    });
  if (!inside) failures.push("pool: the run opens with the waiting box off the canvas");
} catch {
  failures.push("pool: the run does not open live");
}
await pool.close();

await browser.close();
server.close();
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`docs-live-check: ${pages.length} Getting started pages and the pool box run live`);
