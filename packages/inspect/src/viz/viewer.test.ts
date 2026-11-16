// @vitest-environment happy-dom
import { toViz } from "../structure.ts";
import { exampleInputs, exampleTargets } from "../examples.ts";
import { DEFAULT_SEED } from "@mantaq/pbt";

import { createCheckoutActor } from "../fixtures/checkout.ts";
import type { VizDocument } from "@mantaq/viz";
import { fuzz } from "../fuzz/fuzz.ts";
import { fuzzedMachine } from "../fuzz/to-viz.ts";
import { VIZ_SCHEMA_VERSION } from "@mantaq/viz";
import { mountViewer } from "@mantaq/viz/viewer";
import { describe, expect, test } from "vite-plus/test";

function mount(viz: VizDocument, options: Parameters<typeof mountViewer>[2] = {}): HTMLElement {
  const root = document.createElement("main");
  document.body.replaceChildren(root);
  mountViewer(root, viz, options);
  return root;
}

function checkout(): VizDocument {
  return toViz([{ id: "checkout", actor: createCheckoutActor() }]);
}

/** Checkout as an undeclared actor would export it: `back` targets unknown. */
function undeterminedBack(viz: VizDocument): VizDocument {
  return {
    ...viz,
    machines: viz.machines.map((machine) => ({
      ...machine,
      edges: machine.edges.flatMap((edge) => {
        if (edge.event !== "back") return [edge];
        if (edge.to !== "basicInfo") return [];
        return [
          { ...edge, id: `${edge.from}-back-undetermined`, to: null, origin: "probe" as const },
        ];
      }),
    })),
  };
}

describe("viewer: checkout", () => {
  test("renders every state and every non-initial edge", () => {
    const viz = checkout();
    const root = mount(viz);
    const machine = viz.machines[0];
    expect(root.querySelectorAll(".state").length).toBe(machine?.states.length);
    const drawn = machine?.edges.filter(
      (edge) => edge.kind !== "initial" && edge.kind !== "effect",
    ).length;
    expect(root.querySelectorAll(".edge").length).toBe(drawn);
    expect(root.querySelectorAll(".entry").length).toBe(1);
  });

  test("final state has a double border, initial state gets the entry arrow", () => {
    const root = mount(checkout());
    const success = root.querySelector('[data-node-id="success"]');
    expect(success?.classList.contains("final")).toBe(true);
    expect(success?.querySelectorAll("rect.frame").length).toBe(2);
    expect(root.querySelector('[data-node-id="basicInfo"]')?.classList.contains("initial")).toBe(
      true,
    );
  });

  test("declared back edges draw real targets; no ? nodes", () => {
    const root = mount(checkout());
    const back = [...root.querySelectorAll<SVGGElement>(".edge")].filter((edge) =>
      edge.querySelector("text")?.textContent?.includes("back"),
    );
    expect(back.length).toBeGreaterThan(0);
    expect(back.some((edge) => edge.classList.contains("undetermined"))).toBe(false);
    expect(root.querySelectorAll(".unknown-node").length).toBe(0);
  });

  test("undetermined edges are stubs, each to its own ? node", () => {
    const root = mount(undeterminedBack(checkout()));
    const back = [...root.querySelectorAll<SVGGElement>(".edge")].filter((edge) =>
      edge.querySelector("text")?.textContent?.includes("back"),
    );
    expect(back.length).toBeGreaterThan(0);
    for (const edge of back) {
      expect(edge.classList.contains("undetermined")).toBe(true);
      expect(edge.dataset["to"]).toMatch(/^\?:/);
    }
    expect(root.querySelectorAll(".unknown-node").length).toBe(back.length);
  });

  test("internal events and effects are marked distinctly", () => {
    const root = mount(checkout());
    const internal = [...root.querySelectorAll(".edge.internal")].map(
      (edge) => edge.querySelector("text")?.textContent,
    );
    expect(internal).toContain("paymentOk");
    expect(internal).not.toContain("back");
    expect(root.querySelector(".edge.effect")).toBeNull();
    expect(root.querySelector('.state [data-effect="chargeCard"]')?.textContent).toBe("chargeCard");
  });

  test("effects are chips sized into their state, with no effect edges or self-loops", () => {
    const viz = checkout();
    const root = mount(viz);
    const machine = viz.machines[0];
    for (const state of machine?.states ?? []) {
      const node = root.querySelector(`[data-node-id="${state.id}"]`);
      const chips = [...(node?.querySelectorAll(".chip") ?? [])];
      expect(chips.map((chip) => chip.getAttribute("data-effect"))).toEqual(
        state.effects.map((effect) => effect.name),
      );
      const frame = node?.querySelector("rect.frame:not(.inner)");
      expect(Number(frame?.getAttribute("height"))).toBeGreaterThanOrEqual(
        36 + 20 * state.effects.length,
      );
    }
    const effectEdges = machine?.edges.filter((edge) => edge.kind === "effect") ?? [];
    expect(effectEdges.length).toBeGreaterThan(0);
    for (const edge of effectEdges) {
      expect(root.querySelector(`[data-edge-id="${edge.id}"]`)).toBeNull();
    }
  });

  test("effect edges with an undetermined target draw no unknown node", () => {
    const viz = checkout();
    const withNull: VizDocument = {
      ...viz,
      machines: viz.machines.map((machine) => ({
        ...machine,
        edges: machine.edges.map((edge) => (edge.kind === "effect" ? { ...edge, to: null } : edge)),
      })),
    };
    const root = mount(withNull);
    expect(root.querySelectorAll(".unknown-node").length).toBe(0);
  });

  test("clicking a chip selects its state", () => {
    const root = mount(checkout());
    root
      .querySelector('[data-node-id="submitting"] .chip')
      ?.dispatchEvent(new Event("click", { bubbles: true }));
    expect(root.querySelector("[data-selected-state]")?.getAttribute("data-selected-state")).toBe(
      "submitting",
    );
  });

  test("clicking a state lists its edges and click-through selects the edge", () => {
    const root = mount(checkout());
    root.querySelector('[data-node-id="submitting"]')?.dispatchEvent(new Event("click"));
    const links = root.querySelectorAll<HTMLElement>(".panel [data-edge-link]");
    expect(links.length).toBeGreaterThan(2);
    const first = links[0];
    first?.dispatchEvent(new Event("click"));
    expect(
      root.querySelector(".panel [data-selected-edge]")?.getAttribute("data-selected-edge"),
    ).toBe(first?.dataset["edgeLink"]);
  });

  test("keyboard: Enter on a focused state selects it", () => {
    const root = mount(checkout());
    const payment = root.querySelector('[data-node-id="payment"]');
    expect(payment?.getAttribute("tabindex")).toBe("0");
    payment?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(
      root.querySelector(".panel [data-selected-state]")?.getAttribute("data-selected-state"),
    ).toBe("payment");
  });

  test("shows no help text or link, no coverage picker and no machine picker for one machine", () => {
    const root = mount(checkout());
    expect(root.querySelector(".banner")).toBeNull();
    expect(root.querySelector(".legend")).toBeNull();
    expect(root.querySelector("a.help-link")).toBeNull();
    expect(root.querySelector(".coverage-mode")).toBeNull();
    expect(root.querySelector(".machine-select")).toBeNull();
  });
});

describe("viewer: coverage and switching", () => {
  test("switcher renders every example without manual positioning", () => {
    const viz = toViz(exampleInputs());
    const root = mount(viz);
    for (const machine of viz.machines) {
      const select = root.querySelector<HTMLSelectElement>(".machine-select");
      expect(select).not.toBeNull();
      if (select) select.value = machine.id;
      select?.dispatchEvent(new Event("change"));
      expect(root.querySelector("h1")?.textContent).toBe(`Viz: ${machine.id}`);
      expect(root.querySelectorAll(".state").length).toBe(machine.states.length);
      const positions = [...root.querySelectorAll(".state rect.frame:not(.inner)")].map(
        (rect) => `${rect.getAttribute("x")},${rect.getAttribute("y")}`,
      );
      expect(new Set(positions).size).toBe(positions.length);
    }
  });
});

function fuzzed(id: string): VizDocument {
  const target = exampleTargets().find((each) => each.id === id);
  if (!target) return { schemaVersion: VIZ_SCHEMA_VERSION, machines: [] };
  const machine = fuzzedMachine(target, fuzz(target, { seed: DEFAULT_SEED, iterations: 2000 }));
  return { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] };
}

describe("viewer: fuzz results", () => {
  test("fuzz-observed stays are drawn distinctly; declared transitions need no fuzz edge", () => {
    const root = mount(fuzzed("retry"));
    const fuzzTransitions = [...root.querySelectorAll<SVGGElement>(".edge.fuzz")].filter(
      (edge) => !edge.classList.contains("stay"),
    );
    expect(fuzzTransitions).toEqual([]);
    expect(root.querySelectorAll(".edge.fuzz.stay").length).toBeGreaterThan(0);
  });
});

describe("viewer: onAny", () => {
  function saga(): VizDocument {
    return toViz(exampleInputs().filter((input) => input.id === "saga"));
  }

  test("onAny edges start at one 'any state' node, not at every state", () => {
    const root = mount(saga());
    expect(root.querySelectorAll(".any-node").length).toBe(1);
    expect(root.querySelector(".any-node")?.textContent).toBe("any state");
    const cancel = [...root.querySelectorAll<SVGGElement>(".edge")].filter(
      (edge) => edge.querySelector("text")?.textContent === "CANCEL",
    );
    expect(cancel.map((edge) => edge.dataset["from"])).toEqual(["*", "*"]);
    expect(cancel[0]?.getAttribute("aria-label")).toMatch(/^any state on CANCEL to /);
  });

  test("a covered state lists the onAny edges as outgoing", () => {
    const viz = saga();
    const root = mount(viz);
    root.querySelector('[data-node-id="processingPayment"]')?.dispatchEvent(new Event("click"));
    const links = [...root.querySelectorAll(".panel [data-edge-link]")].map(
      (link) => link.textContent,
    );
    expect(links).toContain("any state —CANCEL→ failed");
  });
});
