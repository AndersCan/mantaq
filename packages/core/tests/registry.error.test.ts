import { expect, test, describe, vi } from "vite-plus/test";
import type { ActorInternal } from "../src/internal-registry.ts";
import {
  getChildren,
  getOutputHandler,
  pushInternal,
  drainInternal,
  abortEffects,
} from "../src/internal-registry.ts";

describe("internal-registry error paths", () => {
  test("registry helpers return Left for unregistered actors", () => {
    const victim = {};
    expect(getChildren(victim)[0]?.message).toMatch(/not registered/);
    expect(getOutputHandler(victim)[0]?.message).toMatch(/not registered/);
    expect(pushInternal(victim, { type: "X" })[0]?.message).toMatch(/not registered/);
    expect(drainInternal(victim)[0]?.message).toMatch(/not registered/);
    expect(abortEffects(victim)[0]?.message).toMatch(/not registered/);
  });

  test("registry assignment preserves a pre-existing global registry", async () => {
    const key = "__mantaqCoreInternalRegistry";
    const original = (globalThis as Record<string, unknown>)[key];
    const internal: ActorInternal = {
      children: new Map(),
      getOutputHandler: () => null,
      setOutputHandler: () => {},
      pushInternal: () => {},
      drainInternal: () => {},
      abortEffects: () => {},
    };
    try {
      (globalThis as Record<string, unknown>)[key] = 1;
      vi.resetModules();
      const mod = await import("../src/internal-registry.ts");
      expect(() => mod.registerActor({}, internal)).toThrow();
    } finally {
      (globalThis as Record<string, unknown>)[key] = original;
    }
  });

  test("a fresh registry instance reports the unregistered error message", async () => {
    const key = "__mantaqCoreInternalRegistry";
    const original = (globalThis as Record<string, unknown>)[key];
    try {
      (globalThis as Record<string, unknown>)[key] = new WeakMap();
      vi.resetModules();
      const mod = await import("../src/internal-registry.ts");
      expect(mod.getChildren({})[0]?.message).toMatch(/not registered/);
    } finally {
      (globalThis as Record<string, unknown>)[key] = original;
    }
  });
});
