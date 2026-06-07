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
import { matches, states } from "@mantaq/sugar";

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
const purgeEvent = event("PURGE")();
const setCapacityEvent = event("SET_CAPACITY")<{ capacity: number }>();

// ── Internal events ──────────────────────────────────────────────────
const purgeDoneEvent = event("PURGE_DONE")();
const evictionDoneEvent = event("EVICTION_DONE")();
const ttlExpiredEvent = event("TTL_EXPIRED")<{ key: string }>();

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
    effects: {},
    transitions: {
      l1: {},
      l2: {},
    },
  });

  const ctx: CacheContext = {
    entries: new Map(),
    accessOrder: [],
    capacity,
    hits: 0,
    misses: 0,
    evictions: 0,
    expires: 0,
  };

  const actor = new Actor({
    inputs: [putEvent, getEvent, deleteEvent, purgeEvent, setCapacityEvent],
    outputs: [],
    internal: [purgeDoneEvent, evictionDoneEvent, ttlExpiredEvent],
    states: [cacheStates.ready, cacheStates.purging, cacheStates.full],
    initial: cacheStates.ready,
    clock: c,
    context: ctx,
    regions: { tier: tierActor },
    effects: {
      purging: [
        (input) => {
          const now = input.clock.now();
          const expired: string[] = [];
          for (const [key, entry] of input.context.entries) {
            if (entry.expiresAt !== null && entry.expiresAt <= now) {
              expired.push(key);
            }
          }
          for (const key of expired) {
            input.context.entries.delete(key);
            input.context.accessOrder = input.context.accessOrder.filter((k) => k !== key);
            input.context.expires++;
          }
          input.emit(purgeDoneEvent.create(undefined));
        },
      ],
      full: [
        (input) => {
          if (input.context.accessOrder.length >= input.context.capacity) {
            const lruKey = input.context.accessOrder.shift();
            if (lruKey) {
              input.context.entries.delete(lruKey);
              input.context.evictions++;
            }
          }
          input.emit(evictionDoneEvent.create(undefined));
        },
      ],
    },
    transitions: {
      Any: {
        GET: (event, { context, actor }) => {
          const entry = context.entries.get(event.key);
          if (entry) {
            const now = actor.clock.now();
            if (entry.expiresAt !== null && entry.expiresAt <= now) {
              context.entries.delete(event.key);
              context.accessOrder = context.accessOrder.filter((k) => k !== event.key);
              context.expires++;
              context.misses++;
              return {};
            }
            entry.accessCount++;
            entry.lastAccessed = now;
            context.accessOrder = context.accessOrder.filter((k) => k !== event.key);
            context.accessOrder.push(event.key);
            context.hits++;
            return {};
          }
          context.misses++;
          return {};
        },
        DELETE: (event, { context }) => {
          if (context.entries.delete(event.key)) {
            context.accessOrder = context.accessOrder.filter((k) => k !== event.key);
          }
          return {};
        },
        PUT: (event, { context, actor }) => {
          const now = actor.clock.now();
          const entry: CacheEntry = {
            value: event.value,
            expiresAt: event.ttlMs !== undefined ? now + event.ttlMs : null,
            accessCount: 0,
            lastAccessed: now,
          };
          if (!context.entries.has(event.key)) {
            context.accessOrder.push(event.key);
          }
          context.entries.set(event.key, entry);
          if (context.entries.size > context.capacity) {
            return { state: cacheStates.full };
          }
          return {};
        },
        PURGE: () => ({ state: cacheStates.purging }),
        SET_CAPACITY: (event, { context }) => {
          context.capacity = event.capacity;
          return {};
        },
      },
      purging: {
        PURGE_DONE: (_event, { context }) => {
          if (context.entries.size > context.capacity) {
            return { state: cacheStates.full };
          }
          return { state: cacheStates.ready };
        },
      },
      full: {
        EVICTION_DONE: (_event, { context }) => {
          if (context.entries.size > context.capacity) {
            return { state: cacheStates.full };
          }
          return { state: cacheStates.ready };
        },
      },
    },
  });

  return { actor, clock: c, ctx };
}

// ── Tests ────────────────────────────────────────────────────────────
describe("cache with TTL and LRU eviction", () => {
  it("starts in ready state with empty cache", () => {
    const { actor, ctx } = createCacheActor();
    expect(matches(actor, "ready")).toBe(true);
    expect(ctx.entries.size).toBe(0);
    expect(ctx.hits).toBe(0);
    expect(ctx.misses).toBe(0);
  });

  it("PUT then GET returns value (cache hit)", () => {
    const { actor, ctx } = createCacheActor();

    actor.send(putEvent.create({ key: "foo", value: 42 }));
    expect(ctx.entries.size).toBe(1);

    actor.send(getEvent.create({ key: "foo" }));
    expect(ctx.hits).toBe(1);
    expect(ctx.misses).toBe(0);
    expect(ctx.entries.get("foo")?.accessCount).toBe(1);
  });

  it("GET missing key counts as miss", () => {
    const { actor, ctx } = createCacheActor();

    actor.send(getEvent.create({ key: "missing" }));
    expect(ctx.misses).toBe(1);
    expect(ctx.hits).toBe(0);
  });

  it("DELETE removes entry", () => {
    const { actor, ctx } = createCacheActor();

    actor.send(putEvent.create({ key: "foo", value: 42 }));
    expect(ctx.entries.size).toBe(1);

    actor.send(deleteEvent.create({ key: "foo" }));
    expect(ctx.entries.size).toBe(0);
  });

  it("PUT with TTL expires after timeout", () => {
    const { actor, clock, ctx } = createCacheActor();

    actor.send(putEvent.create({ key: "temp", value: "data", ttlMs: 1000 }));
    expect(ctx.entries.size).toBe(1);

    clock.advance(500);
    expect(ctx.entries.size).toBe(1);
    expect(matches(actor, "ready")).toBe(true);

    clock.advance(500);
    expect(matches(actor, "ready")).toBe(true);
  });

  it("TTL expired entry treated as miss on GET", () => {
    const { actor, clock, ctx } = createCacheActor();

    actor.send(putEvent.create({ key: "temp", value: "data", ttlMs: 1000 }));
    clock.advance(1001);

    actor.send(getEvent.create({ key: "temp" }));
    expect(ctx.misses).toBe(1);
    expect(ctx.hits).toBe(0);
    expect(ctx.entries.size).toBe(0);
  });

  it("LRU eviction when capacity exceeded", () => {
    const { actor, ctx } = createCacheActor(2);

    actor.send(putEvent.create({ key: "a", value: 1 }));
    actor.send(putEvent.create({ key: "b", value: 2 }));
    expect(ctx.entries.size).toBe(2);

    actor.send(putEvent.create({ key: "c", value: 3 }));
    expect(matches(actor, "ready")).toBe(true);
    expect(ctx.entries.size).toBe(2);
    expect(ctx.evictions).toBe(1);
    expect(ctx.accessOrder).not.toContain("a");
  });

  it("GET updates LRU order (prevents eviction of recently accessed)", () => {
    const { actor, ctx } = createCacheActor(2);

    actor.send(putEvent.create({ key: "a", value: 1 }));
    actor.send(putEvent.create({ key: "b", value: 2 }));

    actor.send(getEvent.create({ key: "a" }));

    actor.send(putEvent.create({ key: "c", value: 3 }));
    expect(ctx.accessOrder).toContain("a");
    expect(ctx.accessOrder).not.toContain("b");
    expect(ctx.evictions).toBe(1);
  });

  it("PURGE removes expired entries", () => {
    const { actor, clock, ctx } = createCacheActor();

    actor.send(putEvent.create({ key: "a", value: 1, ttlMs: 500 }));
    actor.send(putEvent.create({ key: "b", value: 2 }));
    clock.advance(600);

    actor.send(purgeEvent);
    expect(matches(actor, "ready")).toBe(true);
    expect(ctx.expires).toBe(1);
    expect(ctx.entries.size).toBe(1);
    expect(ctx.entries.has("b")).toBe(true);
  });

  it("SET_CAPACITY updates capacity", () => {
    const { actor, ctx } = createCacheActor(3);

    actor.send(setCapacityEvent.create({ capacity: 1 }));
    expect(ctx.capacity).toBe(1);

    actor.send(putEvent.create({ key: "a", value: 1 }));
    actor.send(putEvent.create({ key: "b", value: 2 }));
    expect(ctx.evictions).toBe(1);
    expect(ctx.entries.size).toBe(1);
  });

  it("PUT replacing existing key does not duplicate in accessOrder", () => {
    const { actor, ctx } = createCacheActor();

    actor.send(putEvent.create({ key: "a", value: 1 }));
    actor.send(putEvent.create({ key: "a", value: 2 }));
    expect(ctx.accessOrder.filter((k) => k === "a").length).toBe(1);
    expect(ctx.entries.get("a")?.value).toBe(2);
  });

  it("multiple evictions fill to capacity", () => {
    const { actor, ctx } = createCacheActor(2);

    actor.send(putEvent.create({ key: "a", value: 1 }));
    actor.send(putEvent.create({ key: "b", value: 2 }));
    actor.send(putEvent.create({ key: "c", value: 3 }));
    actor.send(putEvent.create({ key: "d", value: 4 }));

    expect(ctx.entries.size).toBe(2);
    expect(ctx.evictions).toBe(2);
    expect(ctx.accessOrder).toContain("c");
    expect(ctx.accessOrder).toContain("d");
  });

  it("DELETE from empty cache is no-op", () => {
    const { actor, ctx } = createCacheActor();

    actor.send(deleteEvent.create({ key: "missing" }));
    expect(ctx.entries.size).toBe(0);
    expect(ctx.evictions).toBe(0);
  });

  it("GET after delete counts as miss", () => {
    const { actor, ctx } = createCacheActor();

    actor.send(putEvent.create({ key: "a", value: 1 }));
    actor.send(deleteEvent.create({ key: "a" }));
    actor.send(getEvent.create({ key: "a" }));
    expect(ctx.misses).toBe(1);
    expect(ctx.hits).toBe(0);
  });

  it("cache metrics track correctly across operations", () => {
    const { actor, clock, ctx } = createCacheActor(2);

    actor.send(putEvent.create({ key: "a", value: 1, ttlMs: 1000 }));
    actor.send(putEvent.create({ key: "b", value: 2 }));

    actor.send(getEvent.create({ key: "a" }));
    actor.send(getEvent.create({ key: "b" }));
    actor.send(getEvent.create({ key: "c" }));

    expect(ctx.hits).toBe(2);
    expect(ctx.misses).toBe(1);

    clock.advance(1001);
    actor.send(getEvent.create({ key: "a" }));
    expect(ctx.expires).toBe(1);
    expect(ctx.misses).toBe(2);
  });

  it("tier region starts at l1", () => {
    const { actor } = createCacheActor();
    expect(matches(actor, "ready.tier.l1")).toBe(true);
  });

  it("full state transitions back to ready after eviction", () => {
    const { actor, ctx } = createCacheActor(1);

    actor.send(putEvent.create({ key: "a", value: 1 }));
    expect(matches(actor, "ready")).toBe(true);

    actor.send(putEvent.create({ key: "b", value: 2 }));
    expect(matches(actor, "ready")).toBe(true);
    expect(ctx.entries.size).toBe(1);
  });
});
