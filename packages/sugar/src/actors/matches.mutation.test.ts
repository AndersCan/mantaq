import { matches } from "./matches.ts";
import type { Snapshot } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";

function snap(...args: [path: string[], regions?: Record<string, Snapshot>]): Snapshot {
  const [path, regions] = args;
  return { path, context: {}, regions: regions ?? {} };
}

describe("matches — mutation tests", () => {
  describe("dot separator in join (join('.') → join(''))", () => {
    test("returns true when a state with a dotted name matches a dotted pattern", () => {
      const actor = { snapshot: () => snap(["a.b"]) };
      expect(matches(actor, "a.b")).toBe(true);
    });

    test("returns false for the concatenated form of a dotted state name", () => {
      const actor = { snapshot: () => snap(["a.b"]) };
      expect(matches(actor, "ab")).toBe(false);
    });

    test("returns true for a hierarchical match through a region with a dotted state name", () => {
      const actor = {
        snapshot: () =>
          snap(["root"], {
            sub: snap(["a.b"]),
          }),
      };
      expect(matches(actor, "root.sub.a.b")).toBe(true);
    });

    test("returns true for the dotted path and false for concatenation in nested regions", () => {
      const actor = {
        snapshot: () =>
          snap(["root"], {
            sub: snap(["mid"], {
              leaf: snap(["x.y"]),
            }),
          }),
      };
      expect(matches(actor, "root.sub.mid.leaf.x.y")).toBe(true);
      expect(matches(actor, "root.sub.mid.leaf.xy")).toBe(false);
    });
  });

  describe("loop boundary (end < parts.length → end <= parts.length)", () => {
    test("returns true for every prefix of a deep 4-level hierarchy", () => {
      const actor = {
        snapshot: () =>
          snap(["a"], {
            b: snap(["c"], {
              d: snap(["e"], {
                f: snap(["g"]),
              }),
            }),
          }),
      };
      expect(matches(actor, "a")).toBe(true);
      expect(matches(actor, "a.b")).toBe(true);
      expect(matches(actor, "a.b.c")).toBe(true);
      expect(matches(actor, "a.b.c.d")).toBe(true);
      expect(matches(actor, "a.b.c.d.e")).toBe(true);
      expect(matches(actor, "a.b.c.d.e.f")).toBe(true);
      expect(matches(actor, "a.b.c.d.e.f.g")).toBe(true);
    });

    test("returns false when the pattern exceeds hierarchy depth", () => {
      const actor = {
        snapshot: () =>
          snap(["a"], {
            b: snap(["c"]),
          }),
      };
      expect(matches(actor, "a.b.c.d")).toBe(false);
      expect(matches(actor, "a.b.c.d.e")).toBe(false);
    });

    test("returns false for a long pattern with no matching hierarchy", () => {
      const actor = {
        snapshot: () => snap(["only"]),
      };
      expect(matches(actor, "only.a.b.c.d")).toBe(false);
    });
  });

  describe("trailing dot validation (pattern.endsWith('.'))", () => {
    test("returns false for a single-segment pattern ending with dot", () => {
      const actor = {
        snapshot: () =>
          snap(["a"], {
            "": snap([""]),
          }),
      };
      expect(matches(actor, "a.")).toBe(false);
    });

    test("returns false for a multi-segment pattern ending with dot", () => {
      const actor = {
        snapshot: () =>
          snap(["x"], {
            y: snap([""]),
          }),
      };
      expect(matches(actor, "x.y.")).toBe(false);
    });

    test("returns false for a deep pattern ending with dot", () => {
      const actor = {
        snapshot: () =>
          snap(["a"], {
            b: snap(["c"], {
              "": snap([""]),
            }),
          }),
      };
      expect(matches(actor, "a.b.c.")).toBe(false);
    });
  });

  describe("leading dot validation (pattern.startsWith('.'))", () => {
    test("returns false for a pattern starting with dot", () => {
      const actor = {
        snapshot: () =>
          snap([""], {
            a: snap(["b"]),
          }),
      };
      expect(matches(actor, ".a")).toBe(false);
    });

    test("returns false for a multi-segment pattern starting with dot", () => {
      const actor = {
        snapshot: () =>
          snap([""], {
            x: snap(["y"]),
          }),
      };
      expect(matches(actor, ".x.y")).toBe(false);
    });

    test("returns false for a pattern that is only a dot", () => {
      const actor = { snapshot: () => snap([""]) };
      expect(matches(actor, ".")).toBe(false);
    });
  });

  describe("double dot validation (pattern.includes('..'))", () => {
    test("returns false for a double dot in the middle", () => {
      const actor = {
        snapshot: () =>
          snap(["a"], {
            "": snap(["b"]),
          }),
      };
      expect(matches(actor, "a..b")).toBe(false);
    });

    test("returns false for a pattern that is just double dots", () => {
      const actor = {
        snapshot: () =>
          snap([""], {
            "": snap([""]),
          }),
      };
      expect(matches(actor, "..")).toBe(false);
    });

    test("returns false for a longer pattern with double dots", () => {
      const actor = {
        snapshot: () =>
          snap(["a"], {
            "": snap(["b"], {
              c: snap(["d"]),
            }),
          }),
      };
      expect(matches(actor, "a..b.c")).toBe(false);
    });

    test("returns false for patterns with multiple double dots", () => {
      const actor = {
        snapshot: () =>
          snap(["a"], {
            "": snap(["b"]),
          }),
      };
      expect(matches(actor, "a..b..c")).toBe(false);
    });
  });

  describe("empty pattern validation (!pattern)", () => {
    test("returns false for an empty string pattern", () => {
      const actor = { snapshot: () => snap(["idle"]) };
      expect(matches(actor, "")).toBe(false);
    });
  });
});
