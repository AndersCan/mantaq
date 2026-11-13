/**
 * The live page of the Vite plugin: the served document, with each machine
 * that has a target running for real behind the viewer. The walk lives in the
 * address bar (`?machine=&step=`), so a redraw after a save replays it on the
 * new code.
 */
import { mountViewer, showIssues } from "@mantaq/viz/viewer";
import type { ViewerOptions } from "@mantaq/viz/viewer";
import { linkOptions } from "@mantaq/viz/page";
import { outlineOf, parseViz } from "@mantaq/viz";
import type {
  MachineOutline,
  VizDocument,
  VizDriver,
  VizMachine,
  VizOutputRoutes,
} from "@mantaq/viz";
import { Either } from "@mantaq/utils";
import { createDriver } from "./drive.ts";
import type { FuzzTarget } from "./fuzz/run.ts";
import { listenForNotes } from "./note-composer.ts";
import type { NoteAction } from "./note-composer.ts";

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
function ownWalk(viz: VizDocument): ReturnType<typeof linkOptions> {
  const linked = linkOptions();
  const named = [...new Set(new URLSearchParams(location.search).getAll("machine"))];
  if (named.length < 2) {
    const own =
      linked.machine === undefined || viz.machines.some((each) => each.id === linked.machine);
    return own ? linked : { onNavigate: linked.onNavigate };
  }
  const held = named.find((id) => viz.machines.some((each) => each.id === id));
  return held === undefined ? { onNavigate: linked.onNavigate } : { ...linked, machine: held };
}

/** The target for `id` when it runs on a clock the page can advance. */
function liveCreate(targets: LiveTargets, id: string): FuzzTarget["create"] | undefined {
  const target = targets[id];
  // Same rule as static inspection: a driver needs a clock it can advance.
  return target !== undefined && typeof Reflect.get(target().clock, "advance") === "function"
    ? target
    : undefined;
}

export type SeenStorage = Pick<Storage, "getItem" | "setItem">;

function isMachineOutline(value: unknown): value is MachineOutline {
  if (typeof value !== "object" || value === null) return false;
  const { states, arrows } = value as Record<string, unknown>;
  return (
    Array.isArray(states) &&
    states.every((each) => typeof each === "string") &&
    Array.isArray(arrows) &&
    arrows.every((each) => {
      if (typeof each !== "object" || each === null) return false;
      const arrow = each as Record<string, unknown>;
      return (
        typeof arrow["from"] === "string" &&
        typeof arrow["event"] === "string" &&
        (arrow["to"] === null || typeof arrow["to"] === "string") &&
        (arrow["kind"] === "transition" || arrow["kind"] === "stay")
      );
    })
  );
}

/** The storage `get` returns, or undefined when the browser blocks reading it. */
export function readStorage(get: () => SeenStorage): SeenStorage | undefined {
  const found = Either.from(get);
  return Either.isRight(found) ? found[1] : undefined;
}

const seenKey = (source: string, machine: string) => `mantaq:seen:v1:${source}:${machine}`;

/** The outline stored for `machine`, or undefined when missing, unreadable or malformed. */
function storedOutline(
  seen: SeenStorage,
  source: string,
  machine: string,
): MachineOutline | undefined {
  const read = Either.from(() => seen.getItem(seenKey(source, machine)));
  if (Either.isLeft(read) || read[1] === null) return undefined;
  const raw = read[1];
  const parsed = Either.from((): unknown => JSON.parse(raw));
  return Either.isRight(parsed) && isMachineOutline(parsed[1]) ? parsed[1] : undefined;
}

function storeOutline(seen: SeenStorage, source: string, machine: VizMachine): void {
  Either.from(() => seen.setItem(seenKey(source, machine.id), JSON.stringify(outlineOf(machine))));
}

/** Records first sightings and returns the viewer's `changes` option; empty without storage. */
function changesOption(
  context: { source: string; seen?: SeenStorage; text: string },
  machine: VizMachine | undefined,
  all: VizMachine[],
): { changes?: NonNullable<ViewerOptions["changes"]> } {
  const { seen, source } = context;
  if (seen === undefined || machine === undefined) return {};
  for (const each of all) {
    if (storedOutline(seen, source, each.id) === undefined) storeOutline(seen, source, each);
  }
  const before = storedOutline(seen, source, machine.id);
  if (before === undefined) return {};
  return {
    changes: { machine: machine.id, before, onSeen: () => storeOutline(seen, source, machine) },
  };
}

function routesOf(context: { routes?: VizOutputRoutes }): { routes?: VizOutputRoutes } {
  return context.routes === undefined ? {} : { routes: context.routes };
}

/** Where notes go: the dev server when it has a url, else a copied block; undefined = none. */
function notesOf(context: { notes?: string; copyNotes?: { file: string } }): {
  action?: NoteAction;
} {
  if (context.notes !== undefined) return { action: { kind: "save", url: context.notes } };
  if (context.copyNotes !== undefined)
    return { action: { kind: "copy", file: context.copyNotes.file } };
  return {};
}

function mountNotes(
  viewer: HTMLElement,
  context: { machine: VizMachine; action?: NoteAction },
): void {
  if (context.action !== undefined) {
    listenForNotes(viewer, { machine: context.machine, action: context.action });
  }
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
      "display:block;width:min(100%,360px);height:640px;border:0;pointer-events:none";
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

/** Mount the document at `text`; machines with a target run live, the rest stay static walks. */
export function mountDriven(
  root: HTMLElement,
  context: {
    source: string;
    text: string;
    targets: LiveTargets;
    heading?: "h1" | "h2" | "h3";
    /** URL of the dev server's notes endpoint; unset = no notes. Right-clicking a state or arrow saves a note there. */
    notes?: string;
    /** Page without a dev server: right-clicking a state or arrow copies one note for the agent. `file` names the machine file in the block. `notes` wins when both are set. */
    copyNotes?: { file: string };
    /** Dev server frame page and the machine ids that have a preview file; the viewer gets a Screen tab for those. */
    preview?: { path: string; machines: ReadonlyArray<string> };
    /** Where the dev page keeps each machine's outline for "what changed"; unset = no marks. */
    seen?: SeenStorage;
    /** Where each machine's outputs go, shown on live steps. */
    routes?: VizOutputRoutes;
    /** "real": effects run, timers wait for the time buttons. Default "held": the viewer asks what each effect reports. */
    effectMode?: "held" | "real";
    /** Open with only the diagram and a "Show controls" button. */
    diagramOnly?: boolean;
  },
): void {
  const parsed = parseViz(context.text);
  if (Either.isLeft(parsed)) {
    showIssues(root, { source: context.source, issues: parsed[0] });
    return;
  }
  const viz = parsed[1];
  const options = ownWalk(viz);
  const shown = only(viz, options.machine ?? null);
  const id = shown.machines[0]?.id ?? "";
  const create = liveCreate(context.targets, id);
  const picker = viz.machines.length > 1;
  const select = (machine: string) => {
    const next = new URLSearchParams(location.search);
    next.set("machine", machine);
    next.delete("step");
    next.delete("run");
    history.replaceState(null, "", `?${next.toString()}`);
    mountDriven(root, context);
  };
  const doc = root.ownerDocument;
  const bar = doc.createElement("nav");
  bar.className = "machines";
  if (picker) {
    for (const machine of viz.machines) {
      const button = doc.createElement("button");
      button.type = "button";
      button.textContent = machine.id;
      button.disabled = machine.id === id;
      button.addEventListener("click", () => select(machine.id));
      bar.append(button);
    }
  }
  const viewer = doc.createElement("div");
  root.replaceChildren(...(picker ? [bar] : []), viewer);
  const machine = shown.machines[0];
  const changes = changesOption(context, machine, viz.machines);
  const driver = liveDriver(id, create, context.effectMode);
  mountViewer(viewer, shown, {
    ...options,
    ...changes,
    ...(context.heading === undefined ? {} : { heading: context.heading }),
    ...routesOf(context),
    ...(driver === undefined ? {} : { driver }),
    ...screenOption({ doc, preview: context.preview, id }),
    ...(context.diagramOnly === true ? { diagramOnly: true } : {}),
  });
  if (machine !== undefined) mountNotes(viewer, { machine, ...notesOf(context) });
}

/** `?machine=<a>&compare=<b>` names two designs; undefined unless both are set and differ. */
function comparedIds(params: URLSearchParams): { a: string; b: string } | undefined {
  const a = params.get("machine") ?? "";
  const b = params.get("compare") ?? "";
  return a === "" || b === "" || a === b ? undefined : { a, b };
}

/** Design B's walk lives in `stepB`, beside A's `step`, so a redraw replays both. */
function rememberDesignB(where: { steps: string[] }): void {
  const next = new URLSearchParams(location.search);
  next.delete("stepB");
  for (const step of where.steps) next.append("stepB", step);
  history.replaceState(null, "", `?${next.toString()}`);
}

function notice(doc: Document, text: string): HTMLElement {
  const note = doc.createElement("p");
  note.className = "compare-missing";
  note.setAttribute("role", "status");
  note.textContent = text;
  return note;
}

/** The two designs side by side; each column is its own viewer, driver and walk. */
function mountCompare(
  root: HTMLElement,
  context: { viz: VizDocument; targets: LiveTargets; ids: { a: string; b: string } },
): void {
  const doc = root.ownerDocument;
  const params = new URLSearchParams(location.search);
  const { machine: _machine, ...walkA } = linkOptions();
  const columns = [
    { key: "a", title: "Design A", id: context.ids.a, options: walkA },
    {
      key: "b",
      title: "Design B",
      id: context.ids.b,
      options: { steps: params.getAll("stepB"), onNavigate: rememberDesignB },
    },
  ] as const;
  const title = doc.createElement("h1");
  title.textContent = "Compare designs";
  const found = (id: string) => context.viz.machines.find((each) => each.id === id);
  if (found(context.ids.a) === undefined && found(context.ids.b) === undefined) {
    root.replaceChildren(
      title,
      notice(doc, "Neither draft is on this page. Ask your agent to check the dev server output."),
    );
    return;
  }
  const grid = doc.createElement("div");
  grid.style.cssText =
    "display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,480px),1fr));gap:24px";
  root.replaceChildren(title, grid);
  for (const column of columns) {
    const section = doc.createElement("section");
    section.className = "compare-design";
    section.dataset["design"] = column.key;
    section.style.minWidth = "0";
    const heading = doc.createElement("h2");
    heading.textContent = column.title;
    section.append(heading);
    grid.append(section);
    const machine = found(column.id);
    if (machine === undefined) {
      section.append(
        notice(
          doc,
          `${column.title}: ${column.id} is not on this page. Ask your agent to check the dev server output.`,
        ),
      );
      continue;
    }
    const viewer = doc.createElement("div");
    section.append(viewer);
    const create = liveCreate(context.targets, column.id);
    const driver: VizDriver | undefined =
      create === undefined ? undefined : createDriver({ id: column.id, create });
    mountViewer(
      viewer,
      { ...context.viz, machines: [machine] },
      { ...column.options, heading: "h3", ...(driver === undefined ? {} : { driver }) },
    );
  }
}

/** Fetch the document from `source` and mount it; call again to redraw, keeping the walk. */
export async function mountLiveDriven(
  root: HTMLElement,
  context: {
    source: string;
    targets: LiveTargets;
    notes?: string;
    seen?: SeenStorage;
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
  const ids = comparedIds(new URLSearchParams(location.search));
  if (ids === undefined) {
    mountDriven(root, { ...context, text });
    return;
  }
  const parsed = parseViz(text);
  if (Either.isLeft(parsed)) {
    showIssues(root, { source: context.source, issues: parsed[0] });
    return;
  }
  mountCompare(root, { viz: parsed[1], targets: context.targets, ids });
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
