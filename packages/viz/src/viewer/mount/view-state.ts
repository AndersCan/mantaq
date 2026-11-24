import type { VizJson, VizLiveState, VizLiveStep } from "../../schema.ts";
import { decodeValues } from "../fill.ts";
import type { Selection } from "../graph.ts";
import type { SentEvent } from "../explore.ts";
import type { Values } from "../fill.ts";
import type { ViewerOptions } from "./viewer-options.ts";

export type PanelTab = "screen" | "step" | "context" | "details";

export interface PickedChild {
  map: string;
  key: string;
}

export interface ViewState {
  selection: Selection | null;
  /** The machine of a big board shown on its own; null = the board of boxes. Not saved. */
  zoom: string | null;
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
  /** Live: edge id → why its guard blocks it now (see `blocked.ts`). */
  blocked: Map<string, string>;
  /** Live: edge id → the payload a click on that arrow sends (see `blockedEdges`); none = the default. */
  chosen: Map<string, VizJson>;
  /** Field name → the value set in the Context tab; events are sent with it (kept in `?value=`). */
  values: Values;
  /** What `blocked` was computed for; it is recomputed when any of it changes. */
  blockedFor: { live: VizLiveState; picked: ViewState["picked"]; values: Values } | undefined;
}

export function initialView(options: ViewerOptions): ViewState {
  return {
    selection: null,
    zoom: null,
    live: null,
    afters: [],
    lasts: [],
    picked: null,
    tab: options.screen !== undefined ? "screen" : "step",
    diagramOnly: options.diagramOnly ?? false,
    sent: undefined,
    notice: undefined,
    blocked: new Map(),
    chosen: new Map(),
    values: decodeValues(options.values ?? []),
    blockedFor: undefined,
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

export function noticeCleared(root: HTMLElement, view: ViewState): void {
  view.notice = undefined;
  root.querySelector("[data-run-missing]")?.remove();
}
