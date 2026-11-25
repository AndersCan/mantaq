/** A point or an offset, in CSS pixels. */
export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** The smallest scale: 10%. */
export const MIN_ZOOM = 0.1;
/** The largest scale: 800%. */
export const MAX_ZOOM = 8;
/** The scales that zoom in and zoom out stop at, smallest first. */
export const ZOOM_STEPS: readonly number[] = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];

/** Scales closer than this are the same step, so float noise next to a step does not skip it. */
const STEP_TOLERANCE = 1e-6;

/** The scale inside the zoom range; not a number is 100%. */
export function clampZoom(scale: number): number {
  if (Number.isNaN(scale)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/** The next step above the scale, or the largest scale. */
export function zoomInFrom(scale: number): number {
  const current = clampZoom(scale);
  return ZOOM_STEPS.find((step) => step > current + STEP_TOLERANCE) ?? MAX_ZOOM;
}

/** The next step below the scale, or the smallest scale. */
export function zoomOutFrom(scale: number): number {
  const current = clampZoom(scale);
  return ZOOM_STEPS.findLast((step) => step < current - STEP_TOLERANCE) ?? MIN_ZOOM;
}

export interface FitOptions {
  /** The room the drawing must fit in, in CSS pixels. */
  box: Size;
}

/** The scale that shows the whole drawing (its natural size) in the box; 100% when either has no size. */
export function fitZoom(drawing: Size, options: FitOptions): number {
  const { box } = options;
  const sizes = [drawing.width, drawing.height, box.width, box.height];
  if (sizes.some((size) => !(size > 0))) return 1;
  return clampZoom(Math.min(box.width / drawing.width, box.height / drawing.height));
}

export interface ZoomAnchor {
  /** The scroll offsets now, after the scale changed. */
  scroll: Point;
  /** The pointer, in client coordinates. */
  pointer: Point;
  /** The drawing's top-left in client coordinates before the change. */
  origin: Point;
  /** The drawing's top-left in client coordinates after the change, as laid out now. */
  originAfter: Point;
  /** How much the drawing grew: its drawn width after the change over its width before. */
  ratio: number;
}

/** The scroll offsets that put the drawing's point that was under the pointer before the change back under it. */
export function anchoredScroll(anchor: ZoomAnchor): Point {
  const { scroll, pointer, origin, originAfter, ratio } = anchor;
  return {
    x: scroll.x + originAfter.x + (pointer.x - origin.x) * ratio - pointer.x,
    y: scroll.y + originAfter.y + (pointer.y - origin.y) * ratio - pointer.y,
  };
}

/** The width and height of an SVG `viewBox` value, when both are positive numbers. */
export function viewBoxSize(value: string | undefined): Size | undefined {
  const parts = (value ?? "")
    .trim()
    .split(/[\s,]+/u)
    .map(Number);
  const [, , width = Number.NaN, height = Number.NaN] = parts;
  const valid = parts.length === 4 && width > 0 && height > 0;
  return valid ? { width, height } : undefined;
}
