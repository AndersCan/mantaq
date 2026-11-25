import type { Viewport, ViewportState } from "./viewport.ts";
import { isNever } from "../../is-never.ts";

/** What a key does to the viewport. */
type NavigationKey = "zoomIn" | "zoomOut" | "fit" | "actualSize" | "hand" | "select";

/** With Ctrl or Cmd, by `key`: "+" is Shift and "=" on most layouts. */
const COMMAND_KEYS = new Map<string, NavigationKey>([
  ["=", "zoomIn"],
  ["+", "zoomIn"],
  ["-", "zoomOut"],
  ["_", "zoomOut"],
]);

/** With Shift, by `code`, so the layout's symbol on the digit does not matter. */
const SHIFT_CODES = new Map<string, NavigationKey>([
  ["Digit1", "fit"],
  ["Digit0", "actualSize"],
]);

const PLAIN_KEYS = new Map<string, NavigationKey>([
  ["h", "hand"],
  ["v", "select"],
]);

/** CSS pixels per wheel delta unit, by `deltaMode`: pixels, lines, pages. */
const PIXELS_PER_DELTA = [1, 16, 400];

/** How fast a wheel or pinch zooms: the scale doubles per this many pixels of delta. */
const PIXELS_PER_DOUBLING = 100;

/** The largest zoom one wheel event makes, as a power of two, so a mouse notch is not a jump. */
const LARGEST_WHEEL_STEP = 0.5;

/** Where Space presses or types: it keeps its own meaning there. */
const SPACE_TAKERS =
  'button, a[href], summary, select, [role="button"], [role="tab"], [role="link"], [role="checkbox"], [role="radio"], [role="menuitem"], [role="switch"]';

/** Each viewer root's viewport getter: a viewer drawn again on the same root replaces it. */
const viewports = new WeakMap<HTMLElement, () => Viewport | undefined>();

export interface NavigationOptions {
  /** The viewport on the canvas drawn now. */
  viewport: () => Viewport | undefined;
}

/**
 * Zoom and pan for the canvas of the viewer in `root`: Ctrl or Cmd with the
 * wheel or a pinch zooms at the pointer, Space or the middle button with a drag
 * pans, and so does a drag with the Hand tool. Keys act while focus is in the
 * viewer, or nothing has focus and the pointer is over the canvas. Listens once
 * per root.
 */
export function listenNavigation(root: HTMLElement, options: NavigationOptions): void {
  const listening = viewports.has(root);
  viewports.set(root, options.viewport);
  if (listening) return;
  const doc = root.ownerDocument;
  let spaceDown = false;
  function current(): Viewport | undefined {
    return viewports.get(root)?.();
  }
  function afterDrag(): ViewportState["pan"] {
    return spaceDown ? "held" : "none";
  }
  function released(): void {
    spaceDown = false;
    const viewport = current();
    if (viewport?.state().pan === "held") viewport.setPan("none");
  }
  root.addEventListener(
    "wheel",
    (event) => {
      const viewport = current();
      if (viewport !== undefined && canvasUnder(root, { target: event.target }) !== undefined) {
        wheelZoom(event, { viewport });
      }
    },
    { passive: false },
  );
  root.addEventListener("pointerdown", (event) => {
    const viewport = current();
    const canvas = canvasUnder(root, { target: event.target });
    if (viewport === undefined || canvas === undefined) return;
    if (!pans(event, { viewport })) return;
    event.preventDefault();
    dragPan(canvas, { start: event, viewport, afterward: afterDrag });
  });
  doc.addEventListener("keydown", (event) => {
    const viewport = current();
    const ours = !event.defaultPrevented && keysHere(root, event);
    if (viewport === undefined || !ours) return;
    if (event.key === " ") {
      if (takesSpace(event.target)) return;
      event.preventDefault();
      spaceDown = true;
      if (viewport.state().pan === "none") viewport.setPan("held");
      return;
    }
    const key = keyFor(event);
    if (key === undefined || event.repeat) return;
    event.preventDefault();
    act(viewport, { key });
  });
  doc.addEventListener("keyup", (event) => {
    if (event.key === " " && spaceDown) released();
  });
  doc.defaultView?.addEventListener("blur", released);
}

interface UnderOptions {
  target: EventTarget | null;
}

/** The viewer's canvas when the target is in it. */
function canvasUnder(root: HTMLElement, options: UnderOptions): HTMLElement | undefined {
  const { target } = options;
  if (!(target instanceof Element)) return undefined;
  const canvas = target.closest<HTMLElement>(".canvas");
  return canvas !== null && root.contains(canvas) ? canvas : undefined;
}

interface ViewportOptions {
  viewport: Viewport;
}

/** Ctrl or Cmd with the wheel, and a trackpad pinch (a wheel with `ctrlKey`), zoom at the pointer; a plain or Shift wheel stays a scroll. */
function wheelZoom(event: WheelEvent, options: ViewportOptions): void {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  const { viewport } = options;
  const pixels = event.deltaY * (PIXELS_PER_DELTA[event.deltaMode] ?? 1);
  const doublings = Math.max(
    -LARGEST_WHEEL_STEP,
    Math.min(LARGEST_WHEEL_STEP, -pixels / PIXELS_PER_DOUBLING),
  );
  const scale = viewport.state().scale * 2 ** doublings;
  viewport.zoomAt({ x: event.clientX, y: event.clientY }, { scale, kind: "pinch" });
}

/** The middle button pans with any tool; the main button pans with the Hand tool or while Space is held. */
function pans(event: PointerEvent, options: ViewportOptions): boolean {
  const { tool, pan } = options.viewport.state();
  if (event.button === 1) return true;
  return event.button === 0 && (tool === "hand" || pan === "held");
}

interface DragOptions {
  start: PointerEvent;
  viewport: Viewport;
  /** The pan state once the drag ends. */
  afterward: () => ViewportState["pan"];
}

/** Scrolls the canvas with the pointer until the button that started it is up. */
function dragPan(canvas: HTMLElement, options: DragOptions): void {
  const { start, viewport } = options;
  let last = { x: start.clientX, y: start.clientY };
  canvas.setPointerCapture(start.pointerId);
  viewport.setPan("dragging");
  function moved(event: PointerEvent): void {
    if (event.pointerId !== start.pointerId) return;
    viewport.panBy({ x: last.x - event.clientX, y: last.y - event.clientY });
    last = { x: event.clientX, y: event.clientY };
  }
  function ended(event: PointerEvent): void {
    if (event.pointerId !== start.pointerId) return;
    canvas.removeEventListener("pointermove", moved);
    canvas.removeEventListener("pointerup", ended);
    canvas.removeEventListener("pointercancel", ended);
    viewport.setPan(options.afterward());
  }
  canvas.addEventListener("pointermove", moved);
  canvas.addEventListener("pointerup", ended);
  canvas.addEventListener("pointercancel", ended);
}

/** True for a key from inside the viewer, outside a text field and the host's own screen; or from a page where nothing has focus while the pointer is over the canvas. */
function keysHere(root: HTMLElement, event: KeyboardEvent): boolean {
  const { target } = event;
  if (target instanceof Element && root.contains(target)) return !typesHere(target);
  const doc = root.ownerDocument;
  const unfocused = doc.activeElement === null || doc.activeElement === doc.body;
  return unfocused && root.querySelector(".canvas")?.matches(":hover") === true;
}

function typesHere(target: Element): boolean {
  const field = target.closest(
    'input, textarea, select, [contenteditable=""], [contenteditable="true"]',
  );
  return field !== null || target.closest('[data-tab-panel="screen"]') !== null;
}

/** True where Space presses a control: it keeps doing that. */
function takesSpace(target: EventTarget | null): boolean {
  return target instanceof Element && target.matches(SPACE_TAKERS);
}

function keyFor(event: KeyboardEvent): NavigationKey | undefined {
  const command = event.ctrlKey || event.metaKey;
  if (event.altKey) return undefined;
  if (command) return COMMAND_KEYS.get(event.key);
  if (event.shiftKey) return SHIFT_CODES.get(event.code);
  return PLAIN_KEYS.get(event.key.toLowerCase());
}

interface ActOptions {
  key: NavigationKey;
}

function act(viewport: Viewport, options: ActOptions): void {
  const { key } = options;
  switch (key) {
    case "zoomIn":
      viewport.zoomIn();
      return;
    case "zoomOut":
      viewport.zoomOut();
      return;
    case "fit":
      viewport.fit();
      return;
    case "actualSize":
      viewport.actualSize();
      return;
    case "hand":
      viewport.setTool("hand");
      return;
    case "select":
      viewport.setTool("select");
      return;
    default:
      isNever(key);
  }
}
