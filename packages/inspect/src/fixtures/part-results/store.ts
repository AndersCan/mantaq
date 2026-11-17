/** A store machine whose effect loads items and reports them through an internal event. */
import { Actor, event, state } from "@mantaq/core";
import type { Clock } from "@mantaq/core";

/** The store has not asked for items yet. */
const empty = state("empty")();
/** The store is loading items. */
const loading = state("loading")();
/** The store holds its items. */
const loaded = state("loaded")();

/** Someone asks the store to load. */
const loadClicked = event("LOAD_CLICKED")();
/** The effect found the items. */
const itemsLoaded = event("LOADED")<{ items: string[] }>();
/** The effect could not load the items. */
const loadFailed = event("FAILED")<{ reason: string }>();

export function makeStore(clock: Clock) {
  return Actor({
    clock,
    inputs: [loadClicked],
    internal: [itemsLoaded, loadFailed],
    states: [empty, loading, loaded],
    initial: empty,
    context: { count: 0 },
    setup: (m) => {
      /** A load click starts loading. */
      m.on(empty, { event: loadClicked, to: [loading], handler: () => ({ state: loading }) });
      /** The effect loads the items. */
      m.effect(loading, {
        name: "loadItems",
        sends: [itemsLoaded, loadFailed],
        fn: ({ emit }) => emit(itemsLoaded.create({ items: ["a"] })),
      });
      /** The items arrived, so the store counts them. */
      m.on(loading, {
        event: itemsLoaded,
        to: [loaded],
        handler: (e) => ({ state: loaded, context: { count: e.payload.items.length } }),
      });
      /** A failed load leaves the store empty. */
      m.on(loading, {
        event: loadFailed,
        to: [empty],
        handler: (e) => ({ state: empty, context: { count: e.payload.reason.length } }),
      });
    },
  });
}
