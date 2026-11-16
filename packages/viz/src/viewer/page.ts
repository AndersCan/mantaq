/**
 * Options for a page that keeps `?machine=&step=&run=&value=` in the address bar so a walk can be shared (`linkOptions`).
 */
import type { ViewerOptions } from "./embed.ts";
import "./viewer.css";

function rememberWalk(where: { machine: string; steps: string[]; values: string[] }): void {
  const next = new URLSearchParams(location.search);
  next.set("machine", where.machine);
  next.delete("step");
  next.delete("run");
  next.delete("value");
  for (const value of where.values) next.append("value", value);
  for (const step of where.steps) next.append("step", step);
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
    values: params.getAll("value"),
    onNavigate: rememberWalk,
  };
}
