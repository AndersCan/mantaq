/**
 * Problem: Caching with TTL expiration and LRU eviction. Real caches need
 * time-based expiry, capacity limits with eviction, and metrics tracking.
 *
 * Actor model approach:
 *   - Cache entries stored in context (not state) — data, not mode
 *   - States represent operational modes: ready, purging, full
 *   - Effects with clock.setTimeout handle TTL-based expiration
 *   - Internal events bridge async operations (purge, eviction) back to state
 *   - region-style composition: separate L1 (hot) and L2 (warm) cache tiers
 *
 * Structure:
 *   ready ←→ purging (cleanup expired)
 *   ready ←→ full (capacity reached → evict → back to ready)
 *   Regions: tier (l1/l2) tracks which cache tier is active
 */

import { Actor, VirtualClock, event } from "@mantaq/core";
import { matches, states, events } from "@mantaq/sugar";
import { describe, it, expect } from "vite-plus/test";

// ── Types ────────────────────────────────────────────────────────────
interface CacheEntry {
  value: unknown;
  expiresAt: number | undefined;
  accessCount: number;
  lastAccessed: number;
}

interface CacheContext {
  entries: Map<string, CacheEntry>;
  accessOrder: string[];
  capacity: number;
  hits: number;
  misses: number;
  evictions: number;
  expires: number;
}

// ── States ───────────────────────────────────────────────────────────
const cacheStates = states("ready", "purging", "full");
const tierStates = states("l1", "l2");

// ── Events ───────────────────────────────────────────────────────────
const putEvent = event("PUT")<{ key: string; value: unknown; ttlMs?: number }>();
const getEvent = event("GET")<{ key: string }>();
const deleteEvent = event("DELETE")<{ key: string }>();
const setCapacityEvent = event("SET_CAPACITY")<{ capacity: number }>();

// ── Internal events ──────────────────────────────────────────────────
const ttlExpiredEvent = event("TTL_EXPIRED")<{ key: string }>();
const lifecycleEvents = events("PURGE", "PURGE_DONE", "EVICTION_DONE");

// ── Actor factory ────────────────────────────────────────────────────
function createCacheActor(options: { capacity?: number; clock?: VirtualClock } = {}) {
  const c = options.clock ?? VirtualClock();

  const tierActor = Actor({
    inputs: [],
    outputs: [],
    internal: [],
    states: [tierStates.l1, tierStates.l2],
    initial: tierStates.l1,
    context: {},
    setup: () => {},
  });

  const context: CacheContext = {
    entries: new Map(),
    accessOrder: [],
    capacity: options.capacity ?? 3,
    hits: 0,
    misses: 0,
    evictions: 0,
    expires: 0,
  };

  const actor = Actor({
    inputs: [putEvent, getEvent, deleteEvent, lifecycleEvents.PURGE, setCapacityEvent],
    outputs: [],
    internal: [lifecycleEvents.PURGE_DONE, lifecycleEvents.EVICTION_DONE, ttlExpiredEvent],
    states: [cacheStates.ready, cacheStates.purging, cacheStates.full],
    initial: cacheStates.ready,
    clock: c,
    context,
    regions: { tier: tierActor },
    setup: (m) => {
      m.effect(cacheStates.purging, {
        name: "purgeExpired",
        fn: (input) => {
          const now = input.clock.now();
          const snapshot = input.context.get();
          const expired: string[] = [];
          for (const [key, entry] of snapshot.entries) {
            if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
              expired.push(key);
            }
          }
          for (const key of expired) {
            snapshot.entries.delete(key);
            snapshot.accessOrder = snapshot.accessOrder.filter((k) => k !== key);
          }
          snapshot.expires += expired.length;
          input.context.set(snapshot);
          input.emit(lifecycleEvents.PURGE_DONE.create(undefined));
        },
      });
      m.effect(cacheStates.full, {
        name: "evictLeastRecentlyUsed",
        fn: (input) => {
          const snapshot = input.context.get();
          if (snapshot.accessOrder.length >= snapshot.capacity) {
            const accessOrder = [...snapshot.accessOrder];
            const lruKey = accessOrder.shift();
            if (lruKey) {
              snapshot.entries = new Map(snapshot.entries);
              snapshot.entries.delete(lruKey);
              snapshot.accessOrder = accessOrder;
              snapshot.evictions += 1;
              input.context.set(snapshot);
            }
          }
          input.emit(lifecycleEvents.EVICTION_DONE.create(undefined));
        },
      });
      m.onAny({
        eventRef: getEvent,
        handler: (event, { context }) => {
          const snapshot = context.get();
          const entry = snapshot.entries.get(event.payload.key);
          if (entry) {
            const now = c.now();
            if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
              snapshot.entries = new Map(snapshot.entries);
              snapshot.entries.delete(event.payload.key);
              snapshot.accessOrder = snapshot.accessOrder.filter((k) => k !== event.payload.key);
              snapshot.expires += 1;
              snapshot.misses += 1;
              context.set(snapshot);
              return {};
            }
            snapshot.entries = new Map(snapshot.entries);
            snapshot.entries.set(event.payload.key, {
              ...entry,
              accessCount: entry.accessCount + 1,
              lastAccessed: now,
            });
            snapshot.accessOrder = [
              ...snapshot.accessOrder.filter((k) => k !== event.payload.key),
              event.payload.key,
            ];
            snapshot.hits += 1;
            context.set(snapshot);
            return {};
          }
          snapshot.misses += 1;
          context.set(snapshot);
          return {};
        },
      });
      m.onAny({
        eventRef: deleteEvent,
        handler: (event, { context }) => {
          const snapshot = context.get();
          if (snapshot.entries.has(event.payload.key)) {
            snapshot.entries = new Map(snapshot.entries);
            snapshot.entries.delete(event.payload.key);
            snapshot.accessOrder = snapshot.accessOrder.filter((k) => k !== event.payload.key);
            context.set(snapshot);
          }
          return {};
        },
      });
      m.onAny({
        eventRef: putEvent,
        handler: (event, { context }) => {
          const snapshot = context.get();
          const now = c.now();
          const entry: CacheEntry = {
            value: event.payload.value,
            expiresAt: event.payload.ttlMs !== undefined ? now + event.payload.ttlMs : undefined,
            accessCount: 0,
            lastAccessed: now,
          };
          snapshot.entries = new Map(snapshot.entries);
          snapshot.accessOrder = snapshot.entries.has(event.payload.key)
            ? snapshot.accessOrder
            : [...snapshot.accessOrder, event.payload.key];
          snapshot.entries.set(event.payload.key, entry);
          context.set(snapshot);
          if (snapshot.entries.size > snapshot.capacity) {
            return { state: cacheStates.full };
          }
          return {};
        },
      });
      m.onAny({ eventRef: lifecycleEvents.PURGE, handler: () => ({ state: cacheStates.purging }) });
      m.onAny({
        eventRef: setCapacityEvent,
        handler: (event, { context }) => {
          const snapshot = context.get();
          snapshot.capacity = event.payload.capacity;
          context.set(snapshot);
          return {};
        },
      });
      m.on(cacheStates.purging, {
        eventRef: lifecycleEvents.PURGE_DONE,
        handler: (_event, { context }) => {
          const snapshot = context.get();
          if (snapshot.entries.size > snapshot.capacity) {
            return { state: cacheStates.full };
          }
          return { state: cacheStates.ready };
        },
      });
      m.on(cacheStates.full, {
        eventRef: lifecycleEvents.EVICTION_DONE,
        handler: (_event, { context }) => {
          const snapshot = context.get();
          if (snapshot.entries.size > snapshot.capacity) {
            return { state: cacheStates.full };
          }
          return { state: cacheStates.ready };
        },
      });
    },
  });

  return { actor, clock: c, context };
}

// ── Tests ────────────────────────────────────────────────────────────
describe("cache with TTL and LRU eviction", () => {
  it("sets an empty ready cache initially", () => {
    const { actor } = createCacheActor();
    expect({
      matches: matches(actor, "ready"),
      size: actor.context.entries.size,
      hits: actor.context.hits,
      misses: actor.context.misses,
    }).toEqual({ matches: true, size: 0, hits: 0, misses: 0 });
  });

  it("returns the value on a PUT then GET cache hit", () => {
    const { actor } = createCacheActor();

    actor.send(putEvent.create({ key: "foo", value: 42 }));
    expect({ size: actor.context.entries.size }).toEqual({ size: 1 });

    actor.send(getEvent.create({ key: "foo" }));
    expect({
      hits: actor.context.hits,
      misses: actor.context.misses,
      accessCount: actor.context.entries.get("foo")?.accessCount,
    }).toEqual({ hits: 1, misses: 0, accessCount: 1 });
  });

  it("adds a miss when GET targets a missing key", () => {
    const { actor } = createCacheActor();

    actor.send(getEvent.create({ key: "missing" }));
    expect({
      misses: actor.context.misses,
      hits: actor.context.hits,
    }).toEqual({ misses: 1, hits: 0 });
  });

  it("removes an entry on DELETE", () => {
    const { actor } = createCacheActor();

    actor.send(putEvent.create({ key: "foo", value: 42 }));
    expect({ size: actor.context.entries.size }).toEqual({ size: 1 });

    actor.send(deleteEvent.create({ key: "foo" }));
    expect({ size: actor.context.entries.size }).toEqual({ size: 0 });
  });

  it("handles TTL expiration after the timeout elapses", () => {
    const { actor, clock } = createCacheActor();

    actor.send(putEvent.create({ key: "temp", value: "data", ttlMs: 1000 }));
    expect({ size: actor.context.entries.size }).toEqual({ size: 1 });

    clock.advance(500);
    expect({
      size: actor.context.entries.size,
      matches: matches(actor, "ready"),
    }).toEqual({ size: 1, matches: true });

    clock.advance(500);
    expect(matches(actor, "ready")).toBe(true);
  });

  it("treats a TTL expired entry as a miss on GET", () => {
    const { actor, clock } = createCacheActor();

    actor.send(putEvent.create({ key: "temp", value: "data", ttlMs: 1000 }));
    clock.advance(1001);

    actor.send(getEvent.create({ key: "temp" }));
    expect({
      misses: actor.context.misses,
      hits: actor.context.hits,
      size: actor.context.entries.size,
    }).toEqual({ misses: 1, hits: 0, size: 0 });
  });

  it("removes the least recently used entry when capacity is exceeded", () => {
    const { actor } = createCacheActor({ capacity: 2 });

    actor.send(putEvent.create({ key: "a", value: 1 }));
    actor.send(putEvent.create({ key: "b", value: 2 }));
    expect({ size: actor.context.entries.size }).toEqual({ size: 2 });

    actor.send(putEvent.create({ key: "c", value: 3 }));
    expect({
      matches: matches(actor, "ready"),
      size: actor.context.entries.size,
      evictions: actor.context.evictions,
      order: actor.context.accessOrder,
    }).toEqual({ matches: true, size: 2, evictions: 1, order: ["b", "c"] });
  });

  it("updates the LRU order so recently accessed keys survive eviction", () => {
    const { actor } = createCacheActor({ capacity: 2 });

    actor.send(putEvent.create({ key: "a", value: 1 }));
    actor.send(putEvent.create({ key: "b", value: 2 }));

    actor.send(getEvent.create({ key: "a" }));

    actor.send(putEvent.create({ key: "c", value: 3 }));
    expect({
      order: actor.context.accessOrder,
      evictions: actor.context.evictions,
    }).toEqual({ order: ["a", "c"], evictions: 1 });
  });

  it("removes expired entries on PURGE", () => {
    const { actor, clock } = createCacheActor();

    actor.send(putEvent.create({ key: "a", value: 1, ttlMs: 500 }));
    actor.send(putEvent.create({ key: "b", value: 2 }));
    clock.advance(600);

    actor.send(lifecycleEvents.PURGE.create());
    expect({
      matches: matches(actor, "ready"),
      expires: actor.context.expires,
      size: actor.context.entries.size,
      keepsB: actor.context.entries.has("b"),
    }).toEqual({ matches: true, expires: 1, size: 1, keepsB: true });
  });

  it("updates capacity on SET_CAPACITY", () => {
    const { actor } = createCacheActor({ capacity: 3 });

    actor.send(setCapacityEvent.create({ capacity: 1 }));
    expect({ capacity: actor.context.capacity }).toEqual({ capacity: 1 });

    actor.send(putEvent.create({ key: "a", value: 1 }));
    actor.send(putEvent.create({ key: "b", value: 2 }));
    expect({
      evictions: actor.context.evictions,
      size: actor.context.entries.size,
    }).toEqual({ evictions: 1, size: 1 });
  });

  it("updates the value without duplicating the key in accessOrder", () => {
    const { actor } = createCacheActor();

    actor.send(putEvent.create({ key: "a", value: 1 }));
    actor.send(putEvent.create({ key: "a", value: 2 }));
    expect({
      occurrencesOfA: actor.context.accessOrder.filter((k) => k === "a").length,
      value: actor.context.entries.get("a")?.value,
    }).toEqual({ occurrencesOfA: 1, value: 2 });
  });

  it("adds entries until capacity triggers repeated evictions", () => {
    const { actor } = createCacheActor({ capacity: 2 });

    actor.send(putEvent.create({ key: "a", value: 1 }));
    actor.send(putEvent.create({ key: "b", value: 2 }));
    actor.send(putEvent.create({ key: "c", value: 3 }));
    actor.send(putEvent.create({ key: "d", value: 4 }));

    expect({
      size: actor.context.entries.size,
      evictions: actor.context.evictions,
      order: actor.context.accessOrder,
    }).toEqual({ size: 2, evictions: 2, order: ["c", "d"] });
  });

  it("keeps DELETE on an empty cache as a no-op", () => {
    const { actor } = createCacheActor();

    actor.send(deleteEvent.create({ key: "missing" }));
    expect({
      size: actor.context.entries.size,
      evictions: actor.context.evictions,
    }).toEqual({ size: 0, evictions: 0 });
  });

  it("adds a miss when GET follows a delete of the same key", () => {
    const { actor } = createCacheActor();

    actor.send(putEvent.create({ key: "a", value: 1 }));
    actor.send(deleteEvent.create({ key: "a" }));
    actor.send(getEvent.create({ key: "a" }));
    expect({
      misses: actor.context.misses,
      hits: actor.context.hits,
    }).toEqual({ misses: 1, hits: 0 });
  });

  it("keeps hit and miss counts accurate across operations", () => {
    const { actor, clock } = createCacheActor({ capacity: 2 });

    actor.send(putEvent.create({ key: "a", value: 1, ttlMs: 1000 }));
    actor.send(putEvent.create({ key: "b", value: 2 }));

    actor.send(getEvent.create({ key: "a" }));
    actor.send(getEvent.create({ key: "b" }));
    actor.send(getEvent.create({ key: "c" }));

    expect({
      hits: actor.context.hits,
      misses: actor.context.misses,
    }).toEqual({ hits: 2, misses: 1 });

    clock.advance(1001);
    actor.send(getEvent.create({ key: "a" }));
    expect({
      expires: actor.context.expires,
      misses: actor.context.misses,
    }).toEqual({ expires: 1, misses: 2 });
  });

  it("sets l1 as the initial tier region state", () => {
    const { actor } = createCacheActor();
    expect(matches(actor, "ready.tier.l1")).toBe(true);
  });

  it("returns to ready after eviction completes", () => {
    const { actor } = createCacheActor({ capacity: 1 });

    actor.send(putEvent.create({ key: "a", value: 1 }));
    expect(matches(actor, "ready")).toBe(true);

    actor.send(putEvent.create({ key: "b", value: 2 }));
    expect({
      matches: matches(actor, "ready"),
      size: actor.context.entries.size,
    }).toEqual({ matches: true, size: 1 });
  });
});
