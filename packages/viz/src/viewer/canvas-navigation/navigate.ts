import type { Viewport, ViewportState } from "../viewport/viewport.ts";
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

/** Wheel events closer than this (ms) are one pinch: it keeps zooming when the canvas shrank from under the pointer. */
const PINCH_GAP_MS = 300;

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
 * viewer, or nothing has focus and the reader last touched the viewer. Listens
 * once per root.
 */
export function listenNavigation(root: HTMLElement, options: NavigationOptions): void {
  const listening = viewports.has(root);
  viewports.set(root, options.viewport);
  if (listening) return;
  const doc = root.ownerDocument;
  const keys: KeyState = { touched: false, spaceDown: false, lastZoom: -Infinity };
  function current(): Viewport | undefined {
    return viewports.get(root)?.();
  }
  function afterDrag(): ViewportState["pan"] {
    return keys.spaceDown ? "held" : "none";
  }
  function released(): void {
    keys.spaceDown = false;
    keys.touched = false;
    const viewport = current();
    if (viewport?.state().pan === "held") viewport.setPan("none");
  }
  // On the document, so a pinch that shrank the canvas from under the pointer still zooms it.
  doc.addEventListener(
    "wheel",
    (event) => {
      const viewport = current();
      if (event.defaultPrevented) return;
      const onCanvas = isOverCanvas(root, { target: event.target });
      const going = event.timeStamp - keys.lastZoom < PINCH_GAP_MS;
      if (viewport === undefined || !(onCanvas || going)) return;
      if (!wheelZoom(event, { viewport })) return;
      keys.lastZoom = event.timeStamp;
      keys.touched = true;
    },
    { passive: false },
  );
  doc.addEventListener(
    "pointerdown",
    (event) => {
      keys.touched = event.target instanceof Node && root.contains(event.target);
    },
    { capture: true },
  );
  root.addEventListener("pointerdown", (event) => {
    const viewport = current();
    const canvas = canvasUnder(root, { target: event.target });
    if (viewport === undefined || canvas === undefined) return;
    if (!pans(event, { viewport, held: keys.spaceDown })) return;
    event.preventDefault();
    const focused = doc.activeElement;
    if (focused instanceof HTMLElement && !canvas.contains(focused)) focused.blur();
    dragPan(canvas, { start: event, viewport, afterward: afterDrag });
  });
  // Capture: a diagram button presses on its own keydown, before this would hear it.
  doc.addEventListener(
    "keydown",
    (event) => {
      const viewport = current();
      const space = isPlainSpace(event) && keysHere(root, { event, keys }) && overCanvas(root);
      if (viewport === undefined || !space) return;
      keys.spaceDown = true;
      if (viewport.state().pan === "none") viewport.setPan("held");
      // A focused control keeps its press for a tap; a drag blurs it, which cancels the press.
      if (takesSpace(root, { target: event.target })) return;
      event.preventDefault();
      event.stopPropagation();
    },
    { capture: true },
  );
  doc.addEventListener("keydown", (event) => {
    const viewport = current();
    const ours = !event.defaultPrevented && keysHere(root, { event, keys });
    if (viewport === undefined || !ours) return;
    const key = keyFor(event);
    if (key === undefined) return;
    event.preventDefault();
    act(viewport, { key });
  });
  doc.addEventListener("keyup", (event) => {
    if (event.key !== " " || !keys.spaceDown) return;
    keys.spaceDown = false;
    const viewport = current();
    if (viewport?.state().pan === "held") viewport.setPan("none");
  });
  doc.defaultView?.addEventListener("blur", released);
}

/** What the listeners of one viewer remember between events. */
interface KeyState {
  /** The last pointerdown on the page, or the last wheel zoom, was in this viewer: keys act while nothing has focus. */
  touched: boolean;
  spaceDown: boolean;
  /** The `timeStamp` of the last wheel event that zoomed. */
  lastZoom: number;
}

interface UnderOptions {
  target: EventTarget | null;
}

/** The target is in the canvas, or in the zoom and pan tools that float over it: a pinch there zooms the canvas, not the page. A press on the tools stays a press, so pans read `canvasUnder`. */
function isOverCanvas(root: HTMLElement, options: UnderOptions): boolean {
  const { target } = options;
  if (!(target instanceof Element)) return false;
  const frame = target.closest(".canvas-frame");
  return frame !== null && root.contains(frame);
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

/** Ctrl or Cmd with the wheel, and a trackpad pinch (a wheel with `ctrlKey`), zoom at the pointer; a plain or Shift wheel stays a scroll. True when it zoomed. */
function wheelZoom(event: WheelEvent, options: ViewportOptions): boolean {
  if (!event.ctrlKey && !event.metaKey) return false;
  event.preventDefault();
  const { viewport } = options;
  const pixels = event.deltaY * (PIXELS_PER_DELTA[event.deltaMode] ?? 1);
  const doublings = Math.max(
    -LARGEST_WHEEL_STEP,
    Math.min(LARGEST_WHEEL_STEP, -pixels / PIXELS_PER_DOUBLING),
  );
  const scale = viewport.state().scale * 2 ** doublings;
  viewport.zoomAt({ x: event.clientX, y: event.clientY }, { scale, kind: "pinch" });
  return true;
}

interface PansOptions {
  viewport: Viewport;
  /** Space is down, also for a viewport drawn after it went down. */
  held: boolean;
}

/** The middle button pans with any tool; the main button pans with the Hand tool or while Space is held. */
function pans(event: PointerEvent, options: PansOptions): boolean {
  const { tool, pan } = options.viewport.state();
  if (event.button === 1) return true;
  const panning = tool === "hand" || pan === "held" || options.held;
  return event.button === 0 && panning;
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

interface KeysHereOptions {
  event: KeyboardEvent;
  keys: KeyState;
}

/** True for a key from inside the viewer, outside a text field and the host's own screen; or from a page where nothing has focus, the reader last touched this viewer, and it is on screen. */
function keysHere(root: HTMLElement, options: KeysHereOptions): boolean {
  const { target } = options.event;
  if (target instanceof Element && root.contains(target)) return !typesHere(target);
  const doc = root.ownerDocument;
  const unfocused = doc.activeElement === null || doc.activeElement === doc.body;
  return unfocused && options.keys.touched && onScreen(root);
}

/** Some of the canvas is inside the window: a viewer scrolled out of sight leaves the keys to the page. */
function onScreen(root: HTMLElement): boolean {
  const rect = root.querySelector(".canvas")?.getBoundingClientRect();
  const view = root.ownerDocument.defaultView;
  if (rect === undefined || view === null) return false;
  const across = rect.right > 0 && rect.left < view.innerWidth;
  return across && rect.bottom > 0 && rect.top < view.innerHeight;
}

function overCanvas(root: HTMLElement): boolean {
  return root.querySelector(".canvas")?.matches(":hover") === true;
}

/** Space alone: with Shift it pages up, and other modifiers mean something else. */
function isPlainSpace(event: KeyboardEvent): boolean {
  const modified = event.shiftKey || event.ctrlKey || event.metaKey || event.altKey;
  return event.key === " " && !modified;
}

function typesHere(target: Element): boolean {
  const field = target.closest(
    'input, textarea, select, [contenteditable=""], [contenteditable="true"]',
  );
  return field !== null || target.closest('[data-tab-panel="screen"]') !== null;
}

/** True where Space presses a control: it keeps doing that, except on a state or an arrow while the pointer is over the canvas, where Space pans and Enter presses. */
function takesSpace(root: HTMLElement, options: UnderOptions): boolean {
  const { target } = options;
  if (!(target instanceof Element) || !target.matches(SPACE_TAKERS)) return false;
  return target.closest(".graph") === null || !overCanvas(root);
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
