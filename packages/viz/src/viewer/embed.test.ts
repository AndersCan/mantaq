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
    coverage: null,
    tested: null,
  };
}

/** Hand-built so this package's tests need no machine: `open -go-> done`. */
const door: VizMachine = {
  id: "door",
  initial: "open",
  regions: [],
  states: [state("open", { initial: true }), state("done", { final: true })],
  events: [{ id: "go", internal: false, payloadType: null }],
  edges: [edge("__initial__", "", "open"), edge("open", "go", "done")],
  fuzz: null,
};

function mount(text: string): HTMLElement {
  const root = document.createElement("div");
  mountVizText(root, { source: "door.json", text });
  return root;
}

describe("mountVizText", () => {
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
