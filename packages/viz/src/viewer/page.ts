/**
 * Options for a page that keeps `?machine=&step=&run=&payload=` (and reads old `?value=` links) in the address bar so a walk can be shared (`linkOptions`).
 */
import type { ViewerOptions } from "./embed.ts";
import "./viewer.css";

interface Walk {
  machine: string;
  steps: string[];
  payloads: string[];
}

function rememberWalk(where: Walk): void {
  const next = new URLSearchParams(location.search);
  next.set("machine", where.machine);
  next.delete("step");
  next.delete("run");
  next.delete("value");
  next.delete("payload");
  for (const payload of where.payloads) next.append("payload", payload);
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
    payloads: params.getAll("payload"),
    values: params.getAll("value"),
    onNavigate: rememberWalk,
  };
}
