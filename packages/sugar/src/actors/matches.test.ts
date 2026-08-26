import { matches } from "./matches.ts";
import { Actor, type Snapshot, event, state } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";

function snap(...args: [path: string[], regions?: Record<string, Snapshot>]): Snapshot {
  const [path, regions] = args;
  return { path, context: {}, regions: regions ?? {} };
}

describe("matches", () => {
  test("returns true for an exact flat match", () => {
    const actor = { snapshot: () => snap(["idle"]) };
    expect(matches(actor, "idle")).toBe(true);
  });

  test("returns false for a wrong flat name", () => {
    const actor = { snapshot: () => snap(["idle"]) };
    expect(matches(actor, "active")).toBe(false);
  });

  test("returns true for a hierarchical prefix match", () => {
    const actor = {
      snapshot: () =>
        snap(["connected"], {
          default: snap(["active"]),
        }),
    };
    expect(matches(actor, "connected")).toBe(true);
  });

  test("returns true for a region key segment", () => {
    const actor = {
      snapshot: () =>
        snap(["connected"], {
          default: snap(["active"]),
        }),
    };
    expect(matches(actor, "connected.default")).toBe(true);
  });

  test("returns true for a full hierarchical path match", () => {
    const actor = {
      snapshot: () =>
        snap(["connected"], {
          default: snap(["active"]),
        }),
    };
    expect(matches(actor, "connected.default.active")).toBe(true);
  });

  test("returns false for a wrong region state", () => {
    const actor = {
      snapshot: () =>
        snap(["connected"], {
          default: snap(["active"]),
        }),
    };
    expect(matches(actor, "connected.default.idle")).toBe(false);
  });

  test("returns false for an unknown region key", () => {
    const actor = {
      snapshot: () =>
        snap(["connected"], {
          default: snap(["active"]),
        }),
    };
    expect(matches(actor, "connected.nonexistent")).toBe(false);
  });

  test("returns true for region chains across parallel regions", () => {
    const actor = {
      snapshot: () =>
        snap(["player"], {
          playback: snap(["playing"]),
          audio: snap(["muted"]),
        }),
    };
    expect(matches(actor, "player.playback.playing")).toBe(true);
    expect(matches(actor, "player.audio.muted")).toBe(true);
    expect(matches(actor, "player.playback.paused")).toBe(false);
  });

  test("returns true for a parallel top-level prefix", () => {
    const actor = {
      snapshot: () =>
        snap(["player"], {
          playback: snap(["playing"]),
          audio: snap(["muted"]),
        }),
    };
    expect(matches(actor, "player")).toBe(true);
  });

  test("returns false for an empty pattern", () => {
    const actor = { snapshot: () => snap(["idle"]) };
    expect(matches(actor, "")).toBe(false);
  });

  test("returns false for a trailing dot pattern", () => {
    const actor = { snapshot: () => snap(["idle"]) };
    expect(matches(actor, "idle.")).toBe(false);
  });

  test("returns false for a wrong top-level name", () => {
    const actor = {
      snapshot: () =>
        snap(["player"], {
          playback: snap(["playing"]),
        }),
    };
    expect(matches(actor, "connected")).toBe(false);
  });

  test("returns true for every prefix of a deep nesting chain", () => {
    const actor = {
      snapshot: () =>
        snap(["root"], {
          level1: snap(["mid"], {
            level2: snap(["leaf"]),
          }),
        }),
    };
    expect(matches(actor, "root")).toBe(true);
    expect(matches(actor, "root.level1")).toBe(true);
    expect(matches(actor, "root.level1.mid")).toBe(true);
    expect(matches(actor, "root.level1.mid.level2")).toBe(true);
    expect(matches(actor, "root.level1.mid.level2.leaf")).toBe(true);
    expect(matches(actor, "root.level1.mid.level2.deep")).toBe(false);
  });

  test("updates match results after a real Actor transitions", () => {
    const toggle = event("toggled")();
    const off = state("off")();
    const onState = state("on")();

    const light = Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: {},
      states: [off, onState],
      initial: off,
      setup: (m) => {
        m.on(off, { eventRef: toggle, handler: () => ({ state: onState }) });
        m.on(onState, { eventRef: toggle, handler: () => ({ state: off }) });
      },
    });

    expect(matches(light, "off")).toBe(true);
    expect(matches(light, "on")).toBe(false);

    light.send(toggle.create());

    expect(matches(light, "off")).toBe(false);
    expect(matches(light, "on")).toBe(true);
  });
});
