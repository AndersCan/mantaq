import { scopeOf } from "../schema.ts";
import type { VizActorRef, VizLiveChild, VizLiveState, VizMachine } from "../schema.ts";

/** Sorted unique events of the handlers that live in one compartment ("" = the machine itself, else a region path). */
function eventsOf(machine: VizMachine, compartment: string): string[] {
  const events = machine.edges
    .filter(
      (edge) =>
        (edge.kind === "transition" || edge.kind === "stay") && scopeOf(edge.from) === compartment,
    )
    .map((edge) => edge.event);
  return [...new Set(events)].sort();
}

/**
 * The events to offer as buttons for a compartment: what it handles, plus the
 * inputs nothing else handles (so a declared input with no handler still shows).
 */
export function offeredEvents(
  machine: VizMachine,
  compartment: string,
  handled: ReadonlyArray<string>,
): string[] {
  const elsewhere = new Set(
    [...new Set(machine.edges.map((edge) => scopeOf(edge.from)))]
      .filter((scope) => scope !== compartment)
      .flatMap((scope) => eventsOf(machine, scope)),
  );
  const own = new Set(eventsOf(machine, compartment));
  const inputs = machine.events
    .filter((event) => !event.internal && (own.has(event.id) || !elsewhere.has(event.id)))
    .map((event) => event.id);
  return [...new Set([...handled, ...inputs])].sort();
}

/** The actor a step in `compartment` goes to; none for the machine itself. */
export function actorOf(compartment: string): { actor?: VizActorRef } {
  return compartment === "" ? {} : { actor: { region: compartment } };
}

/** The URL/DOM text of an actor ref: "" for the machine itself. */
export function actorText(actor: VizActorRef | undefined): string {
  return actor === undefined ? "" : "region" in actor ? actor.region : `${actor.map}[${actor.key}]`;
}

/** Region paths of a live state, sorted. */
export function regionPaths(state: VizLiveState): string[] {
  return Object.keys(state.regions).sort();
}

export function compareKeys(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}

/** The child a map's diagram shows: the picked one while it exists, else the lowest key. */
export function walkedChild(
  state: VizLiveState,
  map: string,
  picked: { map: string; key: string } | null,
): VizLiveChild | undefined {
  const children = state.children.filter((child) => child.map === map);
  return (
    children.find((child) => picked?.map === map && child.key === picked.key) ??
    [...children].sort((a, b) => compareKeys(a.key, b.key))[0]
  );
}

/** Every state the actor is in: the machine's own, each region's, then the walked child of each map. */
export function currentsOf(
  state: VizLiveState,
  picked: { map: string; key: string } | null = null,
): string[] {
  const maps = [...new Set(state.children.map((child) => child.map))];
  return [
    state.state,
    ...regionPaths(state).map((path) => state.regions[path] ?? ""),
    ...maps.map((map) => walkedChild(state, map, picked)?.state ?? ""),
  ];
}

/** Name of a state inside its region. */
export function localName(id: string): string {
  return id.slice(id.lastIndexOf(".") + 1);
}
