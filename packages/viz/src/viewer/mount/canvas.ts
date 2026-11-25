import { BOARD_PX_PER_UNIT, overlapWarning, renderBoard, renderGraph } from "../graph.ts";
import { drawnNodeName, drawnNodeOf } from "../groups/fold-groups.ts";
import type { EnteredGroup, GraphCallbacks, Selection } from "../graph.ts";
import type { Focus, FocusMove, FocusStep } from "./focus.ts";
import { focusTokens } from "./focus.ts";
import { partName, partOf } from "../parts.ts";
import { currentsOf } from "../compartments.ts";
import { enteredGroupOf } from "../groups/group-machine.ts";
import { html } from "../dom.ts";
import { keepInView } from "../keep-in-view.ts";
import type { ViewState } from "./view-state.ts";

/** Board width in units where the canvas has no size (not laid out). */
const BOARD_UNITS_UNMEASURED = 800;

export interface CanvasOptions {
  doc: Document;
  root: HTMLElement;
  view: ViewState;
  focus: () => Focus;
  callbacks: () => GraphCallbacks;
  /** Called once `view.focus` holds the new path, before the canvas and the panel are drawn again. */
  moved: (move: FocusMove) => void;
  afterSwap: () => void;
  mark: () => void;
  /** Selects what a move lands on, so the next draw rings it and shows its Details. */
  choose: (selection: Selection) => void;
}

export interface Canvas {
  drawn: () => Node[];
  refit: () => void;
  /** Draws the path above the canvas; call once the canvas is on the page. */
  framed: () => void;
  /** Goes back one level of the path; false at the top. */
  back: () => boolean;
  /** Says in the bar where the walk is while it is outside the group entered. */
  walked: () => void;
  /** Moves along the path to `steps`, as a link names it; nothing when the canvas shows them already. */
  follow: (steps: FocusStep[]) => void;
}

/** Where focus lands after a move. */
interface Landing {
  /** A state of the machine drawn now: focus goes to the node that draws it. Unset: the control that led here. */
  onto?: string;
}

/** What the canvas draws for the focus path (a board of boxes, one machine or a group entered), and every move along the path. */
export function canvasOf(options: CanvasOptions): Canvas {
  const { doc, root, view } = options;
  let drawnUnits = 0;
  function canvasUnits(): number {
    const canvas = root.querySelector<HTMLElement>(".canvas");
    return (canvas ?? root).clientWidth / BOARD_PX_PER_UNIT || BOARD_UNITS_UNMEASURED;
  }
  function swap(): void {
    root.querySelector(".canvas")?.replaceChildren(...drawn());
    titled();
  }
  /** The start of the bar above the canvas: the path while a machine is opened or a group entered, then its notices. */
  function titled(): void {
    root.querySelector(".viz-bar-start")?.remove();
    const shown = [...pathOf(), ...noticeLines(doc, { root, view })];
    if (shown.length === 0) return;
    const bar = root.querySelector(".viz-bar") ?? html(doc, "div", { class: "viz-bar" });
    if (!bar.isConnected) root.prepend(bar);
    bar.prepend(html(doc, "div", { class: "viz-bar-start" }, shown));
  }
  function pathOf(): HTMLElement[] {
    const focus = options.focus();
    if (focus.steps.length === 0) return [];
    const path = breadcrumbOf(doc, { focus, moveTo: (keep) => moveTo(focus.steps.slice(0, keep)) });
    if (focus.groupNode === undefined) return [path];
    return [path, html(doc, "p", { class: "walk-outside muted", role: "status" })];
  }
  function walked(): void {
    const line = root.querySelector(".viz-bar .walk-outside");
    if (line !== null) line.textContent = outsideText({ focus: options.focus(), view }) ?? "";
  }
  function moveTo(steps: FocusStep[], landing: Landing = {}): void {
    const { onto } = landing;
    const before = options.focus();
    view.focus = steps;
    view.focusNotice = undefined;
    const after = options.focus();
    options.moved({ before, after });
    swap();
    options.afterSwap();
    if (onto !== undefined) landOn(onto);
    else if (after.steps.length > before.steps.length) shownIn();
    else returnTo(before.steps[after.steps.length]);
  }
  /** Focuses the node that draws `state` now: the state, or its group node. */
  function landOn(state: string): void {
    const id = drawnNodeOf(options.focus().drawn, { state });
    keepInView(root, id);
    const node = root.querySelector<SVGGElement>(`.graph g[data-node-id="${CSS.escape(id)}"]`);
    if (node === null) return;
    // A plain node takes focus only with a tabindex; -1 keeps it out of the tab order, as a plain node that has focus is.
    if (!node.hasAttribute("tabindex")) node.setAttribute("tabindex", "-1");
    node.focus({ preventScroll: true });
  }
  function shownIn(): void {
    const at =
      root.querySelector<SVGGElement>(".graph g.state.current") ??
      root.querySelector<SVGGElement>(".graph g.state.initial");
    const id = at?.getAttribute("data-node-id");
    if (typeof id === "string") keepInView(root, id);
    root.querySelector<HTMLElement>(".focus-path [aria-current]")?.focus({ preventScroll: true });
  }
  function returnTo(left: FocusStep | undefined): void {
    if (left === undefined) return;
    const selector =
      left.kind === "part"
        ? `.graph g.part[data-part="${CSS.escape(left.part)}"]`
        : `.graph g.machine-enter[data-enter-group="${CSS.escape(left.node)}"]`;
    root.querySelector<SVGGElement>(selector)?.focus({ preventScroll: true });
  }
  function back(): boolean {
    const { steps } = options.focus();
    if (steps.length === 0) return false;
    moveTo(steps.slice(0, -1));
    return true;
  }
  function follow(steps: FocusStep[]): void {
    const shown = focusTokens(options.focus().steps).join("\n");
    if (focusTokens(steps).join("\n") !== shown) moveTo(steps);
  }
  function open(part: string): void {
    const { machine } = options.focus();
    moveTo([...options.focus().steps, { kind: "part", part, name: partName(machine, part) }]);
  }
  function enter(entered: EnteredGroup): void {
    const { node, name } = entered;
    moveTo([...options.focus().steps, { kind: "enter", node, name }]);
  }
  function leave(state: string): void {
    options.choose({ kind: "state", id: state });
    moveTo(options.focus().steps.slice(0, -1), { onto: state });
  }
  function drawn(): Node[] {
    drawnUnits = canvasUnits();
    const focus = options.focus();
    if (focus.canvas === "board") {
      return [renderBoard(doc, focus.machine, { width: drawnUnits, open })];
    }
    const graph = renderGraph(doc, focus.drawn, { ...options.callbacks(), enter, leave });
    if (focus.part !== undefined) graph.setAttribute("data-zoom", focus.part);
    return [graph];
  }
  function refit(): void {
    if (options.focus().canvas !== "board" || canvasUnits() === drawnUnits) return;
    swap();
    options.mark();
  }
  return { drawn, refit, framed: titled, walked, back, follow };
}

interface NoticeOptions {
  root: HTMLElement;
  view: ViewState;
}

/** The notices in the bar: a part of a link's path that is not there, and the overlap warning of the drawing. */
function noticeLines(doc: Document, options: NoticeOptions): HTMLElement[] {
  const { root, view } = options;
  const lines: HTMLElement[] = [];
  const notice = view.focusNotice;
  if (notice !== undefined) {
    lines.push(html(doc, "p", { class: "focus-notice", role: "status" }, [notice]));
  }
  const count = root.querySelector(".canvas .graph")?.getAttribute("data-overlaps");
  const warning = overlapWarning(Number(count ?? 0));
  if (warning !== undefined) lines.push(html(doc, "p", { class: "overlap-warning" }, [warning]));
  return lines;
}

interface BreadcrumbOptions {
  focus: Focus;
  moveTo: (keep: number) => void;
}

/** The path above the canvas: the root machine, then each machine opened and the group entered; a click on one goes back to it. The one shown is plain text that focus can land on. */
function breadcrumbOf(doc: Document, options: BreadcrumbOptions): HTMLElement {
  const { crumbs } = options.focus;
  const crumbItems: HTMLElement[] = [];
  for (const [index, crumb] of crumbs.entries()) {
    crumbItems.push(
      html(doc, "li", {}, [
        crumbOf(doc, { crumb, current: index === crumbs.length - 1, moveTo: options.moveTo }),
      ]),
    );
  }
  return html(doc, "nav", { class: "focus-path", "aria-label": "Path" }, [
    html(doc, "ol", {}, crumbItems),
  ]);
}

interface CrumbOptions {
  crumb: Focus["crumbs"][number];
  current: boolean;
  moveTo: (keep: number) => void;
}

function crumbOf(doc: Document, options: CrumbOptions): HTMLElement {
  const { crumb } = options;
  if (options.current) {
    return html(doc, "span", { "aria-current": "location", tabindex: "-1" }, [crumb.label]);
  }
  const button = html(doc, "button", { type: "button" }, [crumb.label]);
  button.addEventListener("click", () => options.moveTo(crumb.keep));
  return button;
}

export interface KeepCurrentOptions {
  focus: Focus;
  view: ViewState;
}

/** The walk's current states in the machine or board machine shown. */
function shownCurrents(from: KeepCurrentOptions): string[] {
  const { focus, view } = from;
  if (view.live === null) return [];
  const live = currentsOf(view.live, view.picked);
  const { machine, part } = focus;
  return part === undefined ? live : live.filter((id) => partOf(machine, id) === part);
}

/** Scrolls to the live state, or the group node that draws it; in a shown machine, to a state drawn there, never the page. */
export function keepCurrentInView(root: HTMLElement, from: KeepCurrentOptions): void {
  const now = shownCurrents(from)[0];
  if (now !== undefined) keepInView(root, drawnNodeOf(from.focus.drawn, { state: now }));
}

/** Where the walk is while a group is entered and the walk is in none of its states; undefined otherwise. */
function outsideText(from: KeepCurrentOptions): string | undefined {
  const group = enteredGroupOf(from.focus.drawn);
  const currents = shownCurrents(from);
  if (group === undefined || currents.length === 0) return undefined;
  if (currents.some((state) => group.states.includes(state))) return undefined;
  const names: string[] = [];
  for (const node of currents) names.push(drawnNodeName(from.focus.drawn, { node }));
  const listed = names.join(", ");
  const drawn = currents.some((state) => from.focus.drawn.states.some((each) => each.id === state));
  const hint = drawn ? "" : " Go back to walk on.";
  return `The walk is in ${listed}, outside group ${group.name}.${hint}`;
}

export interface ListenWidthOptions {
  refit: () => void;
}

/** Calls `refit` when the window width changes, which entering full screen does too. */
export function listenWidth(root: HTMLElement, options: ListenWidthOptions): void {
  function refitHere(): void {
    if (root.isConnected) options.refit();
  }
  root.ownerDocument.defaultView?.addEventListener("resize", refitHere);
  root.addEventListener("fullscreenchange", refitHere);
}
