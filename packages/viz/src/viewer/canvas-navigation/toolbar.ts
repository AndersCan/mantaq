import { html, svg } from "../dom.ts";
import type { Viewport, ViewportState } from "../viewport/viewport.ts";
import { zoomInFrom, zoomOutFrom } from "../viewport/zoom.ts";
import { isNever } from "../../is-never.ts";

/** What a toolbar button does to the viewport. */
type ToolbarAction = "select" | "hand" | "zoomOut" | "zoomIn" | "fit";

interface ButtonText {
  action: ToolbarAction;
  label: string;
  /** The tooltip: the label and its key. */
  title: string;
  /** The tooltip while a click would change nothing: why the button is off. */
  offTitle?: string;
  shortcut: string;
}

const TOOLS: readonly ButtonText[] = [
  { action: "select", label: "Select", title: "Select (V)", shortcut: "V" },
  { action: "hand", label: "Move", title: "Move (H): drag to pan", shortcut: "H" },
];

const ZOOM_OUT: ButtonText = {
  action: "zoomOut",
  label: "Zoom out",
  title: "Zoom out (Ctrl or Cmd and -)",
  offTitle: "Zoom out: 10% is the smallest zoom",
  shortcut: "Control+- Meta+-",
};

const ZOOM_IN: ButtonText = {
  action: "zoomIn",
  label: "Zoom in",
  title: "Zoom in (Ctrl or Cmd and +)",
  offTitle: "Zoom in: 800% is the largest zoom",
  shortcut: "Control+= Meta+=",
};

const FIT: ButtonText = {
  action: "fit",
  label: "Zoom to fit",
  title: "Zoom to fit (Shift+1)",
  offTitle: "Zoom to fit (Shift+1): the whole diagram fits already",
  shortcut: "Shift+1",
};

/** The icon paths on a 16 by 16 grid: a pointer arrow for Select, an open hand for Move. */
const ICONS: Record<"select" | "hand", string> = {
  select: "M3.5 2v11l3-2.75L8.75 14.5l1.75-.9-2.2-4.1h4.2z",
  hand: "M5.5 8.5V4a1 1 0 0 1 2 0v3.5M7.5 7V3a1 1 0 0 1 2 0v4M9.5 7V4a1 1 0 0 1 2 0v3.5M11.5 7.5V6a1 1 0 0 1 2 0v3.5c0 2.75-2 5-4.75 5-2 0-3.25-1-4.25-2.75L3 9.25a1 1 0 0 1 1.75-1l.75 1.25",
};

/** The zoom and pan controls for the bar above the canvas; they act once `bindToolbar` gives them the viewport. */
export function toolbarOf(doc: Document): HTMLElement {
  const tools: HTMLElement[] = [];
  for (const tool of TOOLS) tools.push(buttonOf(doc, { text: tool, content: [iconOf(doc, tool)] }));
  const percent = html(doc, "span", { class: "zoom-percent", title: "Zoom" }, ["100%"]);
  return html(doc, "div", { class: "viz-tools", role: "group", "aria-label": "Zoom and pan" }, [
    html(doc, "div", { class: "viz-tool-group" }, tools),
    html(doc, "div", { class: "viz-tool-group" }, [
      buttonOf(doc, { text: ZOOM_OUT, content: ["−"] }),
      percent,
      buttonOf(doc, { text: ZOOM_IN, content: ["+"] }),
      buttonOf(doc, { text: FIT, content: ["Fit"] }),
    ]),
  ]);
}

interface ButtonOptions {
  text: ButtonText;
  content: ReadonlyArray<Node | string>;
}

function buttonOf(doc: Document, options: ButtonOptions): HTMLButtonElement {
  const { text } = options;
  const button = html(
    doc,
    "button",
    {
      type: "button",
      class: "viz-tool",
      "data-viz-tool": text.action,
      "aria-label": text.label,
      "aria-keyshortcuts": text.shortcut,
      title: text.title,
    },
    options.content,
  );
  return button;
}

function iconOf(doc: Document, tool: ButtonText): SVGSVGElement {
  const icon = tool.action === "hand" ? ICONS.hand : ICONS.select;
  const filled = tool.action === "select";
  return svg(doc, "svg", { viewBox: "0 0 16 16", "aria-hidden": "true", class: "viz-tool-icon" }, [
    svg(doc, "path", {
      d: icon,
      fill: filled ? "currentColor" : "none",
      stroke: "currentColor",
      "stroke-width": filled ? 1 : 1.25,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
  ]);
}

export interface BindToolbarOptions {
  viewport: Viewport;
}

/** Makes the toolbar's buttons act on the viewport and show its state after each change. Returns the call that shows it again, for a change the viewport does not report: a new drawing or a new size changes what Fit would do. */
export function bindToolbar(toolbar: HTMLElement, options: BindToolbarOptions): () => void {
  const { viewport } = options;
  for (const button of toolbar.querySelectorAll<HTMLButtonElement>("[data-viz-tool]")) {
    const action = actionOf(button);
    if (action === undefined) continue;
    button.addEventListener("click", () => {
      if (button.getAttribute("aria-disabled") !== "true") act(viewport, { action });
    });
  }
  function shown(): void {
    showState(toolbar, { state: viewport.state(), fitScale: viewport.fitScale() });
  }
  viewport.subscribe(shown);
  shown();
  return shown;
}

function textOf(button: HTMLElement): ButtonText | undefined {
  const named = button.dataset["vizTool"];
  for (const each of [...TOOLS, ZOOM_OUT, ZOOM_IN, FIT]) {
    if (each.action === named) return each;
  }
  return undefined;
}

function actionOf(button: HTMLElement): ToolbarAction | undefined {
  return textOf(button)?.action;
}

interface ActOptions {
  action: ToolbarAction;
}

function act(viewport: Viewport, options: ActOptions): void {
  const { action } = options;
  switch (action) {
    case "select":
      viewport.setTool("select");
      return;
    case "hand":
      viewport.setTool("hand");
      return;
    case "zoomOut":
      viewport.zoomOut();
      return;
    case "zoomIn":
      viewport.zoomIn();
      return;
    case "fit":
      viewport.fit();
      return;
    default:
      isNever(action);
  }
}

interface ShowStateOptions {
  state: Readonly<ViewportState>;
  fitScale: number | undefined;
}

/** The pressed tool, the percent, and the zoom buttons that would change nothing turned off. */
function showState(toolbar: HTMLElement, options: ShowStateOptions): void {
  const { state, fitScale } = options;
  const percent = percentOf(state.scale);
  const fitted = fitScale === undefined || percentOf(fitScale) === percent;
  const percentText = toolbar.querySelector(".zoom-percent");
  if (percentText !== null && percentText.textContent !== percent) {
    percentText.textContent = percent;
  }
  for (const button of toolbar.querySelectorAll<HTMLButtonElement>("[data-viz-tool]")) {
    const action = actionOf(button);
    if (action === undefined) continue;
    switch (action) {
      case "select":
      case "hand":
        pressed(button, { on: state.tool === action });
        break;
      case "zoomOut":
        turnedOff(button, { off: zoomOutFrom(state.scale) === state.scale });
        break;
      case "zoomIn":
        turnedOff(button, { off: zoomInFrom(state.scale) === state.scale });
        break;
      case "fit":
        turnedOff(button, { off: fitted });
        break;
      default:
        isNever(action);
    }
  }
}

function percentOf(scale: number): string {
  const rounded = Math.round(scale * 100);
  return `${rounded}%`;
}

interface TurnedOffOptions {
  off: boolean;
}

/** A button whose click would change nothing looks off and ignores clicks, and its tooltip says why. It stays focusable, so focus and the viewer's keys stay where the reader was. */
function turnedOff(button: HTMLButtonElement, options: TurnedOffOptions): void {
  const text = textOf(button);
  const title = options.off ? text?.offTitle : text?.title;
  if (title !== undefined) button.title = title;
  if (options.off) button.setAttribute("aria-disabled", "true");
  else button.removeAttribute("aria-disabled");
}

interface PressedOptions {
  on: boolean;
}

/** The tool in use is the current choice: a click on it would change nothing, so it shows no pointer and leaves the tab order, but keeps focus while it has it. */
function pressed(button: HTMLButtonElement, options: PressedOptions): void {
  button.setAttribute("aria-pressed", String(options.on));
  if (!options.on) {
    button.removeAttribute("aria-current");
    button.removeAttribute("tabindex");
    return;
  }
  button.setAttribute("aria-current", "true");
  button.setAttribute("tabindex", "-1");
}
