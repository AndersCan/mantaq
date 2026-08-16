/**
 * PINNED FIXTURE — cache.
 *
 * Source: packages/examples/cacheWithTtlAndLru.actor.test.ts
 * (`createCacheActor(capacity = 2)`)
 * FIXTURE_VERSION: 1
 *
 * Do not import from packages/examples: factories are module-private inside
 * .actor.test.ts with no exports map. This is a copy; the drift guard
 * (browser/fixtures/fingerprints.json + tests/fingerprints.test.ts) catches
 * upstream refactors that change the graph shape.
 *
 * Story: TTL + LRU cache with a concurrent `tier` region (l1 ↔ l2) and
 * sync purging/eviction effect states. Pinned with capacity 2 (plan §9.2) so
 * PUT × 3 trips the `full` eviction path.
 *
 *   ready → purging → ready (purging effect scans expired entries)
 *   ready → full → ready (full effect evicts LRU entry)
 *   (region) tier: l1 → l2
 *
 * Deterministic: TTL/now come from the VirtualClock; no Math.random.
 */

import { Actor, VirtualClock, state, event } from "@mantaq/core";

interface CacheEntry {
  value: unknown;
  expiresAt: number | null;
  accessCount: number;
  lastAccessed: number;
}

// `type` not `interface` (as in the source): the actor's context generic is
// the fixture host's `AnyActor` (context = Record<string, unknown>); type
// aliases get an implicit index signature, interfaces don't.
type CacheContext = {
  entries: Map<string, CacheEntry>;
  accessOrder: string[];
  capacity: number;
  hits: number;
  misses: number;
  evictions: number;
  expires: number;
};

const cacheStates = {
  ready: state("ready")(),
  purging: state("purging")(),
  full: state("full")(),
};
const tierStates = {
  l1: state("l1")(),
  l2: state("l2")(),
};

export const put = event("PUT")<{ key: string; value: unknown; ttlMs?: number }>();
export const get = event("GET")<{ key: string }>();
// Module-private: not exposed on the bridge.
const deleteEntry = event("DELETE")<{ key: string }>();
export const purge = event("PURGE")();
const setCapacity = event("SET_CAPACITY")<{ capacity: number }>();

const purgeDone = event("PURGE_DONE")();
const evictionDone = event("EVICTION_DONE")();
const ttlExpired = event("TTL_EXPIRED")<{ key: string }>();

export function createCacheActor(capacity = 2, clock?: VirtualClock) {
  const c = clock ?? new VirtualClock();

  const tierActor = new Actor({
    inputs: [],
    outputs: [],
    internal: [],
    states: [tierStates.l1, tierStates.l2],
    initial: tierStates.l1,
    context: {} as {},
    setup: () => {},
  });

  const context: CacheContext = {
    entries: new Map(),
    accessOrder: [],
    capacity,
    hits: 0,
    misses: 0,
    evictions: 0,
    expires: 0,
  };

  const actor = new Actor({
    inputs: [put, get, deleteEntry, purge, setCapacity],
    outputs: [],
    internal: [purgeDone, evictionDone, ttlExpired],
    states: [cacheStates.ready, cacheStates.purging, cacheStates.full],
    initial: cacheStates.ready,
    clock: c,
    context,
    regions: { tier: tierActor },
    setup: (m) => {
      m.effect(cacheStates.purging, (input) => {
        const now = input.clock.now();
        const s = input.context.get();
        const expired: string[] = [];
        for (const [key, entry] of s.entries) {
          if (entry.expiresAt !== null && entry.expiresAt <= now) {
            expired.push(key);
          }
        }
        for (const key of expired) {
          s.entries.delete(key);
          s.accessOrder = s.accessOrder.filter((k) => k !== key);
        }
        s.expires += expired.length;
        input.context.set(s);
        input.emit(purgeDone.create());
      });
      m.effect(cacheStates.full, (input) => {
        const s = input.context.get();
        if (s.accessOrder.length >= s.capacity) {
          const accessOrder = [...s.accessOrder];
          const lruKey = accessOrder.shift();
          if (lruKey) {
            s.entries = new Map(s.entries);
            s.entries.delete(lruKey);
            s.accessOrder = accessOrder;
            s.evictions += 1;
            input.context.set(s);
          }
        }
        input.emit(evictionDone.create());
      });
      m.onAny(get, (event, opts) => {
        const { context } = opts!;
        const s = context.get();
        const entry = s.entries.get(event.payload.key);
        if (entry) {
          const now = c.now();
          if (entry.expiresAt !== null && entry.expiresAt <= now) {
            s.entries = new Map(s.entries);
            s.entries.delete(event.payload.key);
            s.accessOrder = s.accessOrder.filter((k) => k !== event.payload.key);
            s.expires += 1;
            s.misses += 1;
            context.set(s);
            return {};
          }
          s.entries = new Map(s.entries);
          s.entries.set(event.payload.key, {
            ...entry,
            accessCount: entry.accessCount + 1,
            lastAccessed: now,
          });
          s.accessOrder = [
            ...s.accessOrder.filter((k) => k !== event.payload.key),
            event.payload.key,
          ];
          s.hits += 1;
          context.set(s);
          return {};
        }
        s.misses += 1;
        context.set(s);
        return {};
      });
      m.onAny(deleteEntry, (event, opts) => {
        const { context } = opts!;
        const s = context.get();
        if (s.entries.has(event.payload.key)) {
          s.entries = new Map(s.entries);
          s.entries.delete(event.payload.key);
          s.accessOrder = s.accessOrder.filter((k) => k !== event.payload.key);
          context.set(s);
        }
        return {};
      });
      m.onAny(put, (event, opts) => {
        const { context } = opts!;
        const s = context.get();
        const now = c.now();
        const entry: CacheEntry = {
          value: event.payload.value,
          expiresAt: event.payload.ttlMs !== undefined ? now + event.payload.ttlMs : null,
          accessCount: 0,
          lastAccessed: now,
        };
        s.entries = new Map(s.entries);
        s.accessOrder = s.entries.has(event.payload.key)
          ? s.accessOrder
          : [...s.accessOrder, event.payload.key];
        s.entries.set(event.payload.key, entry);
        context.set(s);
        if (s.entries.size > s.capacity) {
          return { state: cacheStates.full };
        }
        return {};
      });
      m.onAny(purge, () => ({ state: cacheStates.purging }));
      m.onAny(setCapacity, (event, opts) => {
        const s = opts!.context.get();
        s.capacity = event.payload.capacity;
        opts!.context.set(s);
        return {};
      });
      m.on(cacheStates.purging, purgeDone, (_event, opts) => {
        const s = opts!.context.get();
        if (s.entries.size > s.capacity) {
          return { state: cacheStates.full };
        }
        return { state: cacheStates.ready };
      });
      m.on(cacheStates.full, evictionDone, (_event, opts) => {
        const s = opts!.context.get();
        if (s.entries.size > s.capacity) {
          return { state: cacheStates.full };
        }
        return { state: cacheStates.ready };
      });
    },
  });

  return { actor, clock: c, context };
}
