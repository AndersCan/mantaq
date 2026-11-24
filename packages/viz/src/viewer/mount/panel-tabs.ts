import type { ExploreContext, ExploreParts } from "../explore.ts";
import type { PanelTab, ViewState } from "./view-state.ts";
import type { VizDriver, VizLiveState, VizMachine } from "../../schema.ts";
import { html } from "../dom.ts";
import { pathTo } from "../../findings.ts";
import type { Tab } from "../tabs.ts";
import { tabs } from "../tabs.ts";
import type { ViewerOptions } from "./viewer-options.ts";

type LiveContext = NonNullable<ExploreContext["live"]>;

export interface PanelTabsOptions {
  view: ViewState;
  parts: ExploreParts;
  details: HTMLElement;
  screen: Node | undefined;
  refresh: () => void;
}

/** The Step, Context and Details tabs; Context only live and with value fields. */
export function panelTabs(doc: Document, context: PanelTabsOptions): HTMLElement {
  const { view, parts } = context;
  const all: Array<Tab<PanelTab> | undefined> = [
    context.screen === undefined
      ? undefined
      : { id: "screen", label: "Screen", content: html(doc, "div", {}, [context.screen]) },
    parts.step === null ? undefined : { id: "step", label: "Step", content: parts.step },
    parts.context === null
      ? undefined
      : {
          id: "context",
          label: "Context",
          content: parts.context,
        },
    { id: "details", label: "Details", content: context.details },
  ];
  const shown = all.filter((tab): tab is Tab<PanelTab> => tab !== undefined);
  const active = shown.find((tab) => tab.id === view.tab)?.id ?? shown[0]?.id;
  return tabs(doc, {
    tabs: shown,
    active,
    onSelect: (id) => {
      view.tab = id;
      context.refresh();
    },
  });
}

/** The live driver's part of the panel context. */
export function liveOf(
  view: ViewState,
  handlers: Pick<LiveContext, "send" | "pick" | "setValue" | "routes">,
): { live?: LiveContext } {
  if (view.live === null) return {};
  return {
    live: {
      state: view.live,
      afters: view.afters,
      lasts: view.lasts,
      picked: view.picked,
      values: view.values,
      ...handlers,
    },
  };
}

function stepList(panel: HTMLElement): HTMLElement | null {
  return panel.querySelector<HTMLElement>('[data-tab-panel="step"]');
}

function newestStepTop(list: HTMLElement): number {
  const newest = [...list.querySelectorAll("[data-step]")].at(-1) ?? list;
  return Math.ceil(newest.getBoundingClientRect().top - list.getBoundingClientRect().top);
}

export interface ReplaceOptions {
  tabs: Node;
  /** How many steps the panel showed before. */
  shown: number;
  /** How many steps the walk has now. */
  steps: number;
}

/** Swaps the panel's content; when a step was added the newest step scrolls to the top of the Step tab, else its scroll stays. */
export function replaceKeepingSteps(panel: HTMLElement, options: ReplaceOptions): number {
  const { shown, steps } = options;
  const before = stepList(panel);
  const scrolled = before === null || before.hidden ? undefined : before.scrollTop;
  panel.replaceChildren(options.tabs);
  const list = stepList(panel);
  if (list !== null) {
    list.scrollTop = steps > shown || scrolled === undefined ? newestStepTop(list) : scrolled;
  }
  return steps;
}

export interface ScreenOptions {
  options: ViewerOptions;
  machine: VizMachine;
  view: ViewState;
  driver: VizDriver | undefined;
}

export function screenOf(doc: Document, at: ScreenOptions): Node | undefined {
  const { options, machine, view, driver } = at;
  const live = view.live;
  if (live === null || options.screen === undefined) return undefined;
  const picked = view.selection;
  const wanted =
    picked?.kind === "state" &&
    picked.id !== live.state &&
    machine.states.some((state) => state.id === picked.id && state.region === null)
      ? picked.id
      : undefined;
  if (wanted === undefined) return options.screen(live);
  const preview = previewOf(machine, { driver, id: wanted });
  const note = html(doc, "p", { class: "muted", "data-screen-of": wanted }, [
    preview === undefined
      ? `No known walk reaches ${wanted}; this is ${live.state}.`
      : `This is ${wanted}; the machine is still in ${live.state}.`,
  ]);
  return html(doc, "div", {}, [note, options.screen(preview ?? live)]);
}

interface PreviewOptions {
  driver: VizDriver | undefined;
  id: string;
}

function previewOf(machine: VizMachine, target: PreviewOptions): VizLiveState | undefined {
  const steps = pathTo(machine, target.id);
  if (steps === null) return undefined;
  return target.driver?.dryWalk?.(steps).find((entry) => entry.state === target.id);
}
