/**
 * Replays the walk of the group guide on the built docs, clicking each button by its
 * label, then Back, Forward and a reload. Each button is in the canvas's view before
 * its click, and the current state after each step. The viewer shows what the guide
 * says, and only a move along the path adds a history entry. Half on screen, the panel does not cover the canvas.
 */

/** The page of the guide, under the site's base. */
export const GROUP_GUIDE = "guides/group-states/";

/** What the viewer shows after the walk leaves the payment group to packingParcel, with the path still in it. */
const OUTSIDE = {
  current: ["packingParcel"],
  path: ["order", "payment"],
  row: "",
  line: "The walk is in packingParcel, outside group payment.",
};

/** What the viewer shows back at the top, with the walk in the delivery group. */
const TOP = { current: ["@delivery"], path: [], row: "now in packingParcel", line: "" };

/**
 * The steps of "Walk into a group and out of it", then Back, Forward and a reload: what
 * each does, what the viewer shows after it, and how many history entries the walk added.
 */
const STEPS = [
  {
    click: "reviewingOrder on placeOrder to group payment",
    shows: { current: ["@payment"], path: [], row: "now in chargingCard", line: "" },
    entries: 0,
  },
  {
    click: "enter group payment",
    shows: { current: ["chargingCard"], path: ["order", "payment"], row: "", line: "" },
    entries: 1,
  },
  {
    click: "chargingCard on declined to cardDeclined",
    shows: { current: ["cardDeclined"], path: ["order", "payment"], row: "", line: "" },
    entries: 1,
  },
  {
    click: "cardDeclined on retryCard to chargingCard",
    shows: { current: ["chargingCard"], path: ["order", "payment"], row: "", line: "" },
    entries: 1,
  },
  { click: "chargingCard on charged to packingParcel", shows: OUTSIDE, entries: 1 },
  { click: "order", shows: TOP, entries: 2 },
  { go: "back", shows: OUTSIDE, entries: 2 },
  { go: "forward", shows: TOP, entries: 2 },
  { go: "back", shows: OUTSIDE, entries: 2 },
  { go: "reload", shows: OUTSIDE, entries: 2 },
];

/** How long a step may take to show. */
const STEP_MS = 3_000;

/** How long the viewer may take to mount, as the other live checks allow. */
const MOUNT_MS = 10_000;

/** Runs in the page: whether `element` looks clickable to a reader, a pointer cursor and nothing on its way up fully transparent. */
function looksClickable(element) {
  const pointer = getComputedStyle(element).cursor === "pointer";
  let shown = true;
  for (let node = element; node !== null; node = node.parentElement) {
    if (getComputedStyle(node).opacity === "0") shown = false;
  }
  return pointer && shown;
}

/** Runs in the page: the marked nodes, the path, the row of the current group node and the line about the walk outside the group. */
function shownNow() {
  const current = [];
  for (const node of document.querySelectorAll(".viz .graph g.current[data-node-id]")) {
    current.push(node.getAttribute("data-node-id"));
  }
  const path = [];
  for (const crumb of document.querySelectorAll('.viz nav[aria-label="Path"] li')) {
    path.push(crumb.textContent.trim());
  }
  const row = document.querySelector(".viz .graph g.current .machine-name")?.textContent ?? "";
  const bar = document.querySelector(".viz .viz-bar")?.textContent ?? "";
  const line = /The walk is in [^.]*\./u.exec(bar)?.[0] ?? "";
  return { current, path, row, line, entries: history.length };
}

/** Runs in the page: with the top of the viewer in the middle of the window, whether the panel covers the canvas, and how many lines Full screen takes. */
function framing() {
  const viz = document.querySelector(".viz");
  scrollBy({ top: viz.getBoundingClientRect().top - innerHeight / 2, behavior: "instant" });
  const canvas = viz.querySelector(".canvas").getBoundingClientRect();
  const panel = viz.querySelector(".panel").getBoundingClientRect();
  const covers = panel.top < canvas.bottom - 1 && panel.bottom > canvas.top;
  const toggle = viz.querySelector(".fullscreen-toggle");
  const range = document.createRange();
  range.selectNodeContents(toggle ?? viz);
  const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
  return { panel: covers ? "covers the canvas" : "below the canvas", fullScreen: lines };
}

/** What `framing` must find. */
const FRAMED = JSON.stringify({ panel: "below the canvas", fullScreen: 1 });

/** Runs in the page: whether the reader sees `element` without scrolling the canvas it is drawn in. */
function inCanvasView(element) {
  const canvas = element.closest(".canvas");
  if (canvas === null) return true;
  const box = canvas.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const across = rect.left >= box.left && rect.right <= box.left + canvas.clientWidth;
  return across && rect.top >= box.top && rect.bottom <= box.top + canvas.clientHeight;
}

/** Runs in the page: whether the canvas scrolls sideways. */
function scrollsSideways() {
  const canvas = document.querySelector(".viz .canvas");
  return canvas.scrollWidth > canvas.clientWidth;
}

/** The widths the walk runs at: a docs column, where an entered group fits the canvas, and a phone, where the viewer scrolls the canvas to the next arrow. */
const SCREENS = [
  { name: "docs column", viewport: { width: 1280, height: 900 }, groupFits: "fits" },
  { name: "phone", viewport: { width: 390, height: 844 }, groupFits: "scrolls" },
];

/** The first line of a Playwright failure. */
function firstLine(error) {
  return error.message.split("\n")[0];
}

/**
 * Clicks the button named `options.name` in `options.tab` where a reader would: on its
 * label when it has one. Returns `"clicked"`, or why the reader could not click it.
 */
async function clickButton(options) {
  const button = options.tab.getByRole("button", { name: options.name, exact: true }).first();
  const found = await button.waitFor({ timeout: STEP_MS }).then(() => "found", firstLine);
  if (found !== "found") return `no button: ${found}`;
  const label = button.locator(":scope > text");
  const target = (await label.count()) > 0 ? label.first() : button;
  const looks = await target.evaluate(looksClickable);
  if (!looks) return "it does not look clickable";
  const seen = await target.evaluate(inCanvasView);
  if (!seen) return "it is out of the canvas's view, so the reader has to scroll to it";
  return target.click({ timeout: STEP_MS }).then(() => "clicked", firstLine);
}

/** Clicks the step's button, or goes back, forward or reloads as the browser does. Returns `"done"`, or why it could not. */
async function takeStep(options) {
  const { tab, step } = options;
  switch (step.go) {
    case undefined: {
      const clicked = await clickButton({ tab, name: step.click });
      return clicked === "clicked" ? "done" : clicked;
    }
    case "back":
      return tab.goBack({ timeout: STEP_MS }).then(() => "done", firstLine);
    case "forward":
      return tab.goForward({ timeout: STEP_MS }).then(() => "done", firstLine);
    case "reload": {
      const reloaded = await tab.reload({ timeout: MOUNT_MS }).then(() => "done", firstLine);
      if (reloaded !== "done") return reloaded;
      const graph = tab.locator(".viz .graph g.current").first();
      return graph.waitFor({ timeout: MOUNT_MS }).then(() => "done", firstLine);
    }
    default:
      return `no such move: ${step.go}`;
  }
}

/** What `options.tab` shows once it shows `options.wanted`, or what it shows when the step's time is up. */
async function shownAfter(options) {
  const started = performance.now();
  let shown = JSON.stringify(await options.tab.evaluate(shownNow));
  while (shown !== options.wanted && performance.now() - started < STEP_MS) {
    await options.tab.waitForTimeout(100);
    shown = JSON.stringify(await options.tab.evaluate(shownNow));
  }
  return shown;
}

/**
 * Opens the group guide on the site at `options.origin` under `options.base` in a tab
 * of `options.browser` for each screen width, and replays its walk. Returns one failure
 * line per step that could not be clicked or showed something else than the guide says.
 */
export async function groupWalkFailures(options) {
  const walks = await Promise.all(SCREENS.map((screen) => screenWalk({ ...options, screen })));
  return walks.flat();
}

/** The walk in one tab sized as `options.screen`. */
async function screenWalk(options) {
  const { screen } = options;
  const tab = await options.browser.newPage({ viewport: screen.viewport });
  const errors = [];
  tab.on("pageerror", (error) => errors.push(error.message));
  await tab.goto(`${options.origin}${options.base}${GROUP_GUIDE}`);
  await tab.locator(".viz .graph g.current").first().waitFor({ timeout: MOUNT_MS });
  const start = await tab.evaluate(() => history.length);
  const failures = [];
  for (const [index, step] of STEPS.entries()) {
    const number = index + 1;
    const where = `${GROUP_GUIDE} at ${screen.name} width, step ${number}`;
    const done = step.go === undefined ? step.click : `browser ${step.go}`;
    const moved = await takeStep({ tab, step });
    if (moved !== "done") {
      failures.push(`${where}: cannot do "${done}": ${moved}`);
      break;
    }
    const wanted = JSON.stringify({ ...step.shows, entries: start + step.entries });
    const shown = await shownAfter({ tab, wanted });
    if (shown !== wanted) {
      failures.push(`${where}: after "${done}" the viewer shows ${shown}, not ${wanted}`);
      break;
    }
    const current = tab.locator(".viz .graph g.current").first();
    if (!(await current.evaluate(inCanvasView))) {
      failures.push(`${where}: the state the walk is in is out of the canvas's view`);
    }
    const entered = step.shows.path.length > 0 && screen.groupFits === "fits";
    if (entered && (await tab.evaluate(scrollsSideways))) {
      failures.push(`${where}: the group drawn is wider than the canvas`);
    }
    if (step.shows !== OUTSIDE) continue;
    const framed = JSON.stringify(await tab.evaluate(framing));
    if (framed !== FRAMED) {
      failures.push(`${where}: half on screen it shows ${framed}, not ${FRAMED}`);
    }
  }
  for (const error of errors) failures.push(`${GROUP_GUIDE}: page error: ${error}`);
  await tab.close();
  return failures;
}
