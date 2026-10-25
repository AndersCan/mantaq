// @vitest-environment happy-dom
import { toAtlas, toAtlasMachine } from "../atlas.ts";
import { annotateMachine } from "../ast/annotate.ts";
import { EXAMPLE_ROOT, exampleInputs, exampleTargets } from "../examples.ts";
import { createCheckoutActor, submitBasicInfo } from "../fixtures/checkout.ts";
import type { AtlasDocument } from "../schema.ts";
import { fuzz } from "../fuzz/fuzz.ts";
import { fuzzedMachine } from "../fuzz/to-atlas.ts";
import { ATLAS_SCHEMA_VERSION } from "../schema.ts";
import { FUZZ_NOTE, PROBE_BANNER, mountViewer } from "./viewer.ts";
import { instrument } from "@mantaq/traversal";
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
  const run = instrument(createCheckoutActor());
  run.send(submitBasicInfo.create({ email: "a@b.c", name: "A" }));
  return toAtlas([{ id: "checkout", actor: createCheckoutActor(), history: run.history }]);
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

function fuzzedCheckout(): AtlasDocument {
  const target = exampleTargets().find((each) => each.id === "checkout");
  if (!target) return { schemaVersion: ATLAS_SCHEMA_VERSION, machines: [] };
  const machine = fuzzedMachine(target, fuzz(target, { seed: 1, iterations: 1000 }));
  return { schemaVersion: ATLAS_SCHEMA_VERSION, machines: [machine] };
}

describe("viewer: fuzz results", () => {
  test("fuzz-discovered edges and stays are drawn distinctly; banner mentions fuzzing", () => {
    const root = mount(fuzzedCheckout());
    expect(root.querySelector(".banner")?.textContent).toBe(`${PROBE_BANNER} ${FUZZ_NOTE}`);
    const fuzzBack = [...root.querySelectorAll<SVGGElement>(".edge.fuzz")].filter(
      (edge) => edge.textContent === "back" && !edge.classList.contains("stay"),
    );
    expect(fuzzBack.map((edge) => `${edge.dataset["from"]}->${edge.dataset["to"]}`).sort()).toEqual(
      ["error->payment", "payment->shippingAddress", "shippingAddress->basicInfo"],
    );
    expect(root.querySelectorAll(".edge.stay").length).toBeGreaterThan(0);
    expect(root.querySelector(".legend-fuzz")).not.toBeNull();
  });

  test("edge panel shows origin and the replay sequence that reached it", () => {
    const atlas = fuzzedCheckout();
    const root = mount(atlas);
    const edge = atlas.machines[0]?.edges.find(
      (candidate) => candidate.origin === "fuzz" && candidate.from === "error",
    );
    edgeElement(root, edge?.id ?? "").dispatchEvent(new Event("click"));
    expect(field(root, "origin")).toBe("fuzz (observed, not probed)");
    const steps = [...root.querySelectorAll(".panel .steps li")].map((item) => item.textContent);
    expect(steps.at(-1)).toBe("back");
    expect(steps).toContain('paymentFail {"reason":"declined"}');
  });

  test("idle panel shows the fuzz run summary", () => {
    const root = mount(fuzzedCheckout());
    expect(root.querySelector(".fuzz-summary")).not.toBeNull();
    expect(field(root, "seed")).toBe("1");
    expect(field(root, "handler errors")).toBe("none");
  });
});

describe("viewer: AST explanations", () => {
  function annotatedCredit(): AtlasDocument {
    const credit = exampleTargets().find((each) => each.id === "credit");
    if (!credit) return { schemaVersion: ATLAS_SCHEMA_VERSION, machines: [] };
    const machine = annotateMachine(
      toAtlasMachine({ id: "credit", actor: credit.create().actor }),
      {
        file: credit.source,
        root: EXAMPLE_ROOT,
      },
    );
    return { schemaVersion: ATLAS_SCHEMA_VERSION, machines: [machine] };
  }

  test("branches the graph lacks are flagged 'not in graph'", () => {
    const atlas = annotatedCredit();
    const root = mount(atlas);
    const apply = atlas.machines[0]?.edges.find((edge) => edge.event === "apply");
    edgeElement(root, apply?.id ?? "").dispatchEvent(new Event("click"));
    const statuses = [...root.querySelectorAll<HTMLElement>(".panel .branch")].map(
      (item) => item.dataset["branchStatus"],
    );
    expect(statuses).toEqual(["not in graph", "not in graph", "this edge"]);
    expect(root.querySelector('.panel [data-explain="comparisons"]')?.textContent).toContain(
      "payload.amount > 50000",
    );
  });

  test("not analyzed shows reason and snippet", () => {
    const atlas = annotatedCredit();
    const root = mount(atlas);
    const reset = atlas.machines[0]?.edges.find((edge) => edge.event === "reset");
    edgeElement(root, reset?.id ?? "").dispatchEvent(new Event("click"));
    expect(root.querySelector('.panel [data-explain="not analyzed"]')?.textContent).toContain(
      "resetHandler",
    );
    expect(root.querySelector(".panel pre")?.textContent).toBe("resetHandler");
  });
});
