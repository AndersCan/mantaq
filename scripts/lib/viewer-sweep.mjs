/**
 * Clicks every element of every viewer on the built docs pages that looks clickable
 * (a `pointer` cursor or role=button), each in a fresh tab, and reports the clicks
 * that changed nothing on the page: no text, mark, panel or URL moved.
 */
import { relative, sep } from "node:path";
import { readdirSync } from "node:fs";

/** How long a click may take to show, for an effect or a redraw on the next frame. */
const SETTLE_MS = 100;

/** A viewer the page mounted; the design page's static samples of its parts have no canvas. */
const VIEWER = ".viz:has(.canvas)";

/** Tabs open at the same time. */
const TABS = 6;

/** Every built page, as a path under the site's base: `getting-started/events/`. */
function builtPages(dist) {
  const pages = [];
  for (const entry of readdirSync(dist, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name !== "index.html") continue;
    const folder = relative(dist, entry.parentPath).split(sep).join("/");
    pages.push(folder === "" ? "" : `${folder}/`);
  }
  return pages.sort();
}

/**
 * Runs in the page, so it uses nothing from this module. `count` counts what looks
 * clickable inside the viewers, `click` clicks the one at `index` and names it, and
 * `sight` is the page as the reader sees it, with the URL.
 */
function inPage(options) {
  const shown = [
    "class",
    "hidden",
    "disabled",
    "open",
    "style",
    "transform",
    "viewBox",
    "aria-selected",
    "aria-pressed",
    "aria-expanded",
    "aria-current",
    "data-current",
  ];
  function looksClickable(element) {
    const unseen = element.closest("[disabled]") !== null || element.getClientRects().length === 0;
    if (unseen) return false;
    if (element.getAttribute("role") === "button") return true;
    const pointer = getComputedStyle(element).cursor === "pointer";
    const parent = element.parentElement;
    const inherited = parent !== null && getComputedStyle(parent).cursor === "pointer";
    return pointer && !inherited;
  }
  function targets() {
    const found = [];
    for (const viewer of document.querySelectorAll(options.viewer)) {
      for (const element of viewer.querySelectorAll("*")) {
        if (looksClickable(element)) found.push(element);
      }
    }
    return found;
  }
  function nameOf(element) {
    const viewers = [...document.querySelectorAll(options.viewer)];
    const viewer = viewers.findIndex((each) => each.contains(element)) + 1;
    const id =
      element.getAttribute("data-edge-id") ??
      element.getAttribute("data-node-id") ??
      element.getAttribute("data-tab") ??
      element.getAttribute("data-part") ??
      element.textContent.trim().slice(0, 40);
    const tag = element.tagName.toLowerCase();
    const classes = (element.getAttribute("class") ?? "").trim().split(/\s+/).join(".");
    const selector = classes === "" ? tag : `${tag}.${classes}`;
    return `viewer ${viewer}: ${selector} "${id}"`;
  }
  function sight() {
    const parts = [location.href];
    for (const element of document.body.querySelectorAll("*")) {
      parts.push(`<${element.tagName}`);
      for (const name of shown) {
        const attribute = element.getAttribute(name);
        if (attribute !== null) parts.push(` ${name}="${attribute}"`);
      }
      for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) parts.push(node.textContent);
      }
    }
    return parts.join("");
  }
  switch (options.action) {
    case "count":
      return { count: targets().length };
    case "sight":
      return { sight: sight() };
    case "click": {
      const element = targets()[options.index];
      if (element === undefined) return { name: undefined };
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return { name: nameOf(element) };
    }
    default:
      return {};
  }
}

/** Opens `page` in a fresh tab, waits for its `viewers` (all of them, or none when unknown), and plants the dead element. */
async function openPage(options) {
  const tab = await options.browser.newPage();
  const url = `${options.origin}${options.base}${options.page}`;
  const known = options.viewers !== undefined;
  await tab.goto(url, { waitUntil: known ? "load" : "networkidle" });
  if (known) {
    await tab.waitForFunction(
      (wanted) => document.querySelectorAll(wanted.viewer).length >= wanted.viewers,
      { viewer: VIEWER, viewers: options.viewers },
    );
  }
  await tab.waitForTimeout(SETTLE_MS);
  if ((await tab.locator(VIEWER).count()) > 0) await options.plant?.(tab);
  return tab;
}

/** How many viewers `page` has and how many elements in them look clickable. */
async function countOn(options) {
  const tab = await openPage(options);
  const viewers = await tab.locator(VIEWER).count();
  const counted = { action: "count", viewer: VIEWER };
  const { count } = viewers === 0 ? { count: 0 } : await tab.evaluate(inPage, counted);
  await tab.close();
  return { page: options.page, viewers, count };
}

/** Clicks the element at `index` on a fresh load of `page`; the click is dead when the page did not change. */
async function clickOn(options) {
  const tab = await openPage(options);
  const before = await tab.evaluate(inPage, { action: "sight" });
  const clicked = { action: "click", index: options.index, viewer: VIEWER };
  const { name } = await tab.evaluate(inPage, clicked);
  await tab.waitForTimeout(SETTLE_MS);
  const after = await tab.evaluate(inPage, { action: "sight" });
  await tab.close();
  const where = `/${options.page}`;
  return {
    clicked: name !== undefined,
    dead: before.sight === after.sight ? `${where} ${name}` : undefined,
  };
}

/** Runs `tasks` (functions that return a promise), `TABS` at a time. */
async function inBatches(tasks) {
  const results = [];
  const batches = [];
  for (let start = 0; start < tasks.length; start += TABS) {
    batches.push(tasks.slice(start, start + TABS));
  }
  for (const batch of batches) results.push(...(await Promise.all(batch.map((task) => task()))));
  return results;
}

/**
 * Sweeps `options.pages` of the site at `options.origin` under `options.base`, in
 * Chromium tabs of `options.browser`.
 * `options.plant` runs on each fresh load before the click, so a check can prove
 * that a dead element is caught.
 */
async function sweepViewers(options) {
  const counted = await inBatches(options.pages.map((page) => () => countOn({ ...options, page })));
  const dead = [];
  const report = { pages: 0, viewers: 0, clicks: 0, dead };
  const clicks = [];
  for (const { page, viewers, count } of counted) {
    if (viewers === 0) continue;
    report.pages += 1;
    report.viewers += viewers;
    for (let index = 0; index < count; index += 1) {
      clicks.push(() => clickOn({ ...options, page, index, viewers }));
    }
  }
  for (const click of await inBatches(clicks)) {
    if (click.clicked) report.clicks += 1;
    if (click.dead !== undefined) dead.push(click.dead);
  }
  dead.sort((left, right) => left.localeCompare(right));
  return report;
}

/** A button that does nothing, put in the first viewer of a page: the sweep must report it. */
async function plantDeadButton(tab) {
  await tab.evaluate(() => {
    const dead = document.createElement("span");
    dead.setAttribute("role", "button");
    dead.textContent = "planted";
    document.querySelector(".viz .canvas")?.prepend(dead);
  });
}

/** The page the planted dead button goes on. */
const PLANTED_PAGE = "getting-started/events/";

/**
 * Sweeps every page built into `options.dist`, then plants a dead button on one page
 * and sweeps it again: a sweep that misses it is too weak to trust. Returns one failure
 * line per dead element, and a summary of what was clicked.
 */
export async function clickFailures(options) {
  const site = { browser: options.browser, origin: options.origin, base: options.base };
  const swept = await sweepViewers({ ...site, pages: builtPages(options.dist) });
  const failures = [];
  for (const dead of swept.dead) failures.push(`a click changes nothing: ${dead}`);
  const planted = await sweepViewers({ ...site, pages: [PLANTED_PAGE], plant: plantDeadButton });
  if (!planted.dead.some((dead) => dead.endsWith('span "planted"'))) {
    failures.push(`the click sweep missed a dead button planted on ${PLANTED_PAGE}`);
  }
  const summary = `${swept.clicks} clicks on ${swept.viewers} viewers on ${swept.pages} pages each change the page`;
  return { failures, summary };
}
