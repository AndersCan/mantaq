// @vitest-environment happy-dom
import { describe, expect, test, vi } from "vite-plus/test";
import type { VizMachine } from "../schema.ts";
import { renderGraph } from "./graph.ts";
import { layoutMachine } from "./layout.ts";
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
  test("layoutMachine is Left with the overlaps", () => {
    const laid = layoutMachine(machine);
    expect(Either.isLeft(laid)).toBe(true);
    expect(laid[0]).toEqual([{ rule: "label-clear", a: "edge:x", b: "node:y", distance: 0 }]);
  });

  test("renderGraph shows the one-line load error, not a diagram", () => {
    const shown = renderGraph(document, machine, {
      select: () => {},
      showDetails: () => {},
      mode: "explore",
    } as never);
    expect(shown.getAttribute("class")).toBe("load-error");
    expect(shown.textContent).toBe("Cannot draw toggle.");
  });
});
