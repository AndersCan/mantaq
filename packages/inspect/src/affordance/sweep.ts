import { createDriver } from "../drive.ts";
import type { FuzzTarget } from "../fuzz/run.ts";
import { mountViewer } from "@mantaq/viz/viewer";
import type { VizDocument } from "@mantaq/viz";
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

/** An element that looks clickable, but a click on it changed nothing visible. */
interface DeadElement {
  machine: string;
  stand: Stand;
  element: string;
}

export interface SweepReport {
  dead: DeadElement[];
  stands: number;
  clicks: number;
}

export interface SweepOptions {
  /** Runs on each fresh viewer before the sweep reads it; a test plants a dead element here. */
  afterMount?: (root: HTMLElement) => void;
}

/** What a reader sees as clickable: a button role, a tab stop, a link, or a button that is not disabled. */
const CLICKABLE = '[role="button"], [tabindex], a[href], button:not([disabled])';

/** Attributes that change what the reader sees; the rest (ids, roles, tab stops) do not. */
const SHOWN = [
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

/** Clicks every element that looks clickable at every stand of `sweepCase`, each on a fresh viewer, and reports the clicks that changed nothing. */
export async function sweep(
  sweepCase: SweepCase,
  options: SweepOptions = {},
): Promise<SweepReport> {
  const report: SweepReport = { dead: [], stands: 0, clicks: 0 };
  const queue = firstStands(sweepCase);
  const seen = new Set<string>();
  for (const stand of queue) seen.add(standKey(stand));
  for (const stand of queue) {
    report.stands += 1;
    let count = 1;
    for (let index = 0; index < count; index += 1) {
      const click = await clickAt(sweepCase, { stand, options, index });
      count = click.count;
      if (click.element === undefined) continue;
      report.clicks += 1;
      if (click.before === click.after) {
        report.dead.push({ machine: sweepCase.name, stand, element: click.element });
      }
      const moved = { ...stand, focus: click.focus };
      if (seen.has(standKey(moved))) continue;
      seen.add(standKey(moved));
      queue.push(moved);
    }
  }
  return report;
}

/** One line per dead element: the machine, the walk prefix, the stand and the element. */
export function deadLines(report: SweepReport): string[] {
  const lines: string[] = [];
  for (const dead of report.dead) {
    const { stand } = dead;
    const walk = stand.walk.join(", ");
    const focus = stand.focus.join(" > ");
    lines.push(
      `${dead.machine}: walk [${walk}], ${stand.driving}, ${stand.layout}, focus [${focus}]: ${dead.element}`,
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
  /** The last place the viewer reported, as text. */
  navigated: () => string;
}

/** A root in a window of its own: the viewer listens on its window, so a shared one would keep every swept viewer alive. Happy DOM shares its element classes between windows, so the root is an `HTMLElement` of this one too. */
function rootIn(window: Window): HTMLElement | undefined {
  const root = window.document.createElement("div");
  window.document.body.append(root);
  return root instanceof HTMLElement ? root : undefined;
}

function mountAt(sweepCase: SweepCase, at: MountAtOptions): Mounted {
  const { stand, root } = at;
  let focus = stand.focus;
  let navigated = "";
  const driver =
    stand.driving === "driver" && sweepCase.target !== undefined
      ? createDriver(sweepCase.target)
      : undefined;
  mountViewer(root, sweepCase.viz, {
    driver,
    steps: stand.walk,
    focus: stand.focus,
    diagramOnly: stand.layout === "diagram only",
    onNavigate: (where) => {
      focus = where.focus;
      navigated = JSON.stringify(where);
    },
  });
  at.options.afterMount?.(root);
  return { root, focus: () => focus, navigated: () => navigated };
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
  before: string;
  after: string;
  focus: string[];
}

const NO_CLICK: Click = { count: 0, element: undefined, before: "", after: "", focus: [] };

async function clickAt(sweepCase: SweepCase, at: ClickAtOptions): Promise<Click> {
  const window = new Window();
  const root = rootIn(window);
  if (root === undefined) return NO_CLICK;
  const mounted = mountAt(sweepCase, { ...at, root });
  const found = clickables(mounted.root);
  const element = found[at.index];
  const before = sight(mounted.root) + mounted.navigated();
  element?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  const after = sight(mounted.root) + mounted.navigated();
  const click: Click = {
    count: found.length,
    element: element === undefined ? undefined : nameOf(element),
    before,
    after,
    focus: mounted.focus(),
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
    for (const name of SHOWN) {
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
