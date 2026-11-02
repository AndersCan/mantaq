// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizEdge, VizMachine, VizState } from "../schema.ts";
import { serializeViz } from "../serialize.ts";
import { mountVizText } from "./embed.ts";
import { describe, expect, test } from "vite-plus/test";

function state(id: string, flags: { initial?: boolean; final?: boolean } = {}): VizState {
  return {
    id,
    label: id,
    region: null,
    initial: flags.initial ?? false,
    final: flags.final ?? false,
    effects: [],
    coverage: null,
    tested: null,
    doc: null,
  };
}

function edge(from: string, event: string, to: string): VizEdge {
  return {
    id: `${from}-${event}-${to}`,
    from,
    event,
    to,
    kind: from === "__initial__" ? "initial" : "transition",
    origin: "declared",
    emits: [],
    contexts: [],
    explanation: null,
    doc: null,
    coverage: null,
    tested: null,
  };
}

/** Hand-built so this package's tests need no machine: `open -go-> done`. */
const door: VizMachine = {
  id: "door",
  initial: "open",
  regions: [],
  states: [
    { ...state("open", { initial: true }), doc: "The door stands open." },
    state("done", { final: true }),
  ],
  events: [{ id: "go", internal: false, doc: null, payloadType: null }],
  edges: [
    edge("__initial__", "", "open"),
    { ...edge("open", "go", "done"), doc: "Walk through and close up." },
  ],
  fuzz: null,
};

function mount(text: string): HTMLElement {
  const root = document.createElement("div");
  mountVizText(root, { source: "door.json", text });
  return root;
}

describe("mountVizText", () => {
  test("the panel shows the doc of the current state and of each next step", () => {
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [door] }));
    expect(root.querySelector('.panel [data-doc="state"]')?.textContent).toBe(
      "The door stands open.",
    );
    expect(
      root.querySelector('.panel [data-move="open-go-done"] [data-doc="edge"]')?.textContent,
    ).toBe("Walk through and close up.");
    root.querySelector<HTMLButtonElement>('[data-take="open-go-done"]')?.click();
    expect(root.querySelector('.panel [data-doc="state"]')).toBeNull();
  });

  test("draws a valid document and walks it to Done", () => {
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [door] }));
    expect(root.querySelectorAll(".graph g[data-node-id]")).toHaveLength(2);
    root.querySelector<HTMLButtonElement>('[data-take="open-go-done"]')?.click();
    expect(root.querySelector(".panel .explore-done")?.textContent).toBe(
      "Done. done is final: the actor has stopped.",
    );
    expect(root.querySelectorAll(".panel [data-take]")).toHaveLength(0);
  });
});
