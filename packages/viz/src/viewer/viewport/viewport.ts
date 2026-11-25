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

interface Box {
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
type ViewportTool = "select" | "hand";

export interface ViewportState {
  /** 1 is the drawing's natural size: one viewBox unit is one CSS pixel. */
  scale: number;
  tool: ViewportTool;
}

interface ZoomAtOptions {
  /** The new scale; clamped to the zoom range. */
  scale: number;
}

export interface ViewportOptions {
  /** The drawing now in the container; its `viewBox` is its natural size. */
  drawing: () => Element | undefined;
  /** The room that `fit` fills; default the container's visible box. A container whose height follows the drawing passes its own. */
  fitBox?: () => Size;
}

/** Zoom and pan over a scroll container. Pan is native scroll, chained to the page; the scale is the `--viz-zoom` custom property that the drawn width reads. */
export interface Viewport {
  state: () => Readonly<ViewportState>;
  /** Scales so the drawing's point under `point` (client coordinates, as a pointer event gives them) stays put. */
  zoomAt: (point: Point, options: ZoomAtOptions) => void;
  /** Zooms to the next step, at the center of the part of the container on screen. */
  zoomIn: () => void;
  zoomOut: () => void;
  /** Scales so the whole drawing fits, and scrolls its top-left toward the container's top-left, or the window's when the container starts above it; the page scrolls for that too. */
  fit: () => void;
  /** Zooms to 100%, at the center of the part of the container on screen. */
  actualSize: () => void;
  /** Sets the tool, and `data-tool` on the container for the cursor. */
  setTool: (tool: ViewportTool) => void;
  /** Scrolls by the delta, in CSS pixels; what the container cannot take scrolls the ancestors and the page, as a wheel does. */
  panBy: (delta: Point) => void;
  /** Calls `listener` after each change of scale or tool; the result stops it. */
  subscribe: (listener: (state: Readonly<ViewportState>) => void) => () => void;
}

/** The CSS custom property on the container that holds the scale. */
const ZOOM_PROPERTY = "--viz-zoom";

/** A viewport over `container`, at 100% with the select tool. */
export function viewportOf(container: HTMLElement, options: ViewportOptions): Viewport {
  let state: ViewportState = { scale: 1, tool: "select" };
  const listeners = new Set<(state: ViewportState) => void>();
  container.style.setProperty(ZOOM_PROPERTY, String(state.scale));
  container.dataset["tool"] = state.tool;

  /** The drawing's top-left in client coordinates and its drawn width; the container's content start without a drawing. */
  function drawingBox(): { origin: Point; width: number } {
    const drawing = options.drawing();
    if (drawing === undefined) {
      const visible = visibleOrigin(container);
      const origin = { x: visible.x - container.scrollLeft, y: visible.y - container.scrollTop };
      return { origin, width: 0 };
    }
    const rect = drawing.getBoundingClientRect();
    return { origin: { x: rect.left, y: rect.top }, width: rect.width };
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
  /** "page" on an axis where the container's outer size followed the drawing; a scrollbar that came or went does not count. */
  function followed(sizeBefore: Size): Reach {
    return {
      x: container.offsetWidth === sizeBefore.width ? "canvas" : "page",
      y: container.offsetHeight === sizeBefore.height ? "canvas" : "page",
    };
  }
  function zoomAt(point: Point, zoom: ZoomAtOptions): void {
    const target = clampZoom(zoom.scale);
    if (target === state.scale) return;
    const sizeBefore = outerSize(container);
    const before = drawingBox();
    container.style.setProperty(ZOOM_PROPERTY, String(target));
    const after = drawingBox();
    const measured = before.width > 0 && after.width > 0;
    const wanted = anchoredScroll({
      scroll: { x: container.scrollLeft, y: container.scrollTop },
      pointer: point,
      origin: before.origin,
      originAfter: after.origin,
      ratio: measured ? after.width / before.width : target / state.scale,
    });
    scrollTo(wanted, followed(sizeBefore));
    changed({ ...state, scale: target });
  }
  function fit(): void {
    const drawing = options.drawing();
    const natural = viewBoxSize(drawing?.getAttribute("viewBox") ?? undefined);
    if (drawing === undefined || natural === undefined) return;
    const sizeBefore = outerSize(container);
    const box = options.fitBox?.() ?? clientSize(container);
    const target = fitZoom(natural, { box });
    container.style.setProperty(ZOOM_PROPERTY, String(target));
    const visible = visibleOrigin(container);
    const rect = drawing.getBoundingClientRect();
    const wanted = {
      x: container.scrollLeft + rect.left - Math.max(visible.x, 0),
      y: container.scrollTop + rect.top - Math.max(visible.y, 0),
    };
    scrollTo(wanted, { x: followed(sizeBefore).x, y: "page" });
    if (target !== state.scale) changed({ ...state, scale: target });
  }
  return {
    state: () => state,
    zoomAt,
    zoomIn: () => zoomAt(centerOf(container), { scale: zoomInFrom(state.scale) }),
    zoomOut: () => zoomAt(centerOf(container), { scale: zoomOutFrom(state.scale) }),
    fit,
    actualSize: () => zoomAt(centerOf(container), { scale: 1 }),
    setTool(tool) {
      if (tool === state.tool) return;
      container.dataset["tool"] = tool;
      changed({ ...state, tool });
    },
    panBy(delta) {
      scrollByChained(container, delta);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
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

/** The center of the part of the container on screen. */
function centerOf(container: HTMLElement): Point {
  const shown = shownBox(container);
  return { x: (shown.left + shown.right) / 2, y: (shown.top + shown.bottom) / 2 };
}
