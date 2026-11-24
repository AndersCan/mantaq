import { BOARD_PX_PER_UNIT, renderBoard, renderGraph } from "../graph.ts";
import { partOf, partsOf } from "../parts.ts";
import { currentsOf } from "../compartments.ts";
import type { GraphCallbacks } from "../graph.ts";
import { html } from "../dom.ts";
import { keepInView } from "../keep-in-view.ts";
import type { ViewState } from "./view-state.ts";
import type { VizMachine } from "../../schema.ts";

/** Board width in units where the canvas has no size (not laid out). */
const BOARD_UNITS_UNMEASURED = 800;

export interface CanvasOptions {
  doc: Document;
  root: HTMLElement;
  machine: VizMachine;
  view: ViewState;
  shown: () => VizMachine;
  callbacks: () => GraphCallbacks;
  afterSwap: () => void;
  mark: () => void;
}

export interface Canvas {
  drawn: () => Node[];
  refit: () => void;
  titled: () => void;
}

/** What the canvas draws: the board of boxes or one machine of it, and the redraw when the window width changes. */
export function canvasOf(options: CanvasOptions): Canvas {
  const { doc, root, machine, view, shown } = options;
  let drawnUnits = 0;
  function onBoard(): boolean {
    return partsOf(machine).length > 0 && view.zoom === null;
  }
  function canvasUnits(): number {
    const canvas = root.querySelector<HTMLElement>(".canvas");
    return (canvas ?? root).clientWidth / BOARD_PX_PER_UNIT || BOARD_UNITS_UNMEASURED;
  }
  function swap(): void {
    root.querySelector(".canvas")?.replaceChildren(...drawn());
    titled();
  }
  function titled(): void {
    root.querySelector(".part-title")?.remove();
    if (view.zoom === null) return;
    const bar = root.querySelector(".viz-bar") ?? html(doc, "div", { class: "viz-bar" });
    if (!bar.isConnected) root.prepend(bar);
    bar.prepend(titleOf());
  }
  function open(part: string): void {
    view.zoom = part;
    swap();
    options.afterSwap();
    const at =
      root.querySelector<SVGGElement>(".graph g.state.current") ??
      root.querySelector<SVGGElement>(".graph g.state.initial");
    const id = at?.getAttribute("data-node-id");
    if (typeof id === "string") keepInView(root, id);
    root.querySelector<HTMLElement>(".part-title")?.focus({ preventScroll: true });
  }
  function leave(): void {
    view.zoom = null;
    swap();
    options.afterSwap();
  }
  function drawn(): Node[] {
    drawnUnits = canvasUnits();
    if (onBoard()) return [renderBoard(doc, machine, { width: drawnUnits, open })];
    const graph = renderGraph(doc, shown(), options.callbacks());
    if (view.zoom !== null) graph.setAttribute("data-zoom", view.zoom);
    return [graph];
  }
  function titleOf(): HTMLElement {
    const title = html(doc, "button", { type: "button", class: "part-title" }, [shown().id]);
    title.setAttribute("aria-label", `${shown().id}: show all machines`);
    title.addEventListener("click", leave);
    return title;
  }
  function refit(): void {
    if (!onBoard() || canvasUnits() === drawnUnits) return;
    swap();
    options.mark();
  }
  return { drawn, refit, titled };
}

export interface KeepCurrentOptions {
  machine: VizMachine;
  view: ViewState;
}

/** Scrolls to the live state; in a shown machine, to a state drawn there, never the page. */
export function keepCurrentInView(root: HTMLElement, from: KeepCurrentOptions): void {
  const { machine, view } = from;
  if (view.live === null) return;
  const live = currentsOf(view.live, view.picked);
  const currents =
    view.zoom === null ? live : live.filter((id) => partOf(machine, id) === view.zoom);
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
