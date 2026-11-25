import { html } from "../dom.ts";
import { toolbarOf } from "../canvas-navigation/toolbar.ts";
import type { ViewState } from "./view-state.ts";

interface FullscreenLabelOptions {
  active: boolean;
}

function setFullscreenLabel(button: HTMLButtonElement, options: FullscreenLabelOptions): void {
  button.textContent = options.active ? "Exit full screen" : "Full screen";
  button.setAttribute("aria-pressed", String(options.active));
}

/** Added once: the button label follows fullscreen across renders. */
export function listenFullscreen(root: HTMLElement): void {
  root.addEventListener("fullscreenchange", () => {
    const toggle = root.querySelector<HTMLButtonElement>(".fullscreen-toggle");
    if (toggle !== null) {
      setFullscreenLabel(toggle, { active: root.ownerDocument.fullscreenElement === root });
    }
  });
}

/** Undefined where the browser cannot fullscreen an element (no API, or blocked by the host page). */
function fullscreenButton(doc: Document, root: HTMLElement): HTMLButtonElement | undefined {
  if (!doc.fullscreenEnabled || typeof root.requestFullscreen !== "function") return undefined;
  const button = html(doc, "button", { type: "button", class: "fullscreen-toggle" });
  setFullscreenLabel(button, { active: doc.fullscreenElement === root });
  button.addEventListener("click", () => {
    const request =
      doc.fullscreenElement === root ? doc.exitFullscreen() : root.requestFullscreen();
    // A refused request leaves the viewer as it was.
    request.catch(() => undefined);
  });
  return button;
}

export interface FrameOptions {
  view: ViewState;
  showControls: () => void;
  graph: Node[];
  panel: HTMLElement;
  root: HTMLElement;
}

/** Everything the viewer draws under its root: the bar with the zoom and pan tools, then the controls and panel, or with Diagram only just the canvas. */
export function layoutOf(doc: Document, context: FrameOptions): HTMLElement[] {
  const { view } = context;
  const canvas = html(doc, "div", { class: "canvas" }, context.graph);
  const fullscreen = fullscreenButton(doc, context.root);
  const ends = fullscreen === undefined ? [] : [fullscreen];
  if (!view.diagramOnly) {
    return [
      html(doc, "div", { class: "viz-bar" }, [toolbarOf(doc), ...ends]),
      ...noticeOf(doc, view),
      html(doc, "div", { class: "viz-main" }, [canvas, context.panel]),
    ];
  }
  const show = html(doc, "button", { type: "button", class: "show-controls" }, ["Show controls"]);
  show.setAttribute("data-show-controls", "");
  show.addEventListener("click", () => context.showControls());
  return [
    html(doc, "div", { class: "viz-bar" }, [toolbarOf(doc), show, ...ends]),
    html(doc, "div", { class: "viz-main" }, [
      canvas,
      html(doc, "p", { class: "blocked-note", role: "status" }),
    ]),
  ];
}

function noticeOf(doc: Document, view: ViewState): HTMLElement[] {
  if (view.notice === undefined) return [];
  return [
    html(doc, "p", { class: "run-notice", role: "status", "data-run-missing": "" }, [view.notice]),
  ];
}
