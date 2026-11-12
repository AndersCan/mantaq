import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";
import { createDriver } from "./drive.ts";
import type { FuzzTarget } from "./fuzz/run.ts";

describe("dryRun copy", () => {
  test("a real-mode driver's copy holds effect bodies: a dry run runs none", () => {
    const charged: string[] = [];
    const go = event("go")();
    const idle = state("idle")();
    const charging = state("charging")();
    const target: FuzzTarget = {
      id: "charge",
      create: () => {
        const clock = VirtualClock();
        const actor = Actor({
          inputs: [go],
          states: [idle, charging],
          initial: idle,
          clock,
          setup: (m) => {
            m.on(idle, { event: go, to: [charging], handler: () => ({ state: charging }) });
            m.on(charging, { event: go, to: [], handler: () => ({}) });
            m.effect(charging, {
              name: "charge",
              sends: [],
              fn: () => {
                charged.push("card");
              },
            });
          },
        });
        return { actor, clock };
      },
    };
    const driver = createDriver(target, { effectMode: "real" });
    driver.step({ kind: "event", event: "go", payload: null });
    expect(charged).toEqual(["card"]);
    driver.dryRun?.([{ kind: "event", event: "go", payload: null }]);
    expect(charged).toEqual(["card"]);
  });
});

describe("dryRun drift", () => {
  const loaded = event("loaded")();
  const counted = event("counted")();
  const go = event("go")();
  const loading = state("loading")();
  const ready = state("ready")();
  const done = state("done")();
  const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  // First-state effects run for real even in held mode; an async one lands on the live actor
  // after it was built, and the copy is disposed before its own result arrives.
  const asyncFirst = (reply: "state" | "context"): FuzzTarget => ({
    id: `first-${reply}`,
    create: () => {
      const clock = VirtualClock();
      const actor = Actor({
        inputs: [go],
        internal: [loaded, counted],
        states: [loading, ready, done],
        initial: loading,
        clock,
        context: { n: 0 },
        setup: (m) => {
          m.effect(loading, {
            name: "load",
            sends: [loaded, counted],
            fn: async ({ emit }) => {
              await Promise.resolve();
              emit(reply === "state" ? loaded.create() : counted.create());
            },
          });
          m.on(loading, { event: loaded, to: [ready], handler: () => ({ state: ready }) });
          m.on(loading, {
            event: counted,
            to: [],
            handler: (_e, { context }) => {
              context.set({ n: context.get().n + 1 });
              return {};
            },
          });
          m.on(loading, { event: go, to: [done], handler: () => ({ state: done }) });
          m.on(ready, { event: go, to: [done], handler: () => ({ state: done }) });
        },
      });
      return { actor, clock };
    },
  });
  const goStep = { kind: "event", event: "go", payload: null } as const;

  test("a copy that did not reach the live state gives null", async () => {
    const driver = createDriver(asyncFirst("state"));
    await macrotask();
    expect(driver.step({ kind: "advance", ms: 0 }).state).toBe("ready");
    expect(driver.dryRun?.([goStep])).toEqual([null]);
  });

  test("a copy that did not reach the live context gives null", async () => {
    const driver = createDriver(asyncFirst("context"));
    await macrotask();
    expect(driver.step({ kind: "advance", ms: 0 }).context).toEqual({ n: 1 });
    expect(driver.dryRun?.([goStep])).toEqual([null]);
  });
});

describe("dryRun region drift", () => {
  const dropped = event("dropped")();
  const go = event("go")();
  const online = state("online")();
  const offline = state("offline")();
  const idle = state("idle")();
  const done = state("done")();
  const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const target: FuzzTarget = {
    id: "region-first",
    create: () => {
      const clock = VirtualClock();
      const network = Actor({
        clock,
        inputs: [],
        internal: [dropped],
        states: [online, offline],
        initial: online,
        setup: (m) => {
          m.effect(online, {
            name: "watch",
            sends: [dropped],
            fn: async ({ emit }) => {
              await Promise.resolve();
              emit(dropped.create());
            },
          });
          m.on(online, { event: dropped, to: [offline], handler: () => ({ state: offline }) });
        },
      });
      const actor = Actor({
        clock,
        inputs: [go],
        states: [idle, done],
        initial: idle,
        regions: { network },
        setup: (m) => {
          m.on(idle, { event: go, to: [done], handler: () => ({ state: done }) });
        },
      });
      return { actor, clock };
    },
  };

  test("a copy whose region did not reach the live region gives null", async () => {
    const driver = createDriver(target);
    await macrotask();
    expect(driver.step({ kind: "advance", ms: 0 }).regions).toEqual({
      network: "network.offline",
    });
    expect(driver.dryRun?.([{ kind: "event", event: "go", payload: null }])).toEqual([null]);
  });
});
