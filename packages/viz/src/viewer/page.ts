/**
 * Options for a page that keeps `?machine=&step=&run=` in the address bar so a walk can be shared (`linkOptions`).
 */
import type { ViewerOptions } from "./embed.ts";
import "./viewer.css";

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
