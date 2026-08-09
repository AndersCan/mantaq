import { expect, test, describe } from "vite-plus/test";
import { Actor, type Snapshot, event, state } from "@mantaq/core";
import { matches } from "../src/actors/matches.ts";

function snap(path: string[], regions: Record<string, Snapshot> = {}): Snapshot {
  return { path, context: {}, regions };
}

describe("matches", () => {
  test("flat — exact match", () => {
    const actor = { snapshot: () => snap(["idle"]) };
    expect(matches(actor, "idle")).toBe(true);
  });

  test("flat — wrong name", () => {
    const actor = { snapshot: () => snap(["idle"]) };
    expect(matches(actor, "active")).toBe(false);
  });

  test("hierarchical — prefix match", () => {
    const actor = {
      snapshot: () =>
        snap(["connected"], {
          default: snap(["active"]),
        }),
    };
    expect(matches(actor, "connected")).toBe(true);
  });

  test("hierarchical — region key match", () => {
    const actor = {
      snapshot: () =>
        snap(["connected"], {
          default: snap(["active"]),
        }),
    };
    expect(matches(actor, "connected.default")).toBe(true);
  });

  test("hierarchical — full path match", () => {
    const actor = {
      snapshot: () =>
        snap(["connected"], {
          default: snap(["active"]),
        }),
    };
    expect(matches(actor, "connected.default.active")).toBe(true);
  });

  test("hierarchical — wrong region state", () => {
    const actor = {
      snapshot: () =>
        snap(["connected"], {
          default: snap(["active"]),
        }),
    };
    expect(matches(actor, "connected.default.idle")).toBe(false);
  });

  test("hierarchical — unknown region key", () => {
    const actor = {
      snapshot: () =>
        snap(["connected"], {
          default: snap(["active"]),
        }),
    };
    expect(matches(actor, "connected.nonexistent")).toBe(false);
  });

  test("parallel — region chain", () => {
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

  test("parallel — top-level prefix", () => {
    const actor = {
      snapshot: () =>
        snap(["player"], {
          playback: snap(["playing"]),
          audio: snap(["muted"]),
        }),
    };
    expect(matches(actor, "player")).toBe(true);
  });

  test("empty pattern", () => {
    const actor = { snapshot: () => snap(["idle"]) };
    expect(matches(actor, "")).toBe(false);
  });

  test("trailing dot", () => {
    const actor = { snapshot: () => snap(["idle"]) };
    expect(matches(actor, "idle.")).toBe(false);
  });

  test("wrong top-level", () => {
    const actor = {
      snapshot: () =>
        snap(["player"], {
          playback: snap(["playing"]),
        }),
    };
    expect(matches(actor, "connected")).toBe(false);
  });

  test("deep nesting", () => {
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

  test("works with real Actor", () => {
    const toggle = event("toggled")();
    const off = state("off")();
    const on = state("on")();

    const light = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: {},
      states: [off, on],
      initial: off,
      setup: (m) => {
        m.on(off, toggle, () => ({ state: on }));
        m.on(on, toggle, () => ({ state: off }));
      },
    });

    expect(matches(light, "off")).toBe(true);
    expect(matches(light, "on")).toBe(false);

    light.send(toggle.create());

    expect(matches(light, "off")).toBe(false);
    expect(matches(light, "on")).toBe(true);
  });
});
