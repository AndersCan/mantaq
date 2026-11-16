import type { VizActorRef, VizLiveChild, VizLiveState } from "../schema.ts";

/** The URL/DOM text of an actor ref: "" for the machine itself. */
export function actorText(actor: VizActorRef | undefined): string {
  return actor === undefined ? "" : "region" in actor ? actor.region : `${actor.map}[${actor.key}]`;
}

/** Region paths of a live state, sorted. */
function regionPaths(state: VizLiveState): string[] {
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
