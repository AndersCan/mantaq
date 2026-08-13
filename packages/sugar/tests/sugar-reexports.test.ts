import { expect, test, describe } from "vite-plus/test";
import { Actor, type Snapshot, event, state } from "@mantaq/core";
import {
  isIn,
  activeLeaves,
  matches,
  tag,
  ActorMap,
  states,
  events,
  onOutput,
} from "../src/index.ts";

function snap(path: string[], regions: Record<string, Snapshot> = {}): Snapshot {
  return { path, context: {}, regions };
}

describe("sugar re-exports", () => {
  describe("isIn", () => {
    test("matches flat state", () => {
      const s = snap(["idle"]);
      expect(isIn(s, "idle")).toBe(true);
    });

    test("rejects wrong flat state", () => {
      const s = snap(["idle"]);
      expect(isIn(s, "active")).toBe(false);
    });

    test("matches in region", () => {
      const s = snap(["connected"], { default: snap(["active"]) });
      expect(isIn(s, "connected")).toBe(true);
      expect(isIn(s, "active")).toBe(true);
    });

    test("rejects missing region", () => {
      const s = snap(["connected"], { default: snap(["active"]) });
      expect(isIn(s, "idle")).toBe(false);
    });
  });

  describe("activeLeaves", () => {
    test("flat snapshot", () => {
      const s = snap(["idle"]);
      expect(activeLeaves(s)).toEqual(["idle"]);
    });

    test("with one region", () => {
      const s = snap(["connected"], { default: snap(["active"]) });
      expect(activeLeaves(s)).toEqual(["connected.default.active"]);
    });

    test("parallel regions", () => {
      const s = snap(["player"], {
        playback: snap(["playing"]),
        audio: snap(["muted"]),
      });
      const leaves = activeLeaves(s);
      expect(leaves).toContain("player.playback.playing");
      expect(leaves).toContain("player.audio.muted");
    });

    test("deep nesting", () => {
      const s = snap(["root"], {
        level1: snap(["mid"], { level2: snap(["leaf"]) }),
      });
      expect(activeLeaves(s)).toEqual(["root.level1.mid.level2.leaf"]);
    });
  });

  describe("matches (from sugar barrel)", () => {
    test("flat match", () => {
      const actor = { snapshot: () => snap(["idle"]) };
      expect(matches(actor, "idle")).toBe(true);
      expect(matches(actor, "active")).toBe(false);
    });

    test("hierarchical match", () => {
      const actor = {
        snapshot: () => snap(["connected"], { default: snap(["active"]) }),
      };
      expect(matches(actor, "connected")).toBe(true);
      expect(matches(actor, "connected.default.active")).toBe(true);
    });
  });

  describe("tag (from sugar barrel)", () => {
    test("matches flat state", () => {
      const idle = state("idle")();
      const loading = state("loading")();
      const t = tag(idle, loading);
      const s: Snapshot = { path: ["idle"], context: {}, regions: {} };
      expect(t.has(s)).toBe(true);
    });

    test("does not match wrong state", () => {
      const idle = state("idle")();
      const t = tag(idle);
      const s: Snapshot = { path: ["done"], context: {}, regions: {} };
      expect(t.has(s)).toBe(false);
    });

    test("matches in region", () => {
      const active = state("active")();
      const t = tag(active);
      const s: Snapshot = {
        path: ["connected"],
        context: {},
        regions: { default: { path: ["active"], regions: {}, context: {} } },
      };
      expect(t.has(s)).toBe(true);
    });
  });

  describe("ActorMap (from sugar barrel)", () => {
    test("spawn and keys", () => {
      const off = state("off")();
      const on = state("on")();
      const toggle = event("toggle")();
      const map = new ActorMap(
        () =>
          new Actor({
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
          }),
      );
      map.spawn("a");
      expect(map.keys()).toEqual(["a"]);
    });
  });

  describe("states (from sugar barrel)", () => {
    test("creates multiple state refs", () => {
      const s = states("idle", "loading", "success");
      expect(s.idle.name).toBe("idle");
      expect(s.loading.name).toBe("loading");
      expect(s.success.name).toBe("success");
    });
  });

  describe("events (from sugar barrel)", () => {
    test("creates multiple event refs", () => {
      const e = events("click", "submit");
      expect(e.click.type).toBe("click");
      expect(e.submit.type).toBe("submit");
    });
  });

  describe("onOutput (from sugar barrel)", () => {
    test("delivers a child's emitted outputs to the handler", () => {
      const done = event("done")<{ ok: boolean }>();
      const go = event("go")();
      const off = state("off")();
      const finished = state("finished")();

      const child = new Actor({
        inputs: [go],
        outputs: [done],
        states: [off, finished],
        initial: off,
        setup: (m) => {
          m.on(off, go, () => ({ state: finished, emit: [done.create({ ok: true })] }));
        },
      });

      const received: Array<{ type: string; payload?: unknown }> = [];
      onOutput(child, (e) => received.push(e));

      child.send(go.create());
      expect(received).toEqual([{ type: "done", payload: { ok: true } }]);
    });
  });
});
