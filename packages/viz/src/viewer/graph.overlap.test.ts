// @vitest-environment happy-dom
import { describe, expect, test, vi } from "vite-plus/test";
import type { VizMachine } from "../schema.ts";
import { renderGraph } from "./graph.ts";
import { layoutMachine, placeMachine } from "./layout.ts";
import { Either } from "@mantaq/utils";

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

  test("renderGraph draws the machine anyway, with a warning row under it", () => {
    const shown = renderGraph(document, machine, { select: () => undefined });
    expect(shown.getAttribute("class")).toBe("graph");
    expect(shown.querySelectorAll("g.state")).toHaveLength(2);
    expect(shown.getAttribute("data-overlaps")).toBe("1");
    const warning = shown.querySelector(".overlap-warning");
    expect(warning?.textContent).toBe("1 overlap: some labels or lines touch.");
    const placed = layoutMachine(machine)[1]?.layout;
    const height = Math.ceil((placed?.height ?? 0) + 20);
    expect(shown.getAttribute("height")).toBe(String(height));
    expect(Number(warning?.getAttribute("y"))).toBeGreaterThan(placed?.height ?? Infinity);
  });
});
