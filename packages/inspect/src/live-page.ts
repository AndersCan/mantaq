/**
 * The live page of the Vite plugin: the served document, with each machine
 * that has a target running for real behind the viewer. The walk lives in the
 * address bar (`?machine=&step=`), so a redraw after a save replays it on the
 * new code.
 */
import { mountViewer, showIssues } from "@mantaq/viz/viewer";
import { linkOptions } from "@mantaq/viz/page";
import { parseViz } from "@mantaq/viz";
import type { VizDocument } from "@mantaq/viz";
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
  const target = context.targets[id];
  // Same rule as static inspection: a driver needs a clock it can advance.
  const create =
    target !== undefined && typeof Reflect.get(target().clock, "advance") === "function"
      ? target
      : undefined;
  const picker = viz.machines.length > 1;
  const select = (machine: string) => {
    const next = new URLSearchParams(location.search);
    next.set("machine", machine);
    next.delete("step");
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
  mountDriven(root, { ...context, text: await response.text() });
}
