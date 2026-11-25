/**
 * Options for a page that keeps `?machine=&step=&run=&payload=&focus=` (and reads old `?value=` links) in the address bar so a walk and the machine opened can be shared (`linkOptions`).
 */
import type { FocusFollower, FocusLink, NavigatedBy, ViewerOptions } from "./embed.ts";
import "./viewer.css";

interface Walk {
  by: NavigatedBy;
  machine: string;
  steps: string[];
  payloads: string[];
  focus: string[];
}

/** The reader's move along the focus path adds a history entry, so Back goes back one level; a step, a payload change or a move that follows Back replaces the entry, so a walk does not flood the history. */
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
  const query = next.toString();
  const address = `?${query}${location.hash}`;
  if (where.by === "path") history.pushState(undefined, "", address);
  else history.replaceState(undefined, "", address);
}

/** The path the address bar names now, for the viewer of `machine`. */
function linkedFocus(): FocusLink {
  const params = new URLSearchParams(location.search);
  const machine = params.get("machine");
  const focus = params.getAll("focus");
  return machine === null ? { focus } : { machine, focus };
}

/** The viewers that follow Back and Forward; one `popstate` listener serves them all while any is mounted. */
const followers = new Set<FocusFollower>();

function dropUnmounted(): void {
  for (const follower of followers) if (!follower.mounted()) followers.delete(follower);
  if (followers.size === 0) removeEventListener("popstate", followAddress);
}

function followAddress(): void {
  dropUnmounted();
  for (const follower of followers) follower.follow(linkedFocus());
}

/** Browser Back and Forward: the viewer moves along its path to the one the address names. A viewer gone, as on a page that mounts again after a save, is dropped. */
function followFocus(follower: FocusFollower): void {
  dropUnmounted();
  followers.add(follower);
  addEventListener("popstate", followAddress);
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
