import { fitRoom, shownArea } from "../keep-in-view.ts";
import type { Viewport } from "../viewport/viewport.ts";
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
  const canvas = root.querySelector<HTMLElement>(".canvas");
  if (canvas === null) return undefined;
  const viewport = viewportOf(canvas, {
    drawing: () => canvas.querySelector("svg.graph") ?? undefined,
    fitBox: () => fitRoom(root, { canvas }),
    shown: () => shownArea(root, { canvas }),
    initial: view.viewport,
  });
  viewport.subscribe(({ scale, tool, sizing }) => {
    view.viewport = { scale, tool, sizing };
  });
  const Observer = root.ownerDocument.defaultView?.ResizeObserver;
  if (Observer !== undefined) new Observer(() => viewport.redrawn()).observe(canvas);
  return viewport;
}
