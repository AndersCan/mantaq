/**
 * Clicks every element of every viewer on the built docs pages that looks clickable
 * (a `pointer` cursor or role=button), each in a fresh tab, and reports the clicks
 * that changed nothing on the page (no text, mark, panel or URL moved) or threw.
 */
import { join, relative, sep } from "node:path";
import { OUTLINE_ONLY, SHOWN_ATTRIBUTES } from "../../packages/inspect/src/affordance/shown.ts";
import { readdirSync, readFileSync } from "node:fs";

/** How long a click may take to show, for an effect or a redraw on the next frame. */
const SETTLE_MS = 100;

/** A viewer the page mounted; the design page's static samples of its parts have no canvas. */
const VIEWER = ".viz:has(.canvas)";

/** What `inPage` needs to read the page as the reader sees it. */
const SIGHT = { action: "sight", shown: SHOWN_ATTRIBUTES, outlineOnly: OUTLINE_ONLY };

/** Tabs open at the same time. */
const TABS = 6;

/** How many viewers the built HTML of `options.page` holds: one `data-mantaq-viz` host each. */
function viewerHosts(options) {
  const html = readFileSync(join(options.dist, options.page, "index.html"), "utf8");
  return html.split("data-mantaq-viz").length - 1;
}

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
  const shown = options.shown ?? [];
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
  function shownValue(attribute) {
    const { element, name } = attribute;
    const shownNow = element.getAttribute(name);
    const outlineOnly = name === "class" && element.matches(options.outlineOnly);
    if (shownNow === null || !outlineOnly) return shownNow;
    return shownNow.replace(/\bselected\b/u, "").trim();
  }
  function sight() {
    const parts = [location.href];
    for (const element of document.body.querySelectorAll("*")) {
      parts.push(`<${element.tagName}`);
      for (const name of shown) {
        const attribute = shownValue({ element, name });
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
      const name = nameOf(element);
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return { name };
    }
    default:
      return {};
  }
}

/** Opens `page` in a fresh tab, waits for its `viewers` (all of them, or none when unknown), and plants the dead elements. The tab collects its page errors in `errors`. */
async function openPage(options) {
  const tab = await options.browser.newPage();
  const errors = [];
  tab.on("pageerror", (error) => errors.push(error.message));
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
  return { tab, errors };
}

/** How many viewers `page` has and how many elements in them look clickable. */
async function countOn(options) {
  const { tab } = await openPage(options);
  const viewers = await tab.locator(VIEWER).count();
  const counted = { action: "count", viewer: VIEWER };
  const { count } = viewers === 0 ? { count: 0 } : await tab.evaluate(inPage, counted);
  await tab.close();
  return { page: options.page, viewers, count };
}

/** Clicks the element at `index` on a fresh load of `page`: a problem when the page did not change, or when the click threw. */
async function clickOn(options) {
  const { tab, errors } = await openPage(options);
  const loaded = errors.length;
  const before = await tab.evaluate(inPage, SIGHT);
  const clicked = { action: "click", index: options.index, viewer: VIEWER };
  const { name } = await tab.evaluate(inPage, clicked);
  await tab.waitForTimeout(SETTLE_MS);
  const after = await tab.evaluate(inPage, SIGHT);
  await tab.close();
  const where = `/${options.page} ${name}`;
  if (name === undefined) {
    return {
      clicked: false,
      problems: [`/${options.page} element ${options.index} is gone on a fresh load`],
    };
  }
  const problems = [];
  for (const error of errors.slice(loaded)) problems.push(`${where} throws: ${error}`);
  if (before.sight === after.sight) problems.push(`${where} changes nothing`);
  return { clicked: true, problems };
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
  const problems = [];
  const swept = [];
  const report = { pages: swept, viewers: 0, viewersOn: {}, clicks: 0, problems };
  const clicks = [];
  for (const { page, viewers, count } of counted) {
    if (viewers === 0) continue;
    swept.push(`/${page}`);
    report.viewersOn[page] = viewers;
    report.viewers += viewers;
    for (let index = 0; index < count; index += 1) {
      clicks.push(() => clickOn({ ...options, page, index, viewers }));
    }
  }
  for (const click of await inBatches(clicks)) {
    if (click.clicked) report.clicks += 1;
    problems.push(...click.problems);
  }
  problems.sort((left, right) => left.localeCompare(right));
  return report;
}

/** Dead elements in the first viewer of a page, one per way to look clickable, and one whose click throws: the sweep must report each. */
async function plantDeadElements(tab) {
  await tab.evaluate(() => {
    const canvas = document.querySelector(".viz .canvas");
    const button = document.createElement("span");
    button.setAttribute("role", "button");
    button.textContent = "planted button";
    const pointer = document.createElement("span");
    pointer.style.cursor = "pointer";
    pointer.textContent = "planted pointer";
    const throwing = document.createElement("span");
    throwing.setAttribute("role", "button");
    throwing.textContent = "planted throw";
    throwing.addEventListener("click", () => reportError(new Error("planted")));
    canvas?.prepend(button, pointer, throwing);
  });
}

/** The page the planted dead elements go on. */
const PLANTED_PAGE = "getting-started/events/";

/** What the reader of a failure does about it. */
const FIX = "make it plain, or make the click do something (AGENTS.md, Docs and viz UI blocks)";

/**
 * Sweeps every page built into `options.dist`, then plants dead elements on one
 * page and sweeps it again: a sweep that misses one is too weak to trust. Returns one
 * failure line per problem, and a summary of what was clicked. Each page of
 * `options.mustSweep` must have a viewer the sweep clicked.
 */
export async function clickFailures(options) {
  const site = { browser: options.browser, origin: options.origin, base: options.base };
  const swept = await sweepViewers({ ...site, pages: builtPages(options.dist) });
  const failures = [];
  for (const problem of swept.problems) failures.push(`docs-live-check: ${problem}: ${FIX}`);
  const planted = await sweepViewers({ ...site, pages: [PLANTED_PAGE], plant: plantDeadElements });
  const caught = [
    { name: "planted button", says: '"planted button" changes nothing' },
    { name: "planted pointer", says: '"planted pointer" changes nothing' },
    { name: "planted throw", says: '"planted throw" throws: planted' },
  ];
  for (const { name, says } of caught) {
    if (!planted.problems.some((problem) => problem.includes(says))) {
      failures.push(`docs-live-check: the click sweep missed a ${name} on ${PLANTED_PAGE}`);
    }
  }
  for (const page of builtPages(options.dist)) {
    const hosts = viewerHosts({ dist: options.dist, page });
    const mounted = swept.viewersOn[page] ?? 0;
    if (mounted < hosts) {
      failures.push(
        `docs-live-check: /${page} has ${hosts} viewers but the sweep found ${mounted} mounted`,
      );
    }
  }
  for (const page of options.mustSweep) {
    if (!swept.pages.includes(`/${page}`)) {
      failures.push(`docs-live-check: the click sweep found no viewer on /${page}`);
    }
  }
  const pages = swept.pages.join(", ");
  const summary = `${swept.clicks} clicks on ${swept.viewers} viewers on ${swept.pages.length} pages each change the page: ${pages}`;
  return { failures, summary };
}
