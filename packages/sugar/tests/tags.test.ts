import { expect, test, describe } from "vite-plus/test";
import { state } from "@mantaq/core";
import { tag } from "../src/tags.ts";
import type { Snapshot } from "@mantaq/core";

describe("tag", () => {
  test("matches flat state", () => {
    const idle = state("idle")();
    const loading = state("loading")();

    const t = tag(idle, loading);
    const snap: Snapshot = { path: ["idle"], regions: {} };

    expect(t.has(snap)).toBe(true);
  });

  test("does not match wrong state", () => {
    const idle = state("idle")();
    const loading = state("loading")();

    const t = tag(idle, loading);
    const snap: Snapshot = { path: ["done"], regions: {} };

    expect(t.has(snap)).toBe(false);
  });

  test("matches hierarchical — in region", () => {
    const connected = state("connected")();

    const t = tag(connected);
    const snap: Snapshot = {
      path: ["connected"],
      regions: { default: { path: ["active"], regions: {} } },
    };

    expect(t.has(snap)).toBe(true);
  });

  test("matches hierarchical — region child", () => {
    const active = state("active")();

    const t = tag(active);
    const snap: Snapshot = {
      path: ["connected"],
      regions: { default: { path: ["active"], regions: {} } },
    };

    expect(t.has(snap)).toBe(true);
  });

  test("does not match wrong region state", () => {
    const idle = state("idle")();

    const t = tag(idle);
    const snap: Snapshot = {
      path: ["connected"],
      regions: { default: { path: ["active"], regions: {} } },
    };

    expect(t.has(snap)).toBe(false);
  });

  test("parallel — matches any region", () => {
    const playing = state("playing")();
    const muted = state("muted")();

    const t = tag(playing, muted);
    const snap: Snapshot = {
      path: ["player"],
      regions: {
        playback: { path: ["playing"], regions: {} },
        audio: { path: ["muted"], regions: {} },
      },
    };

    expect(t.has(snap)).toBe(true);
  });

  test("parallel — no match", () => {
    const idle = state("idle")();

    const t = tag(idle);
    const snap: Snapshot = {
      path: ["player"],
      regions: {
        playback: { path: ["playing"], regions: {} },
        audio: { path: ["muted"], regions: {} },
      },
    };

    expect(t.has(snap)).toBe(false);
  });

  test("deep nesting", () => {
    const leaf = state("leaf")();

    const t = tag(leaf);
    const snap: Snapshot = {
      path: ["root"],
      regions: {
        level1: {
          path: ["mid"],
          regions: {
            level2: { path: ["leaf"], regions: {} },
          },
        },
      },
    };

    expect(t.has(snap)).toBe(true);
  });
});
