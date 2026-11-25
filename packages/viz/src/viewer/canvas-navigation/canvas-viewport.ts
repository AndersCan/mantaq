import { fitRoom, shownArea } from "../keep-in-view.ts";
import type { Viewport, ViewportState } from "../viewport/viewport.ts";
import { viewportOf } from "../viewport/viewport.ts";
import type { ViewState } from "../mount/view-state.ts";

export interface CanvasViewportOptions {
  view: ViewState;
}

/** Mounts a viewport on the viewer's canvas with the scale and tool the reader chose before, and hands each change back to the view; undefined without a canvas. */
export function viewportOnCanvas(
  root: HTMLElement,
  options: CanvasViewportOptions,
): Viewport | undefined {
  const { view } = options;
  const found = root.querySelector<HTMLElement>(".canvas");
  if (found === null) return undefined;
  const canvas: HTMLElement = found;
  const viewport = viewportOf(canvas, {
    drawing: () => canvas.querySelector("svg.graph") ?? undefined,
    fitBox: () => fitRoom(root, { canvas }),
    shown: () => shownArea(root, { canvas }),
    initial: view.viewport,
  });
  viewport.subscribe(({ scale, tool, sizing }) => {
    view.viewport = { scale, tool, sizing };
  });
  function resized(): void {
    viewport.redrawn();
    floored(canvas, { view, sizing: viewport.state().sizing });
  }
  resized();
  const Observer = root.ownerDocument.defaultView?.ResizeObserver;
  if (Observer !== undefined) new Observer(resized).observe(canvas);
  return viewport;
}

interface FlooredOptions {
  view: ViewState;
  sizing: ViewportState["sizing"];
}

/** Keeps the canvas at least as tall as it was at the fitted width, where its height follows the drawing; a capped canvas has no floor. */
function floored(canvas: HTMLElement, options: FlooredOptions): void {
  const { view } = options;
  const capped = canvas.ownerDocument.defaultView?.getComputedStyle(canvas).maxHeight !== "none";
  if (capped) {
    canvas.style.removeProperty("--viz-canvas-floor");
    return;
  }
  if (options.sizing === "fitted") view.canvasFloor = canvas.offsetHeight;
  if (view.canvasFloor !== undefined) {
    canvas.style.setProperty("--viz-canvas-floor", `${view.canvasFloor}px`);
  }
}
