import { OUTLINE_ONLY, SHOWN_ATTRIBUTES } from "./shown.ts";
import type { VizDocument, VizDriver, VizLiveState } from "@mantaq/viz";
import { createDriver } from "../drive.ts";
import type { FuzzTarget } from "../fuzz/run.ts";
import { mountViewer } from "@mantaq/viz/viewer";
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
  /** Set on a stand that one click reached: the viewer is mounted, that click is made, and the sweep clicks one element it brought. */
  reached?: Reached;
}

/** A view one click reached, and the one element the sweep clicks there. */
interface Reached {
  /** The first click, by its index among the clickables of the fresh viewer. */
  index: number;
  /** The element of the first click, as reports name it. */
  name: string;
  /** The key of the element to click: one the first click brought. */
  only: string;
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
      for (const problem of problemsOf(click, { name: click.element })) fail(problem);
      report.clicks += click.again === "none" ? 1 : 2;
      for (const next of nextStands(stand, { click, index })) {
        if (seen.has(standKey(next))) continue;
        seen.add(standKey(next));
        queue.push(next);
      }
    }
  }
  return report;
}

interface ClickedOptions {
  /** The element clicked, as reports name it. */
  name: string;
}

/** What went wrong with one click: what it threw, and a click, or a second click, that changed nothing. */
function problemsOf(click: Click, options: ClickedOptions): string[] {
  const { name } = options;
  const problems: string[] = [];
  for (const error of click.errors) problems.push(`${name} throws: ${error}`);
  if (!click.changed) problems.push(`${name} changes nothing`);
  if (click.again === "unchanged") problems.push(`${name} changes nothing on a second click`);
  return problems;
}

interface NextOptions {
  click: Click;
  index: number;
}

/** Where a click leads the sweep: a new focus path or layout is a stand of its own. After a first click that changed the view, each element it brought is clicked from there. */
function nextStands(stand: Stand, options: NextOptions): Stand[] {
  const { click, index } = options;
  const moved = click.focus.join("\n") !== stand.focus.join("\n");
  if (moved || click.layout !== stand.layout) {
    return [{ ...stand, focus: click.focus, layout: click.layout, reached: undefined }];
  }
  const firstClick = stand.reached === undefined && click.changed;
  const name = click.element;
  if (!firstClick || name === undefined) return [];
  const stands: Stand[] = [];
  for (const key of click.after) {
    if (!click.before.includes(key)) stands.push({ ...stand, reached: { index, name, only: key } });
  }
  return stands;
}

/** What the reader of a failure does about it. */
const FIX = "Make it plain, or make the click do something (AGENTS.md, Docs and viz UI blocks).";

/** One line per failure: the machine, the walk prefix, the rest of the stand, and what went wrong. */
export function failureLines(report: SweepReport): string[] {
  const lines: string[] = [];
  for (const failure of report.failures) {
    const { stand } = failure;
    const walk = stand.walk.join(", ");
    const focus = stand.focus.join(" > ");
    const after = stand.reached === undefined ? "" : `, after a click on ${stand.reached.name}`;
    lines.push(
      `${failure.machine}: walk [${walk}], ${stand.driving}, ${stand.layout}, focus [${focus}]${after}: ${failure.problem}. ${FIX}`,
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

/** Stands that click the same brought element, whichever first click brought it, are one. */
function standKey(stand: Stand): string {
  return JSON.stringify({ ...stand, reached: stand.reached?.only });
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
  /** What a second click on the same element did, when the first changed the view and left the focus path: "none" when it was not made. */
  again: "changed" | "unchanged" | "none";
  /** What the click threw, from the window's error events. */
  errors: string[];
  focus: string[];
  layout: Stand["layout"];
  replayed: number;
  /** The keys of the elements that looked clickable before the click. */
  before: string[];
  /** The keys of the elements that looked clickable after it. */
  after: string[];
}

const NO_CLICK: Click = {
  count: 0,
  element: undefined,
  changed: false,
  again: "none",
  errors: [],
  focus: [],
  layout: "with panel",
  replayed: 0,
  before: [],
  after: [],
};

function errorText(event: unknown): string {
  return event instanceof ErrorEvent ? event.message : String(event);
}

async function clickAt(sweepCase: SweepCase, at: ClickAtOptions): Promise<Click> {
  const window = new Window();
  const root = rootIn(window);
  if (root === undefined) return NO_CLICK;
  const mounted = mountAt(sweepCase, { ...at, root });
  const found = reach(mounted.root, { reached: at.stand.reached });
  const errors: string[] = [];
  window.addEventListener("error", (event) => errors.push(errorText(event)));
  const element = found[at.index];
  const before = sight(mounted.root);
  const name = element === undefined ? undefined : nameOf(element);
  const keys = keysOf(found);
  clickOn(element);
  const changed = sight(mounted.root) !== before;
  const focus = mounted.focus();
  const after = keysOf(clickables(mounted.root));
  const layout = mounted.root.classList.contains("diagram-only") ? "diagram only" : "with panel";
  const samePath = focus.join("\n") === at.stand.focus.join("\n");
  const stayed = changed && samePath && layout === at.stand.layout;
  const key = keys[at.index];
  let nth = 0;
  for (const earlier of keys.slice(0, at.index)) if (earlier === key) nth += 1;
  const again = stayed && key !== undefined ? clickAgain(mounted.root, { key, nth }) : "none";
  const click: Click = {
    count: found.length,
    element: name,
    changed,
    again,
    errors,
    focus,
    layout,
    replayed: mounted.replayed,
    before: keys,
    after,
  };
  await window.happyDOM.close();
  return click;
}

function keysOf(elements: ReadonlyArray<Element>): string[] {
  const keys: string[] = [];
  for (const element of elements) keys.push(keyOf(element));
  return keys;
}

interface AgainOptions {
  key: string;
  /** Which of the elements with `key` was clicked, counted from 0: text alone may name two. */
  nth: number;
}

/** Clicks the element with `key` once more, when it still looks clickable. */
function clickAgain(root: HTMLElement, options: AgainOptions): Click["again"] {
  const same = clickables(root).filter((each) => keyOf(each) === options.key);
  const element = same[options.nth];
  if (element === undefined) return "none";
  const before = sight(root);
  clickOn(element);
  return sight(root) === before ? "unchanged" : "changed";
}

interface ReachOptions {
  reached: Reached | undefined;
}

function clickOn(element: Element | undefined): void {
  element?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

/** The elements to click at a stand: every clickable one, or, after the stand's first click, the one element it brought. */
function reach(root: HTMLElement, options: ReachOptions): Element[] {
  const { reached } = options;
  if (reached === undefined) return clickables(root);
  clickOn(clickables(root)[reached.index]);
  const found: Element[] = [];
  for (const element of clickables(root)) {
    if (keyOf(element) === reached.only) found.push(element);
  }
  return found;
}

/** The elements that look clickable. The current choice is left out: the open tab, the current crumb, and an element marked `aria-current` that is no button. Each keeps its tab stop but shows no pointer. */
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
  const role = element.getAttribute("role");
  const openTab = role === "tab" && element.getAttribute("aria-selected") === "true";
  const current = element.hasAttribute("aria-current") && role !== "button";
  if (openTab || current) return false;
  if (element.getAttribute("role") === "button") return true;
  if (tabindex !== null && Number(tabindex) >= 0) return true;
  return element.matches("a[href], button:not([disabled])");
}

interface ShownOptions {
  attribute: string;
}

/** An attribute as the reader sees it: a state's selection outline without a panel shows nothing. */
function shownValue(element: Element, options: ShownOptions): string | null {
  const shown = element.getAttribute(options.attribute);
  const outlineOnly = options.attribute === "class" && element.matches(OUTLINE_ONLY);
  if (shown === null || !outlineOnly) return shown;
  return shown.replace(/\bselected\b/u, "").trim();
}

/** What the reader sees of the viewer: the text and the attributes that change how it looks. */
function sight(root: Element): string {
  const parts: string[] = [];
  for (const element of [root, ...root.querySelectorAll("*")]) {
    parts.push(`<${element.tagName}`);
    for (const name of SHOWN_ATTRIBUTES) {
      const shown = shownValue(element, { attribute: name });
      if (shown !== null) parts.push(` ${name}="${shown}"`);
    }
    for (const node of element.childNodes) {
      if (node.nodeType === node.TEXT_NODE) parts.push(node.textContent ?? "");
    }
  }
  return parts.join("");
}

/** What names an element across a click, which may change its classes: the tag and the naming attributes, else the text. */
function keyOf(element: Element): string {
  const labels: string[] = [element.tagName.toLowerCase()];
  for (const name of NAMING) {
    const label = element.getAttribute(name);
    if (label !== null) labels.push(`[${name}="${label}"]`);
  }
  const selector = labels.join("");
  if (labels.length > 1) return selector;
  const text = (element.textContent ?? "").trim();
  return `${selector} "${text}"`;
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
