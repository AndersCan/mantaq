/**
 * The live page of the Vite plugin: the served document, with each machine
 * that has a target running for real behind the viewer. The walk lives in the
 * address bar (`?machine=&step=`), so a redraw after a save replays it on the
 * new code.
 */
import { mountViewer, showIssues } from "@mantaq/viz/viewer";
import { linkOptions } from "@mantaq/viz/page";
import { parseViz } from "@mantaq/viz";
import type { VizDocument, VizDriver } from "@mantaq/viz";
import { Either } from "@mantaq/utils";
import { createDriver } from "./drive.ts";
import type { FuzzTarget } from "./fuzz/run.ts";

export type LiveTargets = Readonly<Record<string, FuzzTarget["create"]>>;

/** A document holding only `machine`, so the viewer shows the machine its driver runs. */
function only(viz: VizDocument, machine: string | null): VizDocument {
  const chosen = viz.machines.find((each) => each.id === machine) ?? viz.machines[0];
  return { ...viz, machines: chosen === undefined ? [] : [chosen] };
}

/** The walk in the address bar, only when it names a machine of this document. */
function ownWalk(viz: VizDocument): ReturnType<typeof linkOptions> {
  const linked = linkOptions();
  const own =
    linked.machine === undefined || viz.machines.some((each) => each.id === linked.machine);
  return own ? linked : { onNavigate: linked.onNavigate };
}

/** The target for `id` when it runs on a clock the page can advance. */
function liveCreate(targets: LiveTargets, id: string): FuzzTarget["create"] | undefined {
  const target = targets[id];
  // Same rule as static inspection: a driver needs a clock it can advance.
  return target !== undefined && typeof Reflect.get(target().clock, "advance") === "function"
    ? target
    : undefined;
}

/** Mount the document at `text`; machines with a target run live, the rest stay static walks. */
export function mountDriven(
  root: HTMLElement,
  context: {
    source: string;
    text: string;
    targets: LiveTargets;
    heading?: "h1" | "h2" | "h3";
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
  mountViewer(viewer, shown, {
    ...options,
    ...(context.heading === undefined ? {} : { heading: context.heading }),
    ...(create === undefined ? {} : { driver: createDriver({ id, create }) }),
  });
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
  context: { source: string; targets: LiveTargets },
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
