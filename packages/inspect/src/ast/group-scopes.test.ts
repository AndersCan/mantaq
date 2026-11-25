import { describe, expect, test } from "vite-plus/test";
import { scopeOf, validateViz, VIZ_SCHEMA_VERSION } from "@mantaq/viz";
import type { VizMachine, VizState } from "@mantaq/viz";
import { annotateWith } from "./annotate.ts";
import { Either } from "@mantaq/utils";
import type { SourceDocs } from "./annotate.ts";

const SOURCE = { file: "/shop/src/checkout.ts", root: "/shop" };

function stateOf(id: string): VizState {
  const cut = id.lastIndexOf(".");
  return {
    id,
    label: id.slice(cut + 1),
    region: cut === -1 ? null : id.slice(0, cut),
    initial: false,
    final: false,
    effects: [],
    coverage: null,
    tested: null,
    doc: null,
  };
}

/** `@group` tags by state name, and the actor maps among the regions. */
interface Tagging {
  tags: Record<string, string>;
  maps?: string[];
}

/** The checkout machine with these state ids, annotated with the tags, and whether it validates. */
function groupsAfterAnnotation(ids: string[], options: Tagging) {
  const { tags, maps = [] } = options;
  const regions = [...new Set(ids.map(scopeOf))].filter((scope) => scope !== "");
  const checkout: VizMachine = {
    id: "checkout",
    initial: null,
    regions,
    maps,
    actors: [],
    states: ids.map(stateOf),
    events: [],
    outputs: [],
    partOutputs: {},
    context: null,
    edges: [],
    fuzz: null,
    runs: [],
  };
  const analysis: SourceDocs = {
    sites: [],
    stateDocs: new Map(),
    stateGroups: new Map(Object.entries(tags)),
    eventDocs: new Map(),
    effectDocs: new Map(),
    eventPayloads: new Map(),
    elsewhere: [],
  };
  const annotated = annotateWith(checkout, { analysis: Either.right(analysis), source: SOURCE });
  const valid = Either.isRight(
    validateViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [annotated] }),
  );
  return { groups: annotated.states.map((state) => [state.id, state.group]), valid };
}

describe("a group that a tag would put in several region scopes", () => {
  test("a name in the root and a region gets no group, the region's other tagged state keeps it", () => {
    const result = groupsAfterAnnotation(["idle", "upload.busy", "upload.idle"], {
      tags: { idle: "waiting", busy: "waiting" },
    });
    expect(result).toEqual({
      groups: [
        ["idle", undefined],
        ["upload.busy", "waiting"],
        ["upload.idle", undefined],
      ],
      valid: true,
    });
  });

  test("one tagged part in two regions gets no group", () => {
    const result = groupsAfterAnnotation(["left.idle", "right.idle"], {
      tags: { idle: "waiting" },
    });
    expect(result).toEqual({
      groups: [
        ["left.idle", undefined],
        ["right.idle", undefined],
      ],
      valid: true,
    });
  });

  test("two names that share a group across scopes both lose it, other groups stay", () => {
    const result = groupsAfterAnnotation(["charging", "packing", "upload.busy"], {
      tags: { charging: "payment", busy: "payment", packing: "shipping" },
    });
    expect(result).toEqual({
      groups: [
        ["charging", undefined],
        ["packing", "shipping"],
        ["upload.busy", undefined],
      ],
      valid: true,
    });
  });

  test("a name that also sits in an actor map keeps its group outside the map", () => {
    const result = groupsAfterAnnotation(["busy", "idle", "orders.idle"], {
      tags: { idle: "waiting", busy: "waiting" },
      maps: ["orders"],
    });
    expect(result).toEqual({
      groups: [
        ["busy", "waiting"],
        ["idle", "waiting"],
        ["orders.idle", undefined],
      ],
      valid: true,
    });
  });
});

describe("a group name that the validator rejects", () => {
  test("a name with a dot is left off, other groups stay", () => {
    const result = groupsAfterAnnotation(["charging", "packing"], {
      tags: { charging: "v1.2", packing: "shipping" },
    });
    expect(result).toEqual({
      groups: [
        ["charging", undefined],
        ["packing", "shipping"],
      ],
      valid: true,
    });
  });
});
