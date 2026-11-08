// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizEdge, VizMachine, VizState } from "../schema.ts";
import { outlineOf } from "../outline.ts";
import type { MachineOutline, OutlineArrow } from "../outline.ts";
import { mountViewer } from "./viewer.ts";
import type { ViewerOptions } from "./viewer.ts";
import { describe, expect, test, vi } from "vite-plus/test";

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

function edge(
  from: string,
  event: string,
  to: string | null,
  kind: VizEdge["kind"] = "transition",
): VizEdge {
  return {
    id: `${from}-${event}-${to}`,
    from,
    event,
    to,
    kind,
    origin: "declared",
    emits: [],
    contexts: [],
    explanation: null,
    doc: null,
    coverage: null,
    tested: null,
  };
}

function machine(states: string[], edges: VizEdge[], id = "m"): VizMachine {
  return {
    id,
    initial: states[0] ?? "",
    regions: [],
    maps: [],
    states: states.map((each, index) => state(each, index === 0)),
    events: [],
    outputs: [],
    context: null,
    edges: [edge("__initial__", "", states[0] ?? "", "initial"), ...edges],
    fuzz: null,
    runs: [],
  };
}

const arrow = (from: string, event: string, to: string | null): OutlineArrow => ({
  from,
  event,
  to,
  kind: "transition",
});

function mount(
  machines: VizMachine[],
  before: MachineOutline,
  extra: Partial<ViewerOptions["changes"]> = {},
): { root: HTMLElement; onSeen: ReturnType<typeof vi.fn> } {
  const root = document.createElement("div");
  const onSeen = vi.fn();
  const first = machines[0];
  mountViewer(
    root,
    { schemaVersion: VIZ_SCHEMA_VERSION, machines },
    { changes: { machine: first?.id ?? "", before, onSeen, ...extra } },
  );
  return { root, onSeen };
}

const current = machine(["a", "b", "c"], [edge("a", "GO", "b"), edge("b", "GO", "c")]);
const older: MachineOutline = { states: ["a", "b"], arrows: [arrow("a", "GO", "b")] };
const items = (root: HTMLElement) =>
  [...root.querySelectorAll("section.changes li")].map((li) => li.textContent);

describe("viewer changes", () => {
  test("outlines the added state and arrow and nothing else", () => {
    const { root } = mount([current], older);
    const added = [...root.querySelectorAll(".added")];
    expect(added.map((each) => each.getAttribute("aria-label")).sort()).toEqual([
      "b on GO to c, new",
      "state c, new",
    ]);
    expect(root.querySelector('g.state[data-node-id="c"]')?.classList.contains("added")).toBe(true);
    expect(root.querySelector('g.edge[data-edge-id="b-GO-c"]')?.classList.contains("added")).toBe(
      true,
    );
    expect(added).toHaveLength(2);
  });

  test("lists added, then removed, items", () => {
    const { root } = mount([current], {
      states: ["a", "b", "old"],
      arrows: [arrow("a", "GO", "b"), arrow("c", "BACK", "a")],
    });
    expect(items(root)).toEqual([
      "Added state c",
      "Added arrow GO from b to c",
      "Removed state old",
      "Removed arrow BACK from c to a",
    ]);
  });

  test("stay, undetermined and any-state wording", () => {
    const wording = machine(
      ["a", "b"],
      [edge("b", "PING", "b", "stay"), edge("a", "MAYBE", null), edge("*", "RESET", "a")],
    );
    const { root } = mount([wording], { states: ["a", "b"], arrows: [] });
    expect(items(root)).toEqual([
      "Added arrow PING in b, stays",
      "Added arrow MAYBE from a to an undetermined state",
      "Added arrow RESET from any state to a",
    ]);
  });

  test("15 changes show 12 items and 'and 3 more'", () => {
    const ids = Array.from({ length: 15 }, (_, index) => `s${index}`);
    const { root } = mount([machine(ids, [])], { states: [], arrows: [] });
    const list = items(root);
    expect(list).toHaveLength(13);
    expect(list[11]).toBe("Added state s11");
    expect(list[12]).toBe("and 3 more");
  });

  test("Mark as seen calls onSeen once and clears marks and list", () => {
    const { root, onSeen } = mount([current], older);
    root.querySelector<HTMLButtonElement>("section.changes button")?.click();
    expect(onSeen).toHaveBeenCalledTimes(1);
    expect(root.querySelector(".added")).toBeNull();
    expect(root.querySelector("section.changes")).toBeNull();
  });

  test("an unchanged outline or another machine shows nothing", () => {
    const same = mount([current], outlineOf(current));
    expect(same.root.querySelector("section.changes")).toBeNull();
    expect(same.root.querySelector(".added")).toBeNull();
    const other = mount([current], older, { machine: "elsewhere" });
    expect(other.root.querySelector("section.changes")).toBeNull();
    expect(other.root.querySelector(".added")).toBeNull();
  });

  test("marks survive a walk", () => {
    const { root } = mount([current], older);
    root.querySelector<HTMLButtonElement>('[data-take="a-GO-b"]')?.click();
    expect(root.querySelectorAll(".added")).toHaveLength(2);
    expect(root.querySelector("section.changes")).not.toBeNull();
  });

  test("a state id with a dot is marked", () => {
    const dotted = machine(["a", "b.c"], [edge("a", "GO", "b.c")]);
    const { root } = mount([dotted], { states: ["a"], arrows: [] });
    const marked = [...root.querySelectorAll("g.state.added")].map((each) =>
      each.getAttribute("data-node-id"),
    );
    expect(marked).toEqual(["b.c"]);
  });
});
