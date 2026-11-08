// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizMachine, VizState } from "../schema.ts";
import { mountViewer } from "./embed.ts";
import { describe, expect, test } from "vite-plus/test";

function state(id: string, initial = false): VizState {
  return {
    id,
    label: id,
    region: null,
    initial,
    final: false,
    effects: [],
    coverage: null,
    tested: null,
    doc: null,
  };
}

const machine: VizMachine = {
  id: "flow",
  initial: "a",
  regions: [],
  maps: [],
  states: [state("a", true), state("b")],
  events: [],
  outputs: [],
  context: null,
  edges: [],
  runs: [],
  fuzz: {
    seed: 1,
    iterations: 1,
    corpus: [],
    errors: [],
    failedExpectations: [],
    expectations: [
      { kind: "neverSee", state: "a", match: '{"role":"member"}', held: true },
      { kind: "neverSee", state: "a", match: '{"count":3}', held: false },
      { kind: "mustSee", state: "a", match: '{"count":-1}', held: true },
      { kind: "mustSee", state: "a", match: '{"count":-2}', held: false },
    ],
  },
};

function mount(shown: VizMachine): HTMLElement {
  const root = document.createElement("div");
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [shown] }, {});
  return root;
}

function open(root: HTMLElement, id: string): void {
  root
    .querySelector(`[data-node-id="${id}"]`)
    ?.dispatchEvent(new Event("click", { bubbles: true }));
}

describe("state rules", () => {
  test("a state lists its rules with the verdict", () => {
    const root = mount(machine);
    open(root, "a");
    const section = root.querySelector(".state-rules");
    expect(section?.getAttribute("data-rules")).toBe("4");
    expect([...root.querySelectorAll(".state-rules li")].map((li) => li.textContent)).toEqual([
      'Never here: {"role":"member"}. Held in every fuzz run.',
      'Never here: {"count":3}. Broken: a fuzz run got here, see Findings.',
      'Must reach: {"count":-1}. A fuzz run reached it.',
      'Must reach: {"count":-2}. No fuzz run reached it.',
    ]);
    expect(section?.querySelector("code")?.textContent).toBe('{"role":"member"}');
  });

  test("a state without rules has no section", () => {
    const root = mount(machine);
    open(root, "b");
    expect(root.querySelector(".details")?.getAttribute("data-selected-state")).toBe("b");
    expect(root.querySelector(".state-rules")).toBeNull();
  });

  test("without fuzzing there are no rules", () => {
    const root = mount({ ...machine, fuzz: null });
    open(root, "a");
    expect(root.querySelector(".details")?.getAttribute("data-selected-state")).toBe("a");
    expect(root.querySelector(".state-rules")).toBeNull();
  });
});
