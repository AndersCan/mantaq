import type { VizLiveState, VizMachine } from "../schema.ts";
import { compareKeys, walkedChild } from "./compartments.ts";
import { html } from "./dom.ts";

type Picked = { map: string; key: string };

/** One map's children counted by state, in the machine's state order, zeros dropped. */
export function countsOf(
  machine: VizMachine,
  live: VizLiveState,
  map: string,
): { total: number; items: Array<{ state: string; label: string; keys: string[] }> } {
  const children = live.children.filter((child) => child.map === map);
  const items = machine.states
    .filter((state) => state.region === map)
    .map((state) => ({
      state: state.id,
      label: state.label,
      keys: children
        .filter((child) => child.state === state.id)
        .map((child) => child.key)
        .sort(compareKeys),
    }))
    .filter((item) => item.keys.length > 0);
  return { total: children.length, items };
}

/** "worker" for 1 child of map "workers", else the map id. */
export function nounOf(map: string, total: number): string {
  return total === 1 && map.endsWith("s") ? map.slice(0, -1) : map;
}

/** The key a click on a count walks: the one after `walked` in `keys` when it is there (wraps), else the first. */
export function nextKey(keys: ReadonlyArray<string>, walked: string | undefined): string {
  const at = walked === undefined ? -1 : keys.indexOf(walked);
  return keys[(at + 1) % keys.length] ?? "";
}

/** One `<p data-pool-count>` per map; clicking a count walks a child in that state. */
export function countLines(
  doc: Document,
  context: {
    machine: VizMachine;
    live: VizLiveState;
    picked: Picked | null;
    onWalk: (child: Picked) => void;
  },
): HTMLElement[] {
  const { machine, live, picked, onWalk } = context;
  return machine.maps.map((map) => {
    const { total, items } = countsOf(machine, live, map);
    const walked = walkedChild(live, map, picked)?.key;
    const buttons = items.map((item) => {
      const button = html(
        doc,
        "button",
        {
          type: "button",
          "data-count-state": item.state,
          "data-keys": JSON.stringify(item.keys),
          "aria-pressed": String(walked !== undefined && item.keys.includes(walked)),
        },
        [`${item.keys.length} ${item.label}`],
      );
      button.addEventListener("click", () => onWalk({ map, key: nextKey(item.keys, walked) }));
      return button;
    });
    return html(doc, "p", { class: "pool-count", "data-pool-count": map }, [
      `${total} ${nounOf(map, total)}: `,
      ...buttons.flatMap((button, index) => (index === 0 ? [button] : [", ", button])),
    ]);
  });
}
