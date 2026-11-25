/**
 * Options for a page that keeps `?machine=&step=&run=&payload=&focus=` (and reads old `?value=` links) in the address bar so a walk and the machine opened can be shared (`linkOptions`).
 */
import type { ViewerOptions } from "./embed.ts";
import "./viewer.css";

interface Walk {
  machine: string;
  steps: string[];
  payloads: string[];
  focus: string[];
}

function rememberWalk(where: Walk): void {
  const next = new URLSearchParams(location.search);
  next.set("machine", where.machine);
  next.delete("step");
  next.delete("run");
  next.delete("value");
  next.delete("payload");
  next.delete("focus");
  for (const payload of where.payloads) next.append("payload", payload);
  for (const step of where.steps) next.append("step", step);
  for (const opened of where.focus) next.append("focus", opened);
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
    payloads: params.getAll("payload"),
    values: params.getAll("value"),
    focus: params.getAll("focus"),
    onNavigate: rememberWalk,
  };
}
