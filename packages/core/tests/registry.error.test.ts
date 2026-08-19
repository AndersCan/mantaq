import { expect, test, describe, vi } from "vite-plus/test";
import type { ActorInternal } from "../src/internal-registry.ts";
import {
  registerActor,
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

  test("registration survives module reload so a second core copy sees the internals", async () => {
    const actor = {};
    const internal: ActorInternal = {
      children: new Map(),
      getOutputHandler: () => null,
      setOutputHandler: () => {},
      pushInternal: () => {},
      drainInternal: () => {},
      abortEffects: () => {},
    };
    registerActor(actor, internal);
    vi.resetModules();
    const mod = await import("../src/internal-registry.ts");
    expect(mod.getChildren(actor)[1]).toBe(internal.children);
  });

  test("a fresh module load still reports the unregistered error message", async () => {
    vi.resetModules();
    const mod = await import("../src/internal-registry.ts");
    expect(mod.getChildren({})[0]?.message).toMatch(/not registered/);
  });
});
