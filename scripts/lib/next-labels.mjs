/**
 * The labels of the arrows a click sends now must show in the canvas without a
 * sideways scroll by the reader, at a docs-column and a phone width. The walk of
 * the visualizer guide checks it after each step; the group walk uses
 * `unseenLabels` too.
 */

/** The page of the visualizer guide, under the site's base. */
export const VISUALIZER_GUIDE = "guides/visualizer/";

/** The widths the walks run at: a docs column and a phone. */
const WALK_SCREENS = [
  { name: "docs column", viewport: { width: 1280, height: 900 } },
  { name: "phone", viewport: { width: 390, height: 844 } },
];

/** The steps of the checkout walk: every arrow of the shown states, the `back` arrows too. */
const CHECKOUT_STEPS = [
  "basicInfo on submitBasicInfo to shippingAddress",
  "shippingAddress on submitShipping to payment",
  "payment on submitPayment to submitting",
  "submitting on paymentFail to error",
  "error on back to payment",
  "payment on back to shippingAddress",
  "shippingAddress on back to basicInfo",
];

/** How long a step may take to show. */
const STEP_MS = 3_000;

/** How long the viewer may take to mount. */
const MOUNT_MS = 10_000;

/** Runs in the page: the name of each next arrow whose label is not inside the canvas's view, or is under the page's sticky header (its `scroll-padding-top`). */
function labelsOutOfView() {
  const out = [];
  for (const arrow of document.querySelectorAll('.viz .graph g.edge.next[role="button"]')) {
    const canvas = arrow.closest(".canvas");
    const box = canvas.getBoundingClientRect();
    const covered =
      Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    const right = box.left + canvas.clientWidth;
    const bottom = box.top + canvas.clientHeight;
    for (const line of arrow.querySelectorAll(":scope > text")) {
      const rect = line.getBoundingClientRect();
      const across = rect.left >= box.left && rect.right <= right;
      const below = rect.top >= Math.max(box.top, covered);
      const shown = across && below && rect.bottom <= bottom;
      if (!shown) out.push(arrow.getAttribute("aria-label"));
    }
  }
  return out;
}

/** The first line of a Playwright failure. */
function firstLine(error) {
  return error.message.split("\n")[0];
}

/** What the reader would have to scroll for in `tab`: the next arrows whose labels are out of the canvas's view, or nothing. */
export async function unseenLabels(tab) {
  const out = await tab.evaluate(labelsOutOfView);
  if (out.length === 0) return [];
  const names = out.join(", ");
  return [`next arrows out of the canvas's view: ${names}`];
}

/** The checkout walk in one tab sized as `options.screen`. */
async function checkoutWalk(options) {
  const { screen } = options;
  const tab = await options.browser.newPage({ viewport: screen.viewport });
  const errors = [];
  tab.on("pageerror", (error) => errors.push(error.message));
  await tab.goto(`${options.origin}${options.base}${VISUALIZER_GUIDE}`);
  await tab.locator(".viz .graph g.current").first().waitFor({ timeout: MOUNT_MS });
  const at = `${VISUALIZER_GUIDE} at ${screen.name} width`;
  const failures = [];
  for (const said of await unseenLabels(tab)) failures.push(`${at}, at the start: ${said}`);
  for (const [index, name] of CHECKOUT_STEPS.entries()) {
    const number = index + 1;
    const where = `${at}, step ${number}`;
    const button = tab.getByRole("button", { name, exact: true }).first();
    const label = button.locator(":scope > text").first();
    const clicked = await label.click({ timeout: STEP_MS }).then(() => "clicked", firstLine);
    if (clicked !== "clicked") {
      failures.push(`${where}: cannot click "${name}": ${clicked}`);
      break;
    }
    const target = name.split(" to ").at(-1);
    const current = tab.locator(`.viz .graph g.current[data-node-id="${target}"]`);
    const moved = await current.waitFor({ timeout: STEP_MS }).then(() => "moved", firstLine);
    if (moved !== "moved") {
      failures.push(`${where}: after "${name}" the walk is not in ${target}: ${moved}`);
      break;
    }
    for (const said of await unseenLabels(tab)) failures.push(`${where}: ${said}`);
  }
  for (const error of errors) failures.push(`${VISUALIZER_GUIDE}: page error: ${error}`);
  await tab.close();
  return failures;
}

/** Walks the checkout of the visualizer guide at each width; one line per step whose next arrows the reader would have to scroll to. */
export async function visualizerWalkFailures(options) {
  const walks = await Promise.all(
    WALK_SCREENS.map((screen) => checkoutWalk({ ...options, screen })),
  );
  return walks.flat();
}
