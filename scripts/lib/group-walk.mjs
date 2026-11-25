/**
 * Replays the walk of the group guide on the built docs: each step clicks a button by
 * its name, as a reader clicks its label, and the canvas must then mark the state or the
 * group node that the guide says, with the path and the line that the guide quotes.
 */

/** The page of the guide, under the site's base. */
export const GROUP_GUIDE = "guides/group-states/";

/** The steps of "Walk into a group and out of it", and what the viewer shows after each. */
const STEPS = [
  {
    click: "reviewingOrder on placeOrder to group payment",
    shows: { current: ["@payment"], path: [], row: "now in chargingCard", line: "" },
  },
  {
    click: "enter group payment",
    shows: { current: ["chargingCard"], path: ["order", "payment"], row: "", line: "" },
  },
  {
    click: "chargingCard on declined to cardDeclined",
    shows: { current: ["cardDeclined"], path: ["order", "payment"], row: "", line: "" },
  },
  {
    click: "cardDeclined on retryCard to chargingCard",
    shows: { current: ["chargingCard"], path: ["order", "payment"], row: "", line: "" },
  },
  {
    click: "chargingCard on charged to packingParcel",
    shows: {
      current: ["packingParcel"],
      path: ["order", "payment"],
      row: "",
      line: "The walk is in packingParcel, outside group payment.",
    },
  },
  {
    click: "order",
    shows: { current: ["@delivery"], path: [], row: "now in packingParcel", line: "" },
  },
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
  return { current, path, row, line };
}

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
  return target.click({ timeout: STEP_MS }).then(() => "clicked", firstLine);
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
 * Opens the group guide on the site at `options.origin` under `options.base` in a
 * tab of `options.browser`, and replays its walk. Returns one failure line per step
 * that could not be clicked or showed something else than the guide says.
 */
export async function groupWalkFailures(options) {
  const tab = await options.browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  tab.on("pageerror", (error) => errors.push(error.message));
  await tab.goto(`${options.origin}${options.base}${GROUP_GUIDE}`);
  await tab.locator(".viz .graph g.current").first().waitFor({ timeout: MOUNT_MS });
  const failures = [];
  for (const [index, step] of STEPS.entries()) {
    const number = index + 1;
    const where = `${GROUP_GUIDE} step ${number}`;
    const clicked = await clickButton({ tab, name: step.click });
    if (clicked !== "clicked") {
      failures.push(`${where}: cannot click "${step.click}": ${clicked}`);
      break;
    }
    const wanted = JSON.stringify(step.shows);
    const shown = await shownAfter({ tab, wanted });
    if (shown !== wanted) {
      failures.push(`${where}: after "${step.click}" the viewer shows ${shown}, not ${wanted}`);
      break;
    }
  }
  for (const error of errors) failures.push(`${GROUP_GUIDE}: page error: ${error}`);
  await tab.close();
  return failures;
}
