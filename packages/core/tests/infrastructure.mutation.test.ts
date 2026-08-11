import { expect, test, describe, vi } from "vite-plus/test";
import { trackAbort, clearAbort } from "../src/abort-tracker.ts";
import type { InternalEvent } from "../src/event.ts";
import type { ActorInternal } from "../src/internal-registry.ts";
import {
  registerActor,
  getChildren,
  getOutputHandler,
  setOutputHandler,
  pushInternal,
  drainInternal,
  abortEffects,
} from "../src/internal-registry.ts";
import { InternalQueue } from "../src/queue.ts";
import { Subscribers } from "../src/subscribers.ts";

function makeInternal(): ActorInternal {
  const children = new Map<string, never>();
  let handler: ((event: InternalEvent) => void) | null = null;
  let drained = 0;
  let aborted = 0;
  const pushed: InternalEvent[] = [];
  return {
    children,
    getOutputHandler: () => handler,
    setOutputHandler: (fn) => {
      handler = fn;
    },
    pushInternal: (e) => {
      pushed.push(e);
    },
    drainInternal: () => {
      drained++;
    },
    abortEffects: () => {
      aborted++;
    },
  };
}

describe("abort-tracker directed mutation tests", () => {
  test("trackAbort deletes the entry from the map when the signal aborts", () => {
    const map = new Map<number, { signal?: AbortSignal }>();
    const controller = new AbortController();
    map.set(1, { signal: controller.signal });
    trackAbort(controller.signal, 1, map);
    controller.abort();
    expect(map.has(1)).toBe(false);
  });

  test("trackAbort returns undefined without a signal", () => {
    const map = new Map<number, { signal?: AbortSignal }>();
    expect(trackAbort(undefined, 1, map)).toBeUndefined();
  });

  test("clearAbort removes the abort listener so a later abort keeps the entry", () => {
    const map = new Map<number, { signal?: AbortSignal; onAbort?: () => void }>();
    const controller = new AbortController();
    const onAbort = trackAbort(controller.signal, 1, map) as () => void;
    const timer = { signal: controller.signal, onAbort };
    map.set(1, timer);
    clearAbort(timer);
    controller.abort();
    expect(map.has(1)).toBe(true);
  });

  test("clearAbort on an entry without a signal does not throw", () => {
    clearAbort({});
  });
});

describe("internal-registry directed mutation tests", () => {
  test("unregistered actors return the not-registered Left for every helper", () => {
    const victim = {};
    const message = /not registered/;
    expect(getChildren(victim)[0]?.message).toMatch(message);
    expect(getOutputHandler(victim)[0]?.message).toMatch(message);
    expect(pushInternal(victim, { type: "X" })[0]?.message).toMatch(message);
    expect(drainInternal(victim)[0]?.message).toMatch(message);
    expect(abortEffects(victim)[0]?.message).toMatch(message);
  });

  test("setOutputHandler on an unregistered actor returns Left", () => {
    const victim = {};
    expect(setOutputHandler(victim, () => {})[0]?.message).toMatch(/not registered/);
  });

  test("registered actors route every helper to their internal", () => {
    const internal = makeInternal();
    const actor = {};
    registerActor(actor, internal);
    expect(getChildren(actor)[1]).toBe(internal.children);
    const fn = () => {};
    setOutputHandler(actor, fn);
    expect(getOutputHandler(actor)[1]).toBe(fn);
    pushInternal(actor, { type: "P" });
    drainInternal(actor);
    abortEffects(actor);
    expect(internal).toBeDefined();
  });
});

describe("InternalQueue directed mutation tests", () => {
  test("settled while processing resolves once the drain finishes", async () => {
    const queue = new InternalQueue();
    queue.push({ type: "A" });
    let resolved = false;
    const p = queue.settled();
    void p.then(() => {
      resolved = true;
    });
    queue.process(() => {});
    await p;
    expect(resolved).toBe(true);
  });

  test("multiple settled callers all resolve", async () => {
    const queue = new InternalQueue();
    queue.push({ type: "A" });
    const p1 = queue.settled();
    const p2 = queue.settled();
    queue.process(() => {});
    await Promise.all([p1, p2]);
  });

  test("events pushed during processing are drained in the same pass", () => {
    const queue = new InternalQueue();
    const seen: string[] = [];
    queue.push({ type: "A" });
    queue.process((e) => {
      seen.push(e.type);
      if (e.type === "A") queue.push({ type: "B" });
    });
    expect(seen).toEqual(["A", "B"]);
  });

  test("processCancellable stopping mid-drain drops the remaining events", () => {
    const queue = new InternalQueue();
    const seen: string[] = [];
    queue.push({ type: "A" }, { type: "B" }, { type: "C" });
    queue.processCancellable((e) => {
      seen.push(e.type);
      return e.type !== "B";
    });
    expect(seen).toEqual(["A", "B"]);
    expect(queue.length).toBe(0);
  });
});

describe("Subscribers directed mutation tests", () => {
  test("clear removes change and done subscribers", () => {
    const subs = new Subscribers<unknown>();
    let changes = 0;
    let dones = 0;
    subs.addChange(() => changes++);
    subs.addDone(() => dones++);
    subs.clear();
    subs.emitChange({ path: ["idle"], context: {}, regions: {} });
    subs.emitDone();
    expect(changes).toBe(0);
    expect(dones).toBe(0);
  });
});

describe("internal-registry directed mutation tests 2", () => {
  test("unregistered actors return the exact not-registered message", () => {
    const victim = {};
    const expected = "[mantaq] actor is not registered with the internal registry";
    expect(getChildren(victim)).toEqual([{ message: expected }, undefined]);
    expect(getOutputHandler(victim)).toEqual([{ message: expected }, undefined]);
    expect(pushInternal(victim, { type: "X" })).toEqual([{ message: expected }, undefined]);
    expect(drainInternal(victim)).toEqual([{ message: expected }, undefined]);
    expect(abortEffects(victim)).toEqual([{ message: expected }, undefined]);
  });

  test("a pre-existing global registry is preserved on module load", async () => {
    const key = "__mantaqCoreInternalRegistry";
    const original = (globalThis as Record<string, unknown>)[key];
    try {
      (globalThis as Record<string, unknown>)[key] = 1;
      vi.resetModules();
      const mod = await import("../src/internal-registry.ts");
      expect(() => mod.registerActor({}, makeInternal())).toThrow();
    } finally {
      (globalThis as Record<string, unknown>)[key] = original;
    }
  });
});
