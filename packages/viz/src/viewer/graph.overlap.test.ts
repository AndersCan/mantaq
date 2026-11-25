// @vitest-environment happy-dom
import { describe, expect, test, vi } from "vite-plus/test";
import { layoutMachine, placeMachine } from "./layout.ts";
import { Either } from "@mantaq/utils";
import { mountViewer } from "./viewer.ts";
import { renderGraph } from "./graph.ts";
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizMachine } from "../schema.ts";

vi.mock("./overlaps.ts", async (original) => ({
  ...(await original<typeof import("./overlaps.ts")>()),
  overlapsOf: () => [{ rule: "label-clear", a: "edge:x", b: "node:y", distance: 0 }],
}));

const machine = {
  schemaVersion: 17,
  id: "toggle",
  initial: "idle",
  regions: [],
  maps: [],
  actors: [],
  states: ["idle", "busy"].map((id) => ({
    id,
    label: id,
    region: null,
    initial: id === "idle",
    final: false,
    effects: [],
    coverage: null,
    tested: null,
    doc: null,
  })),
  events: [],
  outputs: [],
  partOutputs: [],
  context: [],
  edges: [
    {
      id: "idle-go-busy",
      from: "idle",
      event: "go",
      to: "busy",
      kind: "transition",
      origin: "declared",
      emits: [],
      contexts: [],
      explanation: null,
      doc: null,
      coverage: null,
      tested: null,
    },
  ],
  fuzz: null,
  runs: [],
  findings: [],
} as unknown as VizMachine;

describe("a layout that overlaps itself", () => {
  test("layoutMachine is Right with the layout and the overlaps", () => {
    expect(layoutMachine(machine)).toEqual(
      Either.right({
        layout: placeMachine(machine),
        overlaps: [{ rule: "label-clear", a: "edge:x", b: "node:y", distance: 0 }],
      }),
    );
  });

  test("renderGraph draws the machine anyway and counts the overlaps", () => {
    const shown = renderGraph(document, machine, { select: () => undefined });
    const placed = layoutMachine(machine)[1]?.layout;
    expect({
      kind: shown.getAttribute("class"),
      states: shown.querySelectorAll("g.state").length,
      overlaps: shown.getAttribute("data-overlaps"),
      inside: shown.querySelector(".overlap-warning") ?? undefined,
      height: shown.getAttribute("height"),
    }).toStrictEqual({
      kind: "graph",
      states: 2,
      overlaps: "1",
      inside: undefined,
      height: String(Math.ceil(placed?.height ?? 0)),
    });
  });

  test("the viewer says so in the bar above the drawing", () => {
    const root = document.createElement("div");
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] });
    expect(root.querySelector(".viz-bar .overlap-warning")?.textContent).toBe(
      "1 overlap: some labels or lines touch.",
    );
  });
});
