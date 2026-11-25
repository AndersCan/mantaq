import {
  anchoredScroll,
  clampZoom,
  fitZoom,
  viewBoxSize,
  zoomInFrom,
  zoomOutFrom,
} from "./zoom.ts";
import type { Point, Size } from "./zoom.ts";

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

/** Zoom and pan over a scroll container. Pan is native scroll; the scale is the `--viz-zoom` custom property that the drawn width reads. */
export interface Viewport {
  state: () => ViewportState;
  /** Scales so the drawing's point under `point` (client coordinates, as a pointer event gives them) stays put. */
  zoomAt: (point: Point, options: ZoomAtOptions) => void;
  /** Zooms to the next step, at the center of the visible box. */
  zoomIn: () => void;
  zoomOut: () => void;
  /** Scales so the whole drawing fits, and scrolls to its top-left. */
  fit: () => void;
  /** Zooms to 100%, at the center of the visible box. */
  actualSize: () => void;
  /** Sets the tool, and `data-tool` on the container for the cursor. */
  setTool: (tool: ViewportTool) => void;
  /** Scrolls by the delta, in CSS pixels. */
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

  /** The drawing's top-left in the container's scrolled content; the content's start without a drawing. */
  function drawingOrigin(): Point {
    const drawing = options.drawing();
    if (drawing === undefined) return { x: 0, y: 0 };
    const visible = visibleOrigin(container);
    const rect = drawing.getBoundingClientRect();
    return {
      x: rect.left - visible.x + container.scrollLeft,
      y: rect.top - visible.y + container.scrollTop,
    };
  }
  function changed(next: ViewportState): void {
    state = next;
    for (const listener of listeners) listener(state);
  }
  function scaled(scale: number): Point {
    container.style.setProperty(ZOOM_PROPERTY, String(scale));
    changed({ ...state, scale });
    return drawingOrigin();
  }
  function zoomAt(point: Point, zoom: ZoomAtOptions): void {
    const from = state.scale;
    const target = clampZoom(zoom.scale);
    if (target === from) return;
    const anchor = {
      scroll: { x: container.scrollLeft, y: container.scrollTop },
      pointer: pointerIn(container, point),
      origin: drawingOrigin(),
    };
    const originAfter = scaled(target);
    const next = anchoredScroll({ ...anchor, originAfter, from, to: target });
    container.scrollTo({ left: next.x, top: next.y, behavior: "instant" });
  }
  function fit(): void {
    const drawing = viewBoxSize(options.drawing()?.getAttribute("viewBox") ?? undefined);
    if (drawing === undefined) return;
    const box = options.fitBox?.() ?? {
      width: container.clientWidth,
      height: container.clientHeight,
    };
    const target = fitZoom(drawing, { box });
    const origin = target === state.scale ? drawingOrigin() : scaled(target);
    container.scrollTo({ left: origin.x, top: origin.y, behavior: "instant" });
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
      container.scrollBy({ left: delta.x, top: delta.y, behavior: "instant" });
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

function centerOf(container: HTMLElement): Point {
  const visible = visibleOrigin(container);
  return { x: visible.x + container.clientWidth / 2, y: visible.y + container.clientHeight / 2 };
}
