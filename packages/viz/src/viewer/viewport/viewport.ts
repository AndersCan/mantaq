import {
  anchoredScroll,
  clampZoom,
  fitZoom,
  viewBoxSize,
  zoomInFrom,
  zoomOutFrom,
} from "./zoom.ts";
import type { Point, Size } from "./zoom.ts";
import { scrollByChained } from "./chained-scroll.ts";

/** A box in client coordinates. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Per axis, how far a scroll reaches: the container only, or on to the ancestors and the page. */
interface Reach {
  x: "canvas" | "page";
  y: "canvas" | "page";
}

/** What a plain drag does: "select" picks elements, "hand" pans. */
export type ViewportTool = "select" | "hand";

/** "fitted": the drawing has the width the page's CSS gives it, and `scale` is read from that width. "chosen": the drawn width is `scale` times the natural width. */
type ViewportSizing = "fitted" | "chosen";

/** "held": a key that pans is down, so a drag pans whatever the tool. "dragging": a drag pans now. */
type ViewportPan = "none" | "held" | "dragging";

export interface ViewportState {
  /** 1 is the drawing's natural size: one viewBox unit is one CSS pixel. */
  scale: number;
  tool: ViewportTool;
  sizing: ViewportSizing;
  pan: ViewportPan;
}

/** What a viewport starts with, and what a later one on a new container takes over. */
export type HeldViewport = Pick<ViewportState, "scale" | "tool" | "sizing">;

interface ZoomAtOptions {
  /** The new scale; clamped to the zoom range. */
  scale: number;
  /** "pinch": one small step of a wheel or pinch gesture. It keeps the scroll that rounding took off the step before, so a long pinch does not drift. Default "step". */
  kind?: "step" | "pinch";
}

export interface ViewportOptions {
  /** The drawing now in the container; its `viewBox` is its natural size. */
  drawing: () => Element | undefined;
  /** The room that `fit` fills; default the container's visible box. A container whose height follows the drawing passes its own. */
  fitBox?: () => Size;
  /** The part of the container the reader sees; zoom in, zoom out and 100% keep its center put. Default: the part inside the window. */
  shown?: () => Box;
  /** Default 100%, chosen, with the select tool. */
  initial?: HeldViewport;
}

/** Zoom and pan over a scroll container. Pan is native scroll, chained to the page; the scale is the `--viz-zoom` custom property that the drawn width reads while `data-sizing` is "chosen". */
export interface Viewport {
  state: () => Readonly<ViewportState>;
  /** Scales so the drawing's point under `point` (client coordinates, as a pointer event gives them) stays put. */
  zoomAt: (point: Point, options: ZoomAtOptions) => void;
  /** Zooms to the next step, at the center of the part of the container shown. */
  zoomIn: () => void;
  zoomOut: () => void;
  /** Scales so the whole drawing fits, and scrolls its top-left toward the container's top-left, or the window's when the container starts above it; the page scrolls for that too. */
  fit: () => void;
  /** Zooms to 100%, at the center of the part of the container shown. */
  actualSize: () => void;
  /** Sets the tool, and `data-tool` on the container for the cursor. */
  setTool: (tool: ViewportTool) => void;
  /** Sets the pan state, and `data-pan` on the container for the cursor; none removes it. */
  setPan: (pan: ViewportPan) => void;
  /** Scrolls by the delta, in CSS pixels; what the container cannot take scrolls the ancestors and the page, as a wheel does. */
  panBy: (delta: Point) => void;
  /** Call after a new drawing or a new container width: a fitted drawing reads its scale again. */
  redrawn: () => void;
  /** Calls `listener` after each change of the state; the result stops it. */
  subscribe: (listener: (state: Readonly<ViewportState>) => void) => () => void;
}

/** Where the last zoom scrolled the container to, and where it wanted to: the browser rounds the offset. */
interface ScrollRest {
  applied: Point;
  wanted: Point;
}

/** The CSS custom property on the container that holds the scale. */
const ZOOM_PROPERTY = "--viz-zoom";

const NO_OFFSET: Point = { x: 0, y: 0 };

const CHOSEN_AT_ACTUAL_SIZE: HeldViewport = { scale: 1, tool: "select", sizing: "chosen" };

/** A viewport over `container`, by default at 100% with the select tool. */
export function viewportOf(container: HTMLElement, options: ViewportOptions): Viewport {
  let state: ViewportState = { ...(options.initial ?? CHOSEN_AT_ACTUAL_SIZE), pan: "none" };
  let lastScroll: ScrollRest | undefined;
  const listeners = new Set<(state: ViewportState) => void>();
  container.style.setProperty(ZOOM_PROPERTY, String(state.scale));
  container.dataset["tool"] = state.tool;
  container.dataset["sizing"] = state.sizing;
  if (state.sizing === "fitted") {
    state = { ...state, scale: fittedScale(options.drawing()) ?? state.scale };
  }

  /** Draws at `scale` times the natural width from now on. */
  function choose(scale: number): void {
    container.dataset["sizing"] = "chosen";
    container.style.setProperty(ZOOM_PROPERTY, String(scale));
  }
  function changed(next: ViewportState): void {
    state = next;
    for (const listener of listeners) listener(state);
  }
  /** Scrolls the container to `wanted`; on the axes that `reach` names "page", the rest scrolls the ancestors and the page. */
  function scrollTo(wanted: Point, reach: Reach): void {
    container.scrollTo({ left: wanted.x, top: wanted.y, behavior: "instant" });
    const rest = { x: wanted.x - container.scrollLeft, y: wanted.y - container.scrollTop };
    scrollByChained(container, {
      x: reach.x === "page" ? beyondRounding(rest.x) : 0,
      y: reach.y === "page" ? beyondRounding(rest.y) : 0,
    });
  }
  function zoomAt(point: Point, zoom: ZoomAtOptions): void {
    const target = clampZoom(zoom.scale);
    if (target === state.scale && state.sizing === "chosen") return;
    const sizeBefore = outerSize(container);
    const drawing = options.drawing();
    const before = drawingBox(container, { drawing });
    const carried = zoom.kind === "pinch" ? roundedOff(container, { last: lastScroll }) : NO_OFFSET;
    choose(target);
    const after = drawingBox(container, { drawing });
    const measured = before.width > 0 && after.width > 0;
    const wanted = anchoredScroll({
      scroll: { x: container.scrollLeft, y: container.scrollTop },
      pointer: point,
      origin: { x: before.origin.x + carried.x, y: before.origin.y + carried.y },
      originAfter: after.origin,
      ratio: measured ? after.width / before.width : target / state.scale,
    });
    scrollTo(wanted, followed(container, { sizeBefore }));
    lastScroll = { applied: { x: container.scrollLeft, y: container.scrollTop }, wanted };
    changed({ ...state, scale: target, sizing: "chosen" });
  }
  function fit(): void {
    const drawing = options.drawing();
    const natural = viewBoxSize(drawing?.getAttribute("viewBox") ?? undefined);
    if (drawing === undefined || natural === undefined) return;
    const sizeBefore = outerSize(container);
    const box = options.fitBox?.() ?? clientSize(container);
    const target = fitZoom(natural, { box });
    const sizing = state.sizing;
    choose(target);
    const visible = visibleOrigin(container);
    const rect = drawing.getBoundingClientRect();
    const wanted = {
      x: container.scrollLeft + rect.left - Math.max(visible.x, 0),
      y: container.scrollTop + rect.top - Math.max(visible.y, 0),
    };
    scrollTo(wanted, { x: followed(container, { sizeBefore }).x, y: "page" });
    lastScroll = undefined;
    const same = target === state.scale && sizing === "chosen";
    if (!same) changed({ ...state, scale: target, sizing: "chosen" });
  }
  function redrawn(): void {
    lastScroll = undefined;
    if (state.sizing === "chosen") return;
    const scale = fittedScale(options.drawing());
    if (scale === undefined || scale === state.scale) return;
    container.style.setProperty(ZOOM_PROPERTY, String(scale));
    changed({ ...state, scale });
  }
  function center(): Point {
    return centerOf(options.shown?.() ?? shownBox(container));
  }
  return {
    state: () => state,
    zoomAt,
    zoomIn: () => zoomAt(center(), { scale: zoomInFrom(state.scale) }),
    zoomOut: () => zoomAt(center(), { scale: zoomOutFrom(state.scale) }),
    fit,
    actualSize: () => zoomAt(center(), { scale: 1 }),
    setTool(tool) {
      if (tool === state.tool) return;
      container.dataset["tool"] = tool;
      changed({ ...state, tool });
    },
    setPan(pan) {
      if (pan === state.pan) return;
      if (pan === "none") delete container.dataset["pan"];
      else container.dataset["pan"] = pan;
      changed({ ...state, pan });
    },
    redrawn,
    panBy(delta) {
      scrollByChained(container, delta);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The scale the drawn width shows now: drawn width over viewBox width; undefined while it is not laid out. */
function fittedScale(drawing: Element | undefined): number | undefined {
  const natural = viewBoxSize(drawing?.getAttribute("viewBox") ?? undefined);
  const width = drawing?.getBoundingClientRect().width ?? 0;
  if (natural === undefined || !(width > 0)) return undefined;
  return width / natural.width;
}

interface RoundedOffOptions {
  last: ScrollRest | undefined;
}

/** What rounding took off the last zoom's scroll, while the container still sits where it left it; zero after any other scroll. */
function roundedOff(container: HTMLElement, options: RoundedOffOptions): Point {
  const { last } = options;
  if (last === undefined) return NO_OFFSET;
  const still = container.scrollLeft === last.applied.x && container.scrollTop === last.applied.y;
  if (!still) return NO_OFFSET;
  const offset = { x: last.applied.x - last.wanted.x, y: last.applied.y - last.wanted.y };
  return { x: Math.abs(offset.x) < 1 ? offset.x : 0, y: Math.abs(offset.y) < 1 ? offset.y : 0 };
}

interface DrawingBoxOptions {
  drawing: Element | undefined;
}

/** The drawing's top-left in client coordinates and its drawn width; the container's content start without a drawing. */
function drawingBox(
  container: HTMLElement,
  options: DrawingBoxOptions,
): { origin: Point; width: number } {
  const { drawing } = options;
  if (drawing === undefined) {
    const visible = visibleOrigin(container);
    const origin = { x: visible.x - container.scrollLeft, y: visible.y - container.scrollTop };
    return { origin, width: 0 };
  }
  const rect = drawing.getBoundingClientRect();
  return { origin: { x: rect.left, y: rect.top }, width: rect.width };
}

interface FollowedOptions {
  sizeBefore: Size;
}

/** "page" on an axis where the container's outer size followed the drawing; a scrollbar that came or went does not count. */
function followed(container: HTMLElement, options: FollowedOptions): Reach {
  const { sizeBefore } = options;
  return {
    x: container.offsetWidth === sizeBefore.width ? "canvas" : "page",
    y: container.offsetHeight === sizeBefore.height ? "canvas" : "page",
  };
}

/** The top-left of the container's visible box (inside its border), in client coordinates. */
function visibleOrigin(container: HTMLElement): Point {
  const rect = container.getBoundingClientRect();
  return { x: rect.left + container.clientLeft, y: rect.top + container.clientTop };
}

/** Leftover scroll under a pixel is rounding, not something to pass on. */
function beyondRounding(distance: number): number {
  return Math.abs(distance) < 1 ? 0 : distance;
}

function outerSize(container: HTMLElement): Size {
  return { width: container.offsetWidth, height: container.offsetHeight };
}

function clientSize(container: HTMLElement): Size {
  return { width: container.clientWidth, height: container.clientHeight };
}

/** The part of the container's visible box inside the window, in client coordinates; the whole box when none of it is. */
function shownBox(container: HTMLElement): Box {
  const visible = visibleOrigin(container);
  const whole = {
    left: visible.x,
    top: visible.y,
    right: visible.x + container.clientWidth,
    bottom: visible.y + container.clientHeight,
  };
  const view = container.ownerDocument.defaultView;
  const shown = {
    left: Math.max(whole.left, 0),
    top: Math.max(whole.top, 0),
    right: Math.min(whole.right, view?.innerWidth ?? whole.right),
    bottom: Math.min(whole.bottom, view?.innerHeight ?? whole.bottom),
  };
  const empty = shown.right <= shown.left || shown.bottom <= shown.top;
  return empty ? whole : shown;
}

function centerOf(box: Box): Point {
  return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
}
