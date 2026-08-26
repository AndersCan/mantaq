import {
  createActorMap,
  isIn,
  activeLeaves,
  matches,
  tag,
  states,
  events,
  onOutput,
} from "./main.ts";
import { Actor, event, state } from "@mantaq/core";
import type { Snapshot } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";

function snap(...args: [path: string[], regions?: Record<string, Snapshot>]): Snapshot {
  const [path, regions] = args;
  return { path, context: {}, regions: regions ?? {} };
}

describe("sugar re-exports", () => {
  describe("isIn", () => {
    test("returns true for a matching flat state", () => {
      const snapshot = snap(["idle"]);
      expect(isIn(snapshot, "idle")).toBe(true);
    });

    test("returns false for a wrong flat state", () => {
      const snapshot = snap(["idle"]);
      expect(isIn(snapshot, "active")).toBe(false);
    });

    test("returns true for names matched at the root or inside a region", () => {
      const snapshot = snap(["connected"], { default: snap(["active"]) });
      expect(isIn(snapshot, "connected")).toBe(true);
      expect(isIn(snapshot, "active")).toBe(true);
    });

    test("returns false when the name is missing everywhere", () => {
      const snapshot = snap(["connected"], { default: snap(["active"]) });
      expect(isIn(snapshot, "idle")).toBe(false);
    });
  });

  describe("activeLeaves", () => {
    test("returns the single path for a flat snapshot", () => {
      const snapshot = snap(["idle"]);
      expect(activeLeaves(snapshot)).toEqual(["idle"]);
    });

    test("returns one dotted path through a region", () => {
      const snapshot = snap(["connected"], { default: snap(["active"]) });
      expect(activeLeaves(snapshot)).toEqual(["connected.default.active"]);
    });

    test("returns one leaf per parallel region", () => {
      const snapshot = snap(["player"], {
        playback: snap(["playing"]),
        audio: snap(["muted"]),
      });
      expect(activeLeaves(snapshot).sort()).toEqual([
        "player.audio.muted",
        "player.playback.playing",
      ]);
    });

    test("returns a dotted path through nested regions", () => {
      const snapshot = snap(["root"], {
        level1: snap(["mid"], { level2: snap(["leaf"]) }),
      });
      expect(activeLeaves(snapshot)).toEqual(["root.level1.mid.level2.leaf"]);
    });
  });

  describe("matches (from sugar barrel)", () => {
    test("returns true only for the active flat state", () => {
      const actor = { snapshot: () => snap(["idle"]) };
      expect(matches(actor, "idle")).toBe(true);
      expect(matches(actor, "active")).toBe(false);
    });

    test("returns true for hierarchical prefix and full path patterns", () => {
      const actor = {
        snapshot: () => snap(["connected"], { default: snap(["active"]) }),
      };
      expect(matches(actor, "connected")).toBe(true);
      expect(matches(actor, "connected.default.active")).toBe(true);
    });
  });

  describe("tag (from sugar barrel)", () => {
    test("returns true when a tagged state is active", () => {
      const idle = state("idle")();
      const loading = state("loading")();
      const tagged = tag(idle, loading);
      const snapshot: Snapshot = { path: ["idle"], context: {}, regions: {} };
      expect(tagged.has(snapshot)).toBe(true);
    });

    test("returns false when no tagged state is active", () => {
      const idle = state("idle")();
      const tagged = tag(idle);
      const snapshot: Snapshot = { path: ["done"], context: {}, regions: {} };
      expect(tagged.has(snapshot)).toBe(false);
    });

    test("returns true when a tagged state is active in a region", () => {
      const active = state("active")();
      const tagged = tag(active);
      const snapshot: Snapshot = {
        path: ["connected"],
        context: {},
        regions: { default: { path: ["active"], regions: {}, context: {} } },
      };
      expect(tagged.has(snapshot)).toBe(true);
    });
  });

  describe("createActorMap (from sugar barrel)", () => {
    test("creates children keyed by id and returns their keys", () => {
      const off = state("off")();
      const onState = state("on")();
      const toggle = event("toggle")();
      const map = createActorMap(() =>
        Actor({
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
        }),
      );
      map.spawn("a");
      expect(map.keys()).toEqual(["a"]);
    });
  });

  describe("states (from sugar barrel)", () => {
    test("creates multiple state refs keyed by name", () => {
      const refs = states("idle", "loading", "success");
      expect([refs.idle.name, refs.loading.name, refs.success.name]).toEqual([
        "idle",
        "loading",
        "success",
      ]);
    });
  });

  describe("events (from sugar barrel)", () => {
    test("creates multiple event refs keyed by name", () => {
      const refs = events("click", "submit");
      expect([refs.click.type, refs.submit.type]).toEqual(["click", "submit"]);
    });
  });

  describe("onOutput (from sugar barrel)", () => {
    test("calls the handler with a child's emitted outputs", () => {
      const done = event("done")<{ ok: boolean }>();
      const goEvent = event("go")();
      const off = state("off")();
      const finished = state("finished")();

      const child = Actor({
        inputs: [goEvent],
        outputs: [done],
        states: [off, finished],
        initial: off,
        setup: (m) => {
          m.on(off, {
            eventRef: goEvent,
            handler: () => ({ state: finished, emit: [done.create({ ok: true })] }),
          });
        },
      });

      const received: Array<{ type: string; payload?: unknown }> = [];
      onOutput(child, (e) => received.push(e));

      child.send(goEvent.create());
      expect(received).toEqual([{ type: "done", payload: { ok: true } }]);
    });
  });
});
