import type { VizDocument, VizDriver, VizLiveState } from "@mantaq/viz";
import { createDriver } from "../drive.ts";
import type { FuzzTarget } from "../fuzz/run.ts";
import { mountViewer } from "@mantaq/viz/viewer";
import { SHOWN_ATTRIBUTES } from "./shown.ts";
import { Window } from "happy-dom";

/** One machine to sweep: its document, how to run it, and the walks to stand on. */
export interface SweepCase {
  /** The machine's name in reports. */
  name: string;
  viz: VizDocument;
  /** Runs the machine for the driver stands; undefined sweeps it without a driver only. */
  target: FuzzTarget | undefined;
  /** Walks as `?step=` texts; with a driver, the sweep stands at each prefix of each walk. */
  walks: ReadonlyArray<ReadonlyArray<string>>;
}

/** Where a click starts: one state of one viewer. */
interface Stand {
  driving: "driver" | "no driver";
  layout: "diagram only" | "with panel";
  /** The walk so far, as `?step=` texts. */
  walk: string[];
  /** The focus path, as `?focus=` tokens. */
  focus: string[];
}

/** Something wrong at a stand: a click that changed nothing visible or threw, or a walk that did not replay. */
interface Failure {
  machine: string;
  stand: Stand;
  problem: string;
}

export interface SweepReport {
  failures: Failure[];
  stands: number;
  clicks: number;
}

export interface SweepOptions {
  /** Runs on each fresh viewer before the sweep reads it; a test plants a dead element here. */
  afterMount?: (root: HTMLElement) => void;
}

/** What a reader sees as clickable: a button role, a tab stop, a link, or a button that is not disabled. */
const CLICKABLE = '[role="button"], [tabindex], a[href], button:not([disabled])';

/** The attributes that name an element in a report. */
const NAMING = [
  "data-edge-id",
  "data-node-id",
  "data-details-edge",
  "data-part",
  "data-tab",
  "data-explore-action",
  "data-child-map",
  "data-child-key",
];

/** Clicks every element that looks clickable at every stand of `sweepCase`, each on a fresh viewer, and reports the clicks that changed nothing or threw. */
export async function sweep(
  sweepCase: SweepCase,
  options: SweepOptions = {},
): Promise<SweepReport> {
  const report: SweepReport = { failures: [], stands: 0, clicks: 0 };
  const queue = firstStands(sweepCase);
  const seen = new Set<string>();
  for (const stand of queue) seen.add(standKey(stand));
  for (const stand of queue) {
    report.stands += 1;
    function fail(problem: string): void {
      report.failures.push({ machine: sweepCase.name, stand, problem });
    }
    let count = 1;
    for (let index = 0; index < count; index += 1) {
      const click = await clickAt(sweepCase, { stand, options, index });
      count = click.count;
      if (click.replayed < stand.walk.length) {
        fail(`the walk replays only ${click.replayed} of ${stand.walk.length} steps`);
        break;
      }
      if (click.element === undefined) continue;
      report.clicks += 1;
      for (const error of click.errors) fail(`${click.element} throws: ${error}`);
      if (!click.changed) fail(`${click.element} changes nothing`);
      const moved = { ...stand, focus: click.focus };
      if (seen.has(standKey(moved))) continue;
      seen.add(standKey(moved));
      queue.push(moved);
    }
  }
  return report;
}

/** One line per failure: the machine, the walk prefix, the rest of the stand, and what went wrong. */
export function failureLines(report: SweepReport): string[] {
  const lines: string[] = [];
  for (const failure of report.failures) {
    const { stand } = failure;
    const walk = stand.walk.join(", ");
    const focus = stand.focus.join(" > ");
    lines.push(
      `${failure.machine}: walk [${walk}], ${stand.driving}, ${stand.layout}, focus [${focus}]: ${failure.problem}`,
    );
  }
  return lines;
}

function firstStands(sweepCase: SweepCase): Stand[] {
  const stands: Stand[] = [];
  for (const layout of ["with panel", "diagram only"] as const) {
    stands.push({ driving: "no driver", layout, walk: [], focus: [] });
    if (sweepCase.target === undefined) continue;
    for (const walk of walkPrefixes(sweepCase.walks)) {
      stands.push({ driving: "driver", layout, walk, focus: [] });
    }
  }
  return stands;
}

/** Each prefix of each walk once, the empty walk first. */
function walkPrefixes(walks: SweepCase["walks"]): string[][] {
  const prefixes: string[][] = [[]];
  const seen = new Set<string>([""]);
  for (const walk of walks) {
    for (let length = 1; length <= walk.length; length += 1) {
      const prefix = walk.slice(0, length);
      const key = prefix.join("\n");
      if (seen.has(key)) continue;
      seen.add(key);
      prefixes.push(prefix);
    }
  }
  return prefixes;
}

function standKey(stand: Stand): string {
  return JSON.stringify(stand);
}

interface MountAtOptions {
  stand: Stand;
  options: SweepOptions;
  root: HTMLElement;
}

interface Mounted {
  root: HTMLElement;
  /** The focus path the viewer last reported, or the stand's when it reported none. */
  focus: () => string[];
  /** How many steps of the walk the driver took while the viewer opened; the walk's length without a driver. */
  replayed: number;
}

/** A root in a window of its own: the viewer listens on its window, so a shared one would keep every swept viewer alive. Happy DOM shares its element classes between windows, so the root is an `HTMLElement` of this one too. */
function rootIn(window: Window): HTMLElement | undefined {
  const root = window.document.createElement("div");
  window.document.body.append(root);
  return root instanceof HTMLElement ? root : undefined;
}

/** The driver, and the last state it reported, so the sweep can tell how far a walk replayed. */
interface Watched {
  driver: VizDriver;
  last: () => VizLiveState | undefined;
}

function watched(driver: VizDriver): Watched {
  let last: VizLiveState | undefined;
  function seen(state: VizLiveState): VizLiveState {
    last = state;
    return state;
  }
  return {
    driver: {
      ...driver,
      reset: () => seen(driver.reset()),
      step: (step) => seen(driver.step(step)),
    },
    last: () => last,
  };
}

function mountAt(sweepCase: SweepCase, at: MountAtOptions): Mounted {
  const { stand, root } = at;
  let focus = stand.focus;
  const live =
    stand.driving === "driver" && sweepCase.target !== undefined
      ? watched(createDriver(sweepCase.target))
      : undefined;
  mountViewer(root, sweepCase.viz, {
    driver: live?.driver,
    steps: stand.walk,
    focus: stand.focus,
    diagramOnly: stand.layout === "diagram only",
    onNavigate: (where) => {
      focus = where.focus;
    },
  });
  const replayed = live === undefined ? stand.walk.length : (live.last()?.steps.length ?? 0);
  at.options.afterMount?.(root);
  return { root, focus: () => focus, replayed };
}

interface ClickAtOptions {
  stand: Stand;
  options: SweepOptions;
  index: number;
}

interface Click {
  /** How many elements look clickable on this viewer. */
  count: number;
  /** The element clicked; undefined when the viewer has none at the index. */
  element: string | undefined;
  /** Whether the text or a shown attribute of the viewer changed. */
  changed: boolean;
  /** What the click threw, from the window's error events. */
  errors: string[];
  focus: string[];
  replayed: number;
}

const NO_CLICK: Click = {
  count: 0,
  element: undefined,
  changed: false,
  errors: [],
  focus: [],
  replayed: 0,
};

function errorText(event: unknown): string {
  return event instanceof ErrorEvent ? event.message : String(event);
}

async function clickAt(sweepCase: SweepCase, at: ClickAtOptions): Promise<Click> {
  const window = new Window();
  const root = rootIn(window);
  if (root === undefined) return NO_CLICK;
  const mounted = mountAt(sweepCase, { ...at, root });
  const found = clickables(mounted.root);
  const element = found[at.index];
  const errors: string[] = [];
  window.addEventListener("error", (event) => errors.push(errorText(event)));
  const before = sight(mounted.root);
  element?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  const click: Click = {
    count: found.length,
    element: element === undefined ? undefined : nameOf(element),
    changed: sight(mounted.root) !== before,
    errors,
    focus: mounted.focus(),
    replayed: mounted.replayed,
  };
  await window.happyDOM.close();
  return click;
}

/** The elements that look clickable. The open tab is left out: it is the current choice, like the current crumb, and shows no pointer. */
function clickables(root: HTMLElement): Element[] {
  const found: Element[] = [];
  for (const element of root.querySelectorAll(CLICKABLE)) {
    if (!looksClickable(element)) continue;
    found.push(element);
  }
  return found;
}

function looksClickable(element: Element): boolean {
  const tabindex = element.getAttribute("tabindex");
  const openTab =
    element.getAttribute("role") === "tab" && element.getAttribute("aria-selected") === "true";
  if (openTab) return false;
  if (element.getAttribute("role") === "button") return true;
  if (tabindex !== null && Number(tabindex) >= 0) return true;
  return element.matches("a[href], button:not([disabled])");
}

/** What the reader sees of the viewer: the text and the attributes that change how it looks. */
function sight(root: Element): string {
  const parts: string[] = [];
  for (const element of [root, ...root.querySelectorAll("*")]) {
    parts.push(`<${element.tagName}`);
    for (const name of SHOWN_ATTRIBUTES) {
      const shown = element.getAttribute(name);
      if (shown !== null) parts.push(` ${name}="${shown}"`);
    }
    for (const node of element.childNodes) {
      if (node.nodeType === node.TEXT_NODE) parts.push(node.textContent ?? "");
    }
  }
  return parts.join("");
}

/** The tag, the classes and the naming attributes; the text only when no attribute names the element. */
function nameOf(element: Element): string {
  const classes = element.getAttribute("class")?.replaceAll(" ", ".");
  const labels: string[] = [element.tagName.toLowerCase()];
  if (classes !== undefined) labels.push(`.${classes}`);
  const named = labels.length;
  for (const name of NAMING) {
    const label = element.getAttribute(name);
    if (label !== null) labels.push(`[${name}="${label}"]`);
  }
  const selector = labels.join("");
  if (labels.length > named) return selector;
  const text = (element.textContent ?? "").trim().slice(0, 40);
  return text === "" ? selector : `${selector} "${text}"`;
}
