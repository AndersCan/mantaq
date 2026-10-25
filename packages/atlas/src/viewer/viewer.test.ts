// @vitest-environment happy-dom
import { toAtlas } from "../atlas.ts";
import { exampleInputs } from "../examples.ts";
import { createCheckoutActor } from "../fixtures/checkout.ts";
import type { AtlasDocument } from "../schema.ts";
import { PROBE_BANNER, mountViewer } from "./viewer.ts";
import { describe, expect, test } from "vite-plus/test";

function mount(atlas: AtlasDocument): HTMLElement {
  const root = document.createElement("main");
  document.body.replaceChildren(root);
  mountViewer(root, atlas);
  return root;
}

function checkout(): AtlasDocument {
  return toAtlas([{ id: "checkout", actor: createCheckoutActor() }]);
}

function field(root: HTMLElement, name: string): string | null | undefined {
  return root.querySelector(`.panel [data-field="${name}"]`)?.textContent;
}

function edgeElement(root: HTMLElement, id: string): Element {
  const found = [...root.querySelectorAll<SVGGElement>(".edge")].find(
    (element) => element.dataset["edgeId"] === id,
  );
  expect(found).toBeDefined();
  return found ?? root;
}

describe("viewer: checkout", () => {
  test("renders every state and every non-initial edge", () => {
    const atlas = checkout();
    const root = mount(atlas);
    const machine = atlas.machines[0];
    expect(root.querySelectorAll(".state").length).toBe(machine?.states.length);
    const drawn = machine?.edges.filter((edge) => edge.kind !== "initial").length;
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

  test("back edges are undetermined stubs, each to its own ? node", () => {
    const root = mount(checkout());
    const back = [...root.querySelectorAll<SVGGElement>(".edge")].filter((edge) =>
      edge.textContent?.includes("back"),
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
    const internal = [...root.querySelectorAll(".edge.internal")].map((edge) => edge.textContent);
    expect(internal).toContain("paymentOk");
    expect(internal).not.toContain("back");
    expect(root.querySelector(".edge.effect")?.textContent).toBe("effect");
  });

  test("clicking an edge shows source, event, target and 'not analyzed'", () => {
    const atlas = checkout();
    const root = mount(atlas);
    const edge = atlas.machines[0]?.edges.find((candidate) => candidate.event === "paymentOk");
    edgeElement(root, edge?.id ?? "").dispatchEvent(new Event("click"));
    expect(field(root, "source")).toBe("submitting");
    expect(field(root, "event")).toBe("paymentOk (internal)");
    expect(field(root, "target")).toBe("success");
    expect(field(root, "explanation")).toBe("not analyzed");
    expect(field(root, "hits")).toBe("no run supplied");
  });

  test("undetermined edge panel says undetermined, never a guessed target", () => {
    const atlas = checkout();
    const root = mount(atlas);
    const back = atlas.machines[0]?.edges.find((candidate) => candidate.event === "back");
    edgeElement(root, back?.id ?? "").dispatchEvent(new Event("click"));
    expect(field(root, "target")).toBe("undetermined");
  });

  test("clicking a state lists its edges and click-through selects the edge", () => {
    const root = mount(checkout());
    root.querySelector('[data-node-id="submitting"]')?.dispatchEvent(new Event("click"));
    expect(field(root, "visits")).toBe("no run supplied");
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

  test("hover highlights the edge and both endpoints", () => {
    const atlas = checkout();
    const root = mount(atlas);
    const edge = atlas.machines[0]?.edges.find((candidate) => candidate.event === "submitPayment");
    const element = edgeElement(root, edge?.id ?? "");
    element.dispatchEvent(new Event("mouseenter"));
    expect([...root.querySelectorAll(".highlight")].length).toBe(3);
    element.dispatchEvent(new Event("mouseleave"));
    expect(root.querySelectorAll(".highlight").length).toBe(0);
  });

  test("shows the probing banner; no coverage toggle without a run", () => {
    const root = mount(checkout());
    expect(root.querySelector(".banner")?.textContent).toBe(PROBE_BANNER);
    expect(root.querySelector(".coverage-toggle")).toBeNull();
    expect(root.querySelector(".machine-select")).toBeNull();
  });
});

function checkoutWithRun(): AtlasDocument {
  return toAtlas(exampleInputs().filter((input) => input.id === "checkout"));
}

describe("viewer: coverage and switching", () => {
  test("unreached edges and states are marked, and the legend explains it", () => {
    const root = mount(checkoutWithRun());
    expect(root.querySelector(".coverage-toggle")).not.toBeNull();
    expect(root.classList.contains("coverage-on")).toBe(true);
    expect(root.querySelector('[data-node-id="payment"]')?.classList.contains("unreached")).toBe(
      true,
    );
    expect(
      root.querySelector('[data-node-id="shippingAddress"]')?.classList.contains("unreached"),
    ).toBe(false);
    expect(root.querySelectorAll(".edge.unreached").length).toBeGreaterThan(0);
    expect(root.querySelectorAll(".edge.undetermined").length).toBeGreaterThan(0);
    expect(root.querySelector(".legend-unreached")).not.toBeNull();
  });

  test("coverage toggle turns the overlay off", () => {
    const root = mount(checkoutWithRun());
    const toggle = root.querySelector<HTMLInputElement>(".coverage-toggle");
    if (toggle) toggle.checked = false;
    toggle?.dispatchEvent(new Event("change"));
    expect(root.classList.contains("coverage-on")).toBe(false);
  });

  test("switcher renders every example without manual positioning", () => {
    const atlas = toAtlas(exampleInputs());
    const root = mount(atlas);
    for (const machine of atlas.machines) {
      const select = root.querySelector<HTMLSelectElement>(".machine-select");
      expect(select).not.toBeNull();
      if (select) select.value = machine.id;
      select?.dispatchEvent(new Event("change"));
      expect(root.querySelector("h1")?.textContent).toBe(`Atlas: ${machine.id}`);
      expect(root.querySelectorAll(".state").length).toBe(machine.states.length);
      const positions = [...root.querySelectorAll(".state rect.frame:not(.inner)")].map(
        (rect) => `${rect.getAttribute("x")},${rect.getAttribute("y")}`,
      );
      expect(new Set(positions).size).toBe(positions.length);
    }
  });
});
