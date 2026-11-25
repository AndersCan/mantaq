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
  state: () => ViewportState;
  /** Scales so the drawing's point under `point` (client coordinates, as a pointer event gives them) stays put. */
  zoomAt: (point: Point, options: ZoomAtOptions) => void;
  /** Zooms to the next step, at the center of the part of the container on screen. */
  zoomIn: () => void;
  zoomOut: () => void;
  /** Scales so the whole drawing fits, and scrolls its top-left to the top-left of the part of the container on screen. */
  fit: () => void;
  /** Zooms to 100%, at the center of the part of the container on screen. */
  actualSize: () => void;
  /** Sets the tool, and `data-tool` on the container for the cursor. */
  setTool: (tool: ViewportTool) => void;
  /** Scrolls by the delta, in CSS pixels; what the container cannot take scrolls the ancestors and the page, as a wheel does. */
  panBy: (delta: Point) => void;
  /** Calls `listener` after each change of scale or tool; the result stops it. */
  subscribe: (listener: (state: ViewportState) => void) => () => void;
}

/** The CSS custom property on the container that holds the scale. */
const ZOOM_PROPERTY = "--viz-zoom";

/** A viewport over `container`, at 100% with the select tool. */
export function viewportOf(container: HTMLElement, options: ViewportOptions): Viewport {
  let state: ViewportState = { scale: 1, tool: "select" };
  const listeners = new Set<(state: ViewportState) => void>();
  container.style.setProperty(ZOOM_PROPERTY, String(state.scale));
  container.dataset["tool"] = state.tool;

  /** The drawing's top-left in the container's scrolled content, and its drawn width; the content's start without a drawing. */
  function drawingBox(): { origin: Point; width: number } {
    const drawing = options.drawing();
    if (drawing === undefined) return { origin: { x: 0, y: 0 }, width: 0 };
    const visible = visibleOrigin(container);
    const rect = drawing.getBoundingClientRect();
    const origin = {
      x: rect.left - visible.x + container.scrollLeft,
      y: rect.top - visible.y + container.scrollTop,
    };
    return { origin, width: rect.width };
  }
  function changed(next: ViewportState): void {
    state = next;
    for (const listener of listeners) listener(state);
  }
  function zoomAt(point: Point, zoom: ZoomAtOptions): void {
    const target = clampZoom(zoom.scale);
    if (target === state.scale) return;
    const scroll = { x: container.scrollLeft, y: container.scrollTop };
    const pointer = pointerIn(container, point);
    const before = drawingBox();
    container.style.setProperty(ZOOM_PROPERTY, String(target));
    const after = drawingBox();
    const measured = before.width > 0 && after.width > 0;
    const next = anchoredScroll({
      scroll,
      pointer,
      origin: before.origin,
      originAfter: after.origin,
      from: measured ? before.width : state.scale,
      to: measured ? after.width : target,
    });
    scrollByChained(container, {
      x: next.x - container.scrollLeft,
      y: next.y - container.scrollTop,
    });
    changed({ ...state, scale: target });
  }
  function fit(): void {
    const drawing = options.drawing();
    const natural = viewBoxSize(drawing?.getAttribute("viewBox") ?? undefined);
    if (drawing === undefined || natural === undefined) return;
    const box = options.fitBox?.() ?? {
      width: container.clientWidth,
      height: container.clientHeight,
    };
    const target = fitZoom(natural, { box });
    container.style.setProperty(ZOOM_PROPERTY, String(target));
    const shown = shownBox(container);
    const rect = drawing.getBoundingClientRect();
    scrollByChained(container, { x: rect.left - shown.left, y: rect.top - shown.top });
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

function pointerIn(container: HTMLElement, point: Point): Point {
  const visible = visibleOrigin(container);
  return { x: point.x - visible.x, y: point.y - visible.y };
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
