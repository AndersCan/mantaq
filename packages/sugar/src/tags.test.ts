import { tag } from "./tags.ts";
import { state } from "@mantaq/core";
import type { Snapshot } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";

describe("tag", () => {
  test("returns true when a tagged state is active at the top level", () => {
    const idle = state("idle")();
    const loading = state("loading")();

    const tagged = tag(idle, loading);
    const snap: Snapshot = { path: ["idle"], regions: {}, context: {} };

    expect(tagged.has(snap)).toBe(true);
  });

  test("returns false when no tagged state is active", () => {
    const idle = state("idle")();
    const loading = state("loading")();

    const tagged = tag(idle, loading);
    const snap: Snapshot = { path: ["done"], regions: {}, context: {} };

    expect(tagged.has(snap)).toBe(false);
  });

  test("returns true for a tag matching its own region parent name", () => {
    const connected = state("connected")();

    const tagged = tag(connected);
    const snap: Snapshot = {
      path: ["connected"],
      context: {},
      regions: { default: { path: ["active"], regions: {}, context: {} } },
    };

    expect(tagged.has(snap)).toBe(true);
  });

  test("returns true when a tagged state is active inside a region", () => {
    const active = state("active")();

    const tagged = tag(active);
    const snap: Snapshot = {
      path: ["connected"],
      context: {},
      regions: { default: { path: ["active"], regions: {}, context: {} } },
    };

    expect(tagged.has(snap)).toBe(true);
  });

  test("returns false when only untagged states are active in regions", () => {
    const idle = state("idle")();

    const tagged = tag(idle);
    const snap: Snapshot = {
      path: ["connected"],
      context: {},
      regions: { default: { path: ["active"], regions: {}, context: {} } },
    };

    expect(tagged.has(snap)).toBe(false);
  });

  test("returns true when any parallel region holds a tagged state", () => {
    const playing = state("playing")();
    const muted = state("muted")();

    const tagged = tag(playing, muted);
    const snap: Snapshot = {
      path: ["player"],
      context: {},
      regions: {
        playback: { path: ["playing"], regions: {}, context: {} },
        audio: { path: ["muted"], regions: {}, context: {} },
      },
    };

    expect(tagged.has(snap)).toBe(true);
  });

  test("returns false when no parallel region holds a tagged state", () => {
    const idle = state("idle")();

    const tagged = tag(idle);
    const snap: Snapshot = {
      path: ["player"],
      context: {},
      regions: {
        playback: { path: ["playing"], regions: {}, context: {} },
        audio: { path: ["muted"], regions: {}, context: {} },
      },
    };

    expect(tagged.has(snap)).toBe(false);
  });

  test("returns true for a tagged state nested multiple regions deep", () => {
    const leaf = state("leaf")();

    const tagged = tag(leaf);
    const snap: Snapshot = {
      path: ["root"],
      context: {},
      regions: {
        level1: {
          path: ["mid"],
          context: {},
          regions: {
            level2: { path: ["leaf"], regions: {}, context: {} },
          },
        },
      },
    };

    expect(tagged.has(snap)).toBe(true);
  });
});
