import { decodePayloads, legacyPayloads } from "../send/payloads.ts";
import type { VizEvent, VizJson, VizLiveState, VizLiveStep } from "../../schema.ts";
import { decodeValues } from "../fill.ts";
import type { FocusStep } from "./focus.ts";
import type { HeldViewport } from "../viewport/viewport.ts";
import type { Payloads } from "../send/payloads.ts";
import type { Selection } from "../graph.ts";
import type { SentEvent } from "../explore.ts";
import type { ViewerOptions } from "./viewer-options.ts";

export type PanelTab = "screen" | "step" | "context" | "details";

export interface PickedChild {
  map: string;
  key: string;
}

export interface ViewState {
  selection: Selection | undefined;
  /** The path from the root, in order: a machine of a board, then a group entered (kept in `?focus=`). Replaced, never changed in place. */
  focus: FocusStep[];
  /** Set while a driver runs the actor. */
  live: VizLiveState | null;
  /** Entry i is what the driver reported moving after `live.steps[i]` (its `after`) when that step was taken. */
  afters: VizLiveStep[][];
  /** Entry i is the step's own entry (`live.last`) when `live.steps[i]` was taken. */
  lasts: Array<VizLiveStep | null>;
  /** Live: the followed child, set by a chip click; null = the lowest key. */
  picked: PickedChild | null;
  /** The panel tab shown. */
  tab: PanelTab;
  /** Only the diagram and a "Show controls" button are drawn. Starts from `ViewerOptions.diagramOnly`; not saved. */
  diagramOnly: boolean;
  /** The event the last Send press sent and to whom; cleared by any other step. */
  sent: SentEvent | undefined;
  /** Why the requested run did not open; cleared by the next walk. */
  notice: string | undefined;
  /** What the bar says about a `?focus=` path that names something not there; cleared by the next move along the path. */
  focusNotice: string | undefined;
  /** Live: edge id → why its guard blocks it now (see `blocked.ts`). */
  blocked: Map<string, string>;
  /** Live: edge id → the payload a click on that arrow sends, the one its dry run tried (see `blockedEdges`); none = the default. Its send form shows it. */
  chosen: Map<string, VizJson>;
  /** The payload fields changed in the send forms; every send and dry run of the event uses them (kept in `?payload=`). */
  payloads: Payloads;
  /** What `blocked` was computed for; it is recomputed when any of it changes. */
  blockedFor: { live: VizLiveState; picked: ViewState["picked"]; payloads: Payloads } | undefined;
  /** The canvas's scale and tool, kept across steps, moves along the path and redraws; not saved. Fitted until the reader zooms. */
  viewport: HeldViewport;
}

export interface InitialViewOptions {
  /** Every event of the document: an old `?value=` field applies to each event with that field. */
  events: ReadonlyArray<VizEvent>;
}

export function initialView(options: ViewerOptions, document: InitialViewOptions): ViewState {
  return {
    selection: undefined,
    focus: [],
    live: null,
    afters: [],
    lasts: [],
    picked: null,
    tab: options.screen !== undefined ? "screen" : "step",
    diagramOnly: options.diagramOnly ?? false,
    sent: undefined,
    notice: undefined,
    focusNotice: undefined,
    blocked: new Map(),
    chosen: new Map(),
    payloads: {
      ...legacyPayloads(decodeValues(options.values ?? []), document.events),
      ...decodePayloads(options.payloads ?? []),
    },
    blockedFor: undefined,
    viewport: { scale: 1, tool: "select", sizing: "fitted" },
  };
}

/** A pick of a child that is gone is dropped. */
export function dropGonePick(view: ViewState): void {
  const { picked } = view;
  const there = view.live?.children.some(
    (child) => child.map === picked?.map && child.key === picked.key,
  );
  if (picked !== null && there !== true) view.picked = null;
}

/** A walk clears both notices: why a run did not open, and what a link's path named that is not there. */
export function noticeCleared(root: HTMLElement, view: ViewState): void {
  view.notice = undefined;
  view.focusNotice = undefined;
  root.querySelector("[data-run-missing]")?.remove();
  root.querySelector(".viz-bar .focus-notice")?.remove();
}
