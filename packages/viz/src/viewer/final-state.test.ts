// @vitest-environment happy-dom
import { describe, expect, test } from "vite-plus/test";
import type { VizMachine, VizState } from "../schema.ts";
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import { renderGraph } from "./graph.ts";
import { FINAL_INSET } from "./geometry.ts";
import { placeMachine } from "./layout.ts";
import type { PlacedState } from "./layout.ts";
import { overlapsOf } from "./overlaps.ts";

function state(id: string, final: boolean, effects: string[] = []): VizState {
  return {
    id,
    label: id,
    region: null,
    initial: id === "first",
    final,
    effects: effects.map((name) => ({ name, sends: [] })),
    coverage: null,
    tested: null,
    doc: null,
  };
}

function machineOf(states: VizState[]): VizMachine {
  return {
    version: VIZ_SCHEMA_VERSION,
    initial: "first",
    states,
    edges: [],
    events: [],
    maps: [],
    actors: [],
    regions: [],
  } as unknown as VizMachine;
}

function placed(machine: VizMachine, id: string): PlacedState {
  const node = placeMachine(machine).nodes.find((each) => each.id === id);
  if (node?.kind !== "state") throw new Error("not a state");
  return node;
}

describe("a final state is 2 * FINAL_INSET larger than the same plain state", () => {
  test("a long name: width", () => {
    const name = "aVeryLongFinalStateName";
    const plain = placed(machineOf([state("first", false), state(name, false)]), name);
    const final = placed(machineOf([state("first", false), state(name, true)]), name);
    expect(final.width - plain.width).toBe(2 * FINAL_INSET);
  });

  test("a wide chip: width, and the chip keeps its plain width", () => {
    const effects = ["aVeryLongEffectNameThatIsWide"];
    const plain = placed(machineOf([state("first", false), state("done", false, effects)]), "done");
    const final = placed(machineOf([state("first", false), state("done", true, effects)]), "done");
    expect(final.width - plain.width).toBe(2 * FINAL_INSET);
    expect(final.chips[0]?.width).toBe(plain.chips[0]?.width);
  });
});

describe("the checker measures the inner frame on both axes", () => {
  test("a final state's name 6 below the inner frame's top is flagged", () => {
    const final = placed(machineOf([state("first", false), state("done", true, ["ping"])]), "done");
    const top = final.y - final.height / 2 + FINAL_INSET;
    const moved = { ...final, label: { ...final.label, y: top + 6 + final.label.height / 2 } };
    const layout = placeMachine(machineOf([state("first", false), state("done", true, ["ping"])]));
    const nodes = layout.nodes.map((each) => (each.id === "done" ? moved : each));
    const gaps = overlapsOf({ ...layout, nodes })
      .filter((each) => each.rule === "node-inside")
      .map((each) => each.gap);
    expect(gaps).toContain(6);
  });
});

describe("renderGraph final state: the inner frame is drawn FINAL_INSET inside", () => {
  test("inner rect x, y, width, height", () => {
    const machine = machineOf([state("first", false), state("done", true)]);
    const graph = renderGraph(document, machine, {
      select: () => undefined,
    });
    const done = placed(machine, "done");
    const inner = graph.querySelector('[data-node-id="done"] rect.inner');
    expect(inner?.getAttribute("x")).toBe(String(done.x - done.width / 2 + FINAL_INSET));
    expect(inner?.getAttribute("y")).toBe(String(done.y - done.height / 2 + FINAL_INSET));
    expect(inner?.getAttribute("width")).toBe(String(done.width - 2 * FINAL_INSET));
    expect(inner?.getAttribute("height")).toBe(String(done.height - 2 * FINAL_INSET));
  });
});
