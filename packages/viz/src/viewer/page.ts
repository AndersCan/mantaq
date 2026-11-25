/**
 * Options for a page that keeps `?machine=&step=&run=&payload=&focus=` (and reads old `?value=` links) in the address bar so a walk and the machine opened can be shared (`linkOptions`).
 */
import type { FocusLink, ViewerOptions } from "./embed.ts";
import "./viewer.css";

interface Walk {
  machine: string;
  steps: string[];
  payloads: string[];
  focus: string[];
}

/** A move along the focus path adds a history entry, so Back goes back one level; a step or a payload change replaces the entry, so a walk does not flood the history. */
function rememberWalk(where: Walk): void {
  const now = new URLSearchParams(location.search);
  const moved = now.getAll("focus").join("\n") !== where.focus.join("\n");
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
  const query = next.toString();
  const address = `?${query}`;
  if (moved) history.pushState(undefined, "", address);
  else history.replaceState(undefined, "", address);
}

/** The path the address bar names now, for the viewer of `machine`. */
function linkedFocus(): FocusLink {
  const params = new URLSearchParams(location.search);
  const machine = params.get("machine");
  const focus = params.getAll("focus");
  return machine === null ? { focus } : { machine, focus };
}

/** Browser Back and Forward: the viewer moves along its path to the one the address names. */
function followFocus(follow: (link: FocusLink) => void): void {
  addEventListener("popstate", () => follow(linkedFocus()));
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
    followFocus,
  };
}
