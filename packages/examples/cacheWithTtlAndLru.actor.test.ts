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

import { describe, it, expect } from "vite-plus/test";
import { Actor, VirtualClock, event } from "@mantaq/core";
import { matches, states, events } from "@mantaq/sugar";

// ── Types ────────────────────────────────────────────────────────────
interface CacheEntry {
  value: unknown;
  expiresAt: number | null;
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
const e = events("PURGE", "PURGE_DONE", "EVICTION_DONE");

// ── Actor factory ────────────────────────────────────────────────────
function createCacheActor(capacity = 3, clock?: VirtualClock) {
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
    inputs: [putEvent, getEvent, deleteEvent, e.PURGE, setCapacityEvent],
    outputs: [],
    internal: [e.PURGE_DONE, e.EVICTION_DONE, ttlExpiredEvent],
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
        input.emit(e.PURGE_DONE.create(undefined));
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
        input.emit(e.EVICTION_DONE.create(undefined));
      });
      m.onAny(getEvent, (event, opts) => {
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
      m.onAny(deleteEvent, (event, opts) => {
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
      m.onAny(putEvent, (event, opts) => {
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
      m.onAny(e.PURGE, () => ({ state: cacheStates.purging }));
      m.onAny(setCapacityEvent, (event, opts) => {
        const s = opts!.context.get();
        s.capacity = event.payload.capacity;
        opts!.context.set(s);
        return {};
      });
      m.on(cacheStates.purging, e.PURGE_DONE, (_event, opts) => {
        const s = opts!.context.get();
        if (s.entries.size > s.capacity) {
          return { state: cacheStates.full };
        }
        return { state: cacheStates.ready };
      });
      m.on(cacheStates.full, e.EVICTION_DONE, (_event, opts) => {
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

// ── Tests ────────────────────────────────────────────────────────────
describe("cache with TTL and LRU eviction", () => {
  it("starts in ready state with empty cache", () => {
    const { actor } = createCacheActor();
    expect(matches(actor, "ready")).toBe(true);
    expect(actor.context.entries.size).toBe(0);
    expect(actor.context.hits).toBe(0);
    expect(actor.context.misses).toBe(0);
  });

  it("PUT then GET returns value (cache hit)", () => {
    const { actor } = createCacheActor();

    actor.send(putEvent.create({ key: "foo", value: 42 }));
    expect(actor.context.entries.size).toBe(1);

    actor.send(getEvent.create({ key: "foo" }));
    expect(actor.context.hits).toBe(1);
    expect(actor.context.misses).toBe(0);
    expect(actor.context.entries.get("foo")?.accessCount).toBe(1);
  });

  it("GET missing key counts as miss", () => {
    const { actor } = createCacheActor();

    actor.send(getEvent.create({ key: "missing" }));
    expect(actor.context.misses).toBe(1);
    expect(actor.context.hits).toBe(0);
  });

  it("DELETE removes entry", () => {
    const { actor } = createCacheActor();

    actor.send(putEvent.create({ key: "foo", value: 42 }));
    expect(actor.context.entries.size).toBe(1);

    actor.send(deleteEvent.create({ key: "foo" }));
    expect(actor.context.entries.size).toBe(0);
  });

  it("PUT with TTL expires after timeout", () => {
    const { actor, clock } = createCacheActor();

    actor.send(putEvent.create({ key: "temp", value: "data", ttlMs: 1000 }));
    expect(actor.context.entries.size).toBe(1);

    clock.advance(500);
    expect(actor.context.entries.size).toBe(1);
    expect(matches(actor, "ready")).toBe(true);

    clock.advance(500);
    expect(matches(actor, "ready")).toBe(true);
  });

  it("TTL expired entry treated as miss on GET", () => {
    const { actor, clock } = createCacheActor();

    actor.send(putEvent.create({ key: "temp", value: "data", ttlMs: 1000 }));
    clock.advance(1001);

    actor.send(getEvent.create({ key: "temp" }));
    expect(actor.context.misses).toBe(1);
    expect(actor.context.hits).toBe(0);
    expect(actor.context.entries.size).toBe(0);
  });

  it("LRU eviction when capacity exceeded", () => {
    const { actor } = createCacheActor(2);

    actor.send(putEvent.create({ key: "a", value: 1 }));
    actor.send(putEvent.create({ key: "b", value: 2 }));
    expect(actor.context.entries.size).toBe(2);

    actor.send(putEvent.create({ key: "c", value: 3 }));
    expect(matches(actor, "ready")).toBe(true);
    expect(actor.context.entries.size).toBe(2);
    expect(actor.context.evictions).toBe(1);
    expect(actor.context.accessOrder).not.toContain("a");
  });

  it("GET updates LRU order (prevents eviction of recently accessed)", () => {
    const { actor } = createCacheActor(2);

    actor.send(putEvent.create({ key: "a", value: 1 }));
    actor.send(putEvent.create({ key: "b", value: 2 }));

    actor.send(getEvent.create({ key: "a" }));

    actor.send(putEvent.create({ key: "c", value: 3 }));
    expect(actor.context.accessOrder).toContain("a");
    expect(actor.context.accessOrder).not.toContain("b");
    expect(actor.context.evictions).toBe(1);
  });

  it("PURGE removes expired entries", () => {
    const { actor, clock } = createCacheActor();

    actor.send(putEvent.create({ key: "a", value: 1, ttlMs: 500 }));
    actor.send(putEvent.create({ key: "b", value: 2 }));
    clock.advance(600);

    actor.send(e.PURGE.create());
    expect(matches(actor, "ready")).toBe(true);
    expect(actor.context.expires).toBe(1);
    expect(actor.context.entries.size).toBe(1);
    expect(actor.context.entries.has("b")).toBe(true);
  });

  it("SET_CAPACITY updates capacity", () => {
    const { actor } = createCacheActor(3);

    actor.send(setCapacityEvent.create({ capacity: 1 }));
    expect(actor.context.capacity).toBe(1);

    actor.send(putEvent.create({ key: "a", value: 1 }));
    actor.send(putEvent.create({ key: "b", value: 2 }));
    expect(actor.context.evictions).toBe(1);
    expect(actor.context.entries.size).toBe(1);
  });

  it("PUT replacing existing key does not duplicate in accessOrder", () => {
    const { actor } = createCacheActor();

    actor.send(putEvent.create({ key: "a", value: 1 }));
    actor.send(putEvent.create({ key: "a", value: 2 }));
    expect(actor.context.accessOrder.filter((k) => k === "a").length).toBe(1);
    expect(actor.context.entries.get("a")?.value).toBe(2);
  });

  it("multiple evictions fill to capacity", () => {
    const { actor } = createCacheActor(2);

    actor.send(putEvent.create({ key: "a", value: 1 }));
    actor.send(putEvent.create({ key: "b", value: 2 }));
    actor.send(putEvent.create({ key: "c", value: 3 }));
    actor.send(putEvent.create({ key: "d", value: 4 }));

    expect(actor.context.entries.size).toBe(2);
    expect(actor.context.evictions).toBe(2);
    expect(actor.context.accessOrder).toContain("c");
    expect(actor.context.accessOrder).toContain("d");
  });

  it("DELETE from empty cache is no-op", () => {
    const { actor } = createCacheActor();

    actor.send(deleteEvent.create({ key: "missing" }));
    expect(actor.context.entries.size).toBe(0);
    expect(actor.context.evictions).toBe(0);
  });

  it("GET after delete counts as miss", () => {
    const { actor } = createCacheActor();

    actor.send(putEvent.create({ key: "a", value: 1 }));
    actor.send(deleteEvent.create({ key: "a" }));
    actor.send(getEvent.create({ key: "a" }));
    expect(actor.context.misses).toBe(1);
    expect(actor.context.hits).toBe(0);
  });

  it("cache metrics track correctly across operations", () => {
    const { actor, clock } = createCacheActor(2);

    actor.send(putEvent.create({ key: "a", value: 1, ttlMs: 1000 }));
    actor.send(putEvent.create({ key: "b", value: 2 }));

    actor.send(getEvent.create({ key: "a" }));
    actor.send(getEvent.create({ key: "b" }));
    actor.send(getEvent.create({ key: "c" }));

    expect(actor.context.hits).toBe(2);
    expect(actor.context.misses).toBe(1);

    clock.advance(1001);
    actor.send(getEvent.create({ key: "a" }));
    expect(actor.context.expires).toBe(1);
    expect(actor.context.misses).toBe(2);
  });

  it("tier region starts at l1", () => {
    const { actor } = createCacheActor();
    expect(matches(actor, "ready.tier.l1")).toBe(true);
  });

  it("full state transitions back to ready after eviction", () => {
    const { actor } = createCacheActor(1);

    actor.send(putEvent.create({ key: "a", value: 1 }));
    expect(matches(actor, "ready")).toBe(true);

    actor.send(putEvent.create({ key: "b", value: 2 }));
    expect(matches(actor, "ready")).toBe(true);
    expect(actor.context.entries.size).toBe(1);
  });
});
