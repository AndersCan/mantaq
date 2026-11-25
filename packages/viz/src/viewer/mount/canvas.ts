import { BOARD_PX_PER_UNIT, overlapWarning, renderBoard, renderGraph } from "../graph.ts";
import type { EnteredMachine, GraphCallbacks, Selection } from "../graph.ts";
import type { Focus, FocusMove, FocusStep } from "./focus.ts";
import { partName, partOf } from "../parts.ts";
import { currentsOf } from "../compartments.ts";
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
}

export interface Canvas {
  drawn: () => Node[];
  refit: () => void;
  /** Draws the path above the canvas and listens for Escape; call once the canvas is on the page. */
  framed: () => void;
}

/** What the canvas draws for the focus path (a board of boxes or one machine), and every move along the path. */
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
  /** The start of the bar above the canvas: the path while a machine is opened, and the overlap warning of the drawing. */
  function titled(): void {
    root.querySelector(".viz-bar-start")?.remove();
    const shown = [...pathOf(), ...warningLine()];
    if (shown.length === 0) return;
    const bar = root.querySelector(".viz-bar") ?? html(doc, "div", { class: "viz-bar" });
    if (!bar.isConnected) root.prepend(bar);
    bar.prepend(html(doc, "div", { class: "viz-bar-start" }, shown));
  }
  function pathOf(): HTMLElement[] {
    const focus = options.focus();
    if (focus.steps.length === 0) return [];
    const path = breadcrumbOf(doc, { focus, moveTo: (keep) => moveTo(focus.steps.slice(0, keep)) });
    path.addEventListener("keydown", leaveOnEscape);
    return [path];
  }
  function warningLine(): HTMLElement[] {
    const count = root.querySelector(".canvas .graph")?.getAttribute("data-overlaps");
    const warning = overlapWarning(Number(count ?? 0));
    if (warning === undefined) return [];
    return [html(doc, "p", { class: "overlap-warning" }, [warning])];
  }
  function moveTo(steps: FocusStep[]): void {
    const before = options.focus();
    view.focus = steps;
    const after = options.focus();
    options.moved({ before, after });
    swap();
    options.afterSwap();
    if (after.steps.length > before.steps.length) shownIn();
    else returnTo(before.steps[after.steps.length]);
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
        : `.graph g.machine-enter[data-enter-state="${CSS.escape(left.state)}"]`;
    root.querySelector<SVGGElement>(selector)?.focus({ preventScroll: true });
  }
  function leaveOnEscape(event: KeyboardEvent): void {
    const { steps } = options.focus();
    if (event.key !== "Escape" || steps.length === 0) return;
    event.preventDefault();
    moveTo(steps.slice(0, -1));
  }
  function open(part: string): void {
    const { machine } = options.focus();
    moveTo([...options.focus().steps, { kind: "part", part, name: partName(machine, part) }]);
  }
  function enter(entered: EnteredMachine): void {
    moveTo([...options.focus().steps, { kind: "enter", state: entered.state }]);
  }
  function drawn(): Node[] {
    drawnUnits = canvasUnits();
    const focus = options.focus();
    if (focus.canvas === "board") {
      return [renderBoard(doc, focus.machine, { width: drawnUnits, open })];
    }
    const graph = renderGraph(doc, focus.drawn, { ...options.callbacks(), enter });
    if (focus.part !== undefined) graph.setAttribute("data-zoom", focus.part);
    return [graph];
  }
  function refit(): void {
    if (options.focus().canvas !== "board" || canvasUnits() === drawnUnits) return;
    swap();
    options.mark();
  }
  function framed(): void {
    root.querySelector<HTMLElement>(".canvas")?.addEventListener("keydown", leaveOnEscape);
    titled();
  }
  return { drawn, refit, framed };
}

interface BreadcrumbOptions {
  focus: Focus;
  moveTo: (keep: number) => void;
}

/** The path above the canvas: the root machine, then each machine opened; a click on one goes back to it. */
function breadcrumbOf(doc: Document, options: BreadcrumbOptions): HTMLElement {
  const { crumbs } = options.focus;
  const crumbItems: HTMLElement[] = [];
  for (const [index, crumb] of crumbs.entries()) {
    const button = html(doc, "button", { type: "button" }, [crumb.label]);
    if (index === crumbs.length - 1) button.setAttribute("aria-current", "location");
    else button.addEventListener("click", () => options.moveTo(crumb.keep));
    crumbItems.push(html(doc, "li", {}, [button]));
  }
  return html(doc, "nav", { class: "focus-path", "aria-label": "Machines opened" }, [
    html(doc, "ol", {}, crumbItems),
  ]);
}

export interface KeepCurrentOptions {
  focus: Focus;
  view: ViewState;
}

/** Scrolls to the live state; in a shown machine, to a state drawn there, never the page. An entered machine has no live state. */
export function keepCurrentInView(root: HTMLElement, from: KeepCurrentOptions): void {
  const { focus, view } = from;
  if (view.live === null || focus.walk === "static") return;
  const live = currentsOf(view.live, view.picked);
  const { machine, rootPart } = focus;
  const currents =
    rootPart === undefined ? live : live.filter((id) => partOf(machine, id) === rootPart);
  const now = currents[0];
  if (now !== undefined) keepInView(root, now);
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

interface StaticCallbackOptions {
  openDetails: (selection: Selection) => void;
}

/** An entered machine is drawn without the walk: a click on a state or an arrow only opens its Details. */
export function staticCallbacks(view: ViewState, options: StaticCallbackOptions): GraphCallbacks {
  const callbacks: GraphCallbacks = { select: options.openDetails };
  if (view.diagramOnly) return callbacks;
  callbacks.details = (id) => options.openDetails({ kind: "edge", id });
  return callbacks;
}
