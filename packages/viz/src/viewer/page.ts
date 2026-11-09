/**
 * Whole-page entries: a self-contained HTML file (`mountEmbedded`) and a live
 * page served by a dev server (`mountLive`). Both keep `?machine=&step=` in
 * the address bar so a walk can be shared.
 */
import { mountVizText, showIssues } from "./embed.ts";
import type { ViewerOptions } from "./embed.ts";
import "./viewer.css";

import { DOCUMENT_ELEMENT_ID } from "../html.ts";

function rememberWalk(where: { machine: string; steps: string[]; run?: string }): void {
  const next = new URLSearchParams(location.search);
  next.set("machine", where.machine);
  next.delete("step");
  next.delete("run");
  if (where.run !== undefined) next.set("run", where.run);
  else for (const step of where.steps) next.append("step", step);
  history.replaceState(null, "", `?${next.toString()}`);
}

/** Options that open the walk named in the address bar and keep it there. */
export function linkOptions(): ViewerOptions {
  const params = new URLSearchParams(location.search);
  const machine = params.get("machine");
  const run = params.get("run");
  return {
    ...(machine === null ? {} : { machine }),
    ...(machine !== null && run !== null ? { run } : {}),
    steps: params.getAll("step"),
    onNavigate: rememberWalk,
  };
}

/** Mount the document embedded in the page itself. */
export function mountEmbedded(root: HTMLElement): void {
  const text = document.getElementById(DOCUMENT_ELEMENT_ID)?.textContent ?? "";
  mountVizText(root, { source: document.title, text }, linkOptions());
}

/** Fetch the document from `source` and mount it; call again to redraw, keeping the walk. */
export async function mountLive(root: HTMLElement, source: string): Promise<void> {
  const response = await fetch(source).catch(() => null);
  if (response === null || !response.ok) {
    const status = response === null ? "network error" : `HTTP ${response.status}`;
    showIssues(root, { source, issues: [{ path: "$", message: status }] });
    return;
  }
  mountVizText(root, { source, text: await response.text() }, linkOptions());
}
