/**
 * The live page of the Vite plugin: the served document, with each machine
 * that has a target running for real behind the viewer. It opens the walk the
 * link names (`?machine=&step=&focus=`) and keeps the walk since then in memory, so a
 * redraw after a save replays it on the new code and a reload starts again.
 */
import { mountViewer, showIssues } from "@mantaq/viz/viewer";
import type { VizDocument, VizDriver, VizOutputRoutes } from "@mantaq/viz";
import { createDriver } from "./drive.ts";
import { Either } from "@mantaq/utils";
import type { FuzzTarget } from "./fuzz/run.ts";
import { linkOptions } from "@mantaq/viz/page";
import { parseViz } from "@mantaq/viz";
import type { ViewerOptions } from "@mantaq/viz/viewer";

type WalkOptions = ReturnType<typeof linkOptions>;

/** Where the reader took each root's viewer since the page loaded: the machine, the walk and the path. */
interface Walked {
  machine: string;
  steps: string[];
  payloads: string[];
  focus: string[];
}

const walked = new WeakMap<HTMLElement, Walked>();

export type LiveTargets = Readonly<Record<string, FuzzTarget["create"]>>;

/** A document holding only `machine`, so the viewer shows the machine its driver runs. */
function only(viz: VizDocument, machine: string | null): VizDocument {
  const chosen = viz.machines.find((each) => each.id === machine) ?? viz.machines[0];
  return { ...viz, machines: chosen === undefined ? [] : [chosen] };
}

/**
 * The walk in the address bar, only when it names a machine of this document.
 * A link naming several machines opens the first one this document holds.
 */
function linkedWalk(viz: VizDocument): WalkOptions {
  const linked = linkOptions();
  const named = [...new Set(new URLSearchParams(location.search).getAll("machine"))];
  if (named.length < 2) {
    const own =
      linked.machine === undefined || viz.machines.some((each) => each.id === linked.machine);
    return own ? linked : {};
  }
  const held = named.find((id) => viz.machines.some((each) => each.id === id));
  return held === undefined ? {} : { ...linked, machine: held };
}

/** The walk the reader took on `root` when its machine is still in the document, else the link's. */
function ownWalk(root: HTMLElement, viz: VizDocument): WalkOptions {
  const last = walked.get(root);
  if (last === undefined || !viz.machines.some((each) => each.id === last.machine)) {
    return linkedWalk(viz);
  }
  return { ...last };
}

/** The run the page names, unless the walk it opens already holds a run or steps. */
function pageRun(run: string | undefined, walk: WalkOptions): { run?: string } {
  const walked = walk.run !== undefined || (walk.steps ?? []).length > 0;
  return run === undefined || walked ? {} : { run };
}

/** The target for `id` when the page can run it: its actor runs on the clock the page hands in (or on none that needs moving). */
function liveCreate(targets: LiveTargets, id: string): FuzzTarget["create"] | undefined {
  const target = targets[id];
  if (target === undefined) return undefined;
  const made = target();
  // An actor on a virtual clock other than the one handed in: its timers are out of the page's reach.
  const elsewhere =
    made.actor.clock !== undefined &&
    typeof Reflect.get(made.actor.clock, "advance") === "function" &&
    made.actor.clock !== made.clock;
  return elsewhere ? undefined : target;
}

function routesOf(context: { routes?: VizOutputRoutes }): { routes?: VizOutputRoutes } {
  return context.routes === undefined ? {} : { routes: context.routes };
}

/** The viewer's `screen` callback: a phone-width frame of the app's own preview page for the live state. */
function screenFrame(
  doc: Document,
  context: { path: string; id: string },
): NonNullable<ViewerOptions["screen"]> {
  return (live) => {
    const frame = doc.createElement("iframe");
    const state = JSON.stringify({
      name: live.state,

      payload: live.payload,
      context: live.context,
    });
    frame.src = `${context.path}?machine=${encodeURIComponent(context.id)}&state=${encodeURIComponent(state)}`;
    frame.title = `Screen of ${context.id}: ${live.state}`;
    frame.tabIndex = -1;
    frame.style.cssText =
      "display:block;width:min(100%,360px);height:min(640px,calc(60vh - 56px));border:0;pointer-events:none";
    return frame;
  };
}

/** What a hot-updated `virtual:mantaq/targets` module hands the page: its targets and previewed machines. */
export function takeTargets(module: Record<string, unknown>): {
  targets: LiveTargets;
  previewed: ReadonlyArray<string>;
} {
  return {
    targets: module["targets"] as LiveTargets,
    previewed: module["previewed"] as ReadonlyArray<string>,
  };
}

/** `{ screen }` for a live machine that has a preview file, else nothing. */
function screenOption(context: {
  doc: Document;
  preview: { path: string; machines: ReadonlyArray<string> } | undefined;
  id: string;
}): Pick<ViewerOptions, "screen"> {
  const { doc, preview, id } = context;
  return preview?.machines.includes(id) === true
    ? { screen: screenFrame(doc, { path: preview.path, id }) }
    : {};
}

interface PickerOptions {
  listed: VizDocument["machines"];
  /** The machine shown; its button is disabled. */
  id: string;
  select: (machine: string) => void;
}

/** One button per machine; none when the document holds one machine or none. */
function pickerOf(doc: Document, options: PickerOptions): HTMLElement[] {
  const { listed, id } = options;
  if (listed.length <= 1) return [];
  const bar = doc.createElement("nav");
  bar.className = "machines";
  bar.setAttribute("aria-label", "Machines");
  for (const machine of listed) {
    const button = doc.createElement("button");
    button.type = "button";
    button.textContent = machine.id;
    button.disabled = machine.id === id;
    button.addEventListener("click", () => options.select(machine.id));
    bar.append(button);
  }
  return [bar];
}

/** Mount the document at `text`; machines with a target run live, the rest show the diagram and Details only. */
export function mountDriven(
  root: HTMLElement,
  context: {
    source: string;
    text: string;
    targets: LiveTargets;
    /** Dev server frame page and the machine ids that have a preview file; the viewer gets a Screen tab for those. */
    preview?: { path: string; machines: ReadonlyArray<string> };
    /** Where each machine's outputs go, shown on live steps. */
    routes?: VizOutputRoutes;
    /** "real": effects run, timers wait for the time buttons. Default "held": the viewer asks what each effect reports. */
    effectMode?: "held" | "real";
    /** Open with only the diagram and a "Show controls" button. */
    diagramOnly?: boolean;
    /** The recorded run this viewer opens on when the address names none. */
    run?: string;
  },
): void {
  const parsed = parseViz(context.text);
  if (Either.isLeft(parsed)) {
    showIssues(root, { source: context.source, issues: parsed[0] });
    return;
  }
  const viz = parsed[1];
  const options = ownWalk(root, viz);
  const shown = only(viz, options.machine ?? null);
  const id = shown.machines[0]?.id ?? "";
  const create = liveCreate(context.targets, id);
  function select(machine: string): void {
    walked.set(root, { machine, steps: [], payloads: [], focus: [] });
    mountDriven(root, context);
  }
  const doc = root.ownerDocument;
  const viewer = doc.createElement("div");
  root.replaceChildren(...pickerOf(doc, { listed: viz.machines, id, select }), viewer);
  const driver = liveDriver(id, create, context.effectMode);
  mountViewer(viewer, shown, {
    ...options,
    onNavigate: ({ machine, steps, payloads, focus }) => {
      walked.set(root, { machine, steps, payloads, focus });
    },
    ...(id === "" ? {} : { machine: id }),
    ...routesOf(context),
    ...(driver === undefined ? {} : { driver }),
    ...screenOption({ doc, preview: context.preview, id }),
    ...(context.diagramOnly === true ? { diagramOnly: true } : {}),
    ...(id === viz.machines[0]?.id ? pageRun(context.run, options) : {}),
  });
}

/** Fetch the document from `source` and mount it; call again to redraw, keeping the walk the reader took. */
export async function mountLiveDriven(
  root: HTMLElement,
  context: {
    source: string;
    targets: LiveTargets;
    preview?: { path: string; machines: ReadonlyArray<string> };
  },
): Promise<void> {
  const response = await fetch(context.source).catch(() => null);
  if (response === null || !response.ok) {
    const status = response === null ? "network error" : `HTTP ${response.status}`;
    showIssues(root, {
      source: context.source,
      issues: [{ path: "$", message: status }],
    });
    return;
  }
  const text = await response.text();
  mountDriven(root, { ...context, text });
}

function liveDriver(
  id: string,
  create: FuzzTarget["create"] | undefined,
  effectMode: "held" | "real" | undefined,
): VizDriver | undefined {
  return create === undefined
    ? undefined
    : createDriver({ id, create }, { effectMode: effectMode ?? "held" });
}
