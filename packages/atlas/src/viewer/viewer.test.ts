// @vitest-environment happy-dom
import { toAtlas, toAtlasMachine } from "../atlas.ts";
import { annotateMachine } from "../ast/annotate.ts";
import { EXAMPLE_ROOT, exampleInputs, exampleTargets, handWrittenBaselines } from "../examples.ts";
import { withTestCoverage } from "../fuzz/coverage.ts";
import { DEFAULT_SEED } from "@mantaq/pbt";
import { createCheckoutActor, submitBasicInfo } from "../fixtures/checkout.ts";
import { createStateRoutingActor } from "../fixtures/state-routing.ts";
import { join } from "node:path";
import type { AtlasDocument } from "../schema.ts";
import { fuzz } from "../fuzz/fuzz.ts";
import { fuzzedMachine } from "../fuzz/to-atlas.ts";
import { ATLAS_SCHEMA_VERSION } from "../schema.ts";
import { FUZZ_NOTE, STRUCTURE_BANNER, mountViewer } from "./viewer.ts";
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

/** Checkout as an undeclared actor would export it: `back` targets unknown. */
function undeterminedBack(atlas: AtlasDocument): AtlasDocument {
  return {
    ...atlas,
    machines: atlas.machines.map((machine) => ({
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

  test("declared back edges draw real targets; no ? nodes", () => {
    const root = mount(checkout());
    const back = [...root.querySelectorAll<SVGGElement>(".edge")].filter((edge) =>
      edge.textContent?.includes("back"),
    );
    expect(back.length).toBeGreaterThan(0);
    expect(back.some((edge) => edge.classList.contains("undetermined"))).toBe(false);
    expect(root.querySelectorAll(".unknown-node").length).toBe(0);
  });

  test("undetermined edges are stubs, each to its own ? node", () => {
    const root = mount(undeterminedBack(checkout()));
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
    expect(field(root, "run hits")).toBe("not supplied");
    expect(field(root, "test hits")).toBe("not supplied");
  });

  test("undetermined edge panel says undetermined, never a guessed target", () => {
    const atlas = undeterminedBack(checkout());
    const root = mount(atlas);
    const back = atlas.machines[0]?.edges.find((candidate) => candidate.event === "back");
    edgeElement(root, back?.id ?? "").dispatchEvent(new Event("click"));
    expect(field(root, "target")).toBe("undetermined");
  });

  test("clicking a state lists its edges and click-through selects the edge", () => {
    const root = mount(checkout());
    root.querySelector('[data-node-id="submitting"]')?.dispatchEvent(new Event("click"));
    expect(field(root, "run visits")).toBe("not supplied");
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

  test("shows the probing banner; no coverage picker without a run", () => {
    const root = mount(checkout());
    expect(root.querySelector(".banner")?.textContent).toBe(STRUCTURE_BANNER);
    expect(root.querySelector(".coverage-mode")).toBeNull();
    expect(root.querySelector(".machine-select")).toBeNull();
  });
});

function pick(root: HTMLElement, mode: string): void {
  const select = root.querySelector<HTMLSelectElement>(".coverage-mode");
  expect(select).not.toBeNull();
  if (select) select.value = mode;
  select?.dispatchEvent(new Event("change"));
}

function checkoutWithRun(): AtlasDocument {
  const run = instrument(createCheckoutActor());
  run.send(submitBasicInfo.create({ email: "a@b.c", name: "A" }));
  return toAtlas([{ id: "checkout", actor: createCheckoutActor(), history: run.history }]);
}

describe("viewer: coverage and switching", () => {
  test("unreached edges and states are marked, and the legend explains it", () => {
    const root = mount(checkoutWithRun());
    expect(root.querySelector(".coverage-mode")).not.toBeNull();
    expect(root.classList.contains("coverage-on")).toBe(true);
    expect(root.querySelector('[data-node-id="payment"]')?.classList.contains("unreached")).toBe(
      true,
    );
    expect(
      root.querySelector('[data-node-id="shippingAddress"]')?.classList.contains("unreached"),
    ).toBe(false);
    expect(root.querySelectorAll(".edge.unreached").length).toBeGreaterThan(0);
    expect(root.querySelector(".legend-unreached")?.textContent).toBe(
      "dimmed and dashed: never taken in the supplied run",
    );
  });

  test("picking 'off' turns the overlay off", () => {
    const root = mount(checkoutWithRun());
    pick(root, "off");
    expect(root.classList.contains("coverage-on")).toBe(false);
    expect(root.querySelectorAll(".unreached").length).toBe(0);
    expect(root.querySelector(".legend-unreached")).toBeNull();
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

function fuzzed(id: string): AtlasDocument {
  const target = exampleTargets().find((each) => each.id === id);
  if (!target) return { schemaVersion: ATLAS_SCHEMA_VERSION, machines: [] };
  const machine = fuzzedMachine(target, fuzz(target, { seed: DEFAULT_SEED, iterations: 2000 }));
  return { schemaVersion: ATLAS_SCHEMA_VERSION, machines: [machine] };
}

describe("viewer: fuzz results", () => {
  test("fuzz-observed stays are drawn distinctly; declared transitions need no fuzz edge", () => {
    const root = mount(fuzzed("retry"));
    expect(root.querySelector(".banner")?.textContent).toBe(`${STRUCTURE_BANNER} ${FUZZ_NOTE}`);
    const fuzzTransitions = [...root.querySelectorAll<SVGGElement>(".edge.fuzz")].filter(
      (edge) => !edge.classList.contains("stay"),
    );
    expect(fuzzTransitions).toEqual([]);
    expect(root.querySelectorAll(".edge.fuzz.stay").length).toBeGreaterThan(0);
    expect(root.querySelector(".legend-fuzz")).not.toBeNull();
  });

  test("edge panel shows origin and the replay sequence that reached it", () => {
    const atlas = fuzzed("retry");
    const root = mount(atlas);
    const edge = atlas.machines[0]?.edges.find((candidate) => candidate.origin === "fuzz");
    edgeElement(root, edge?.id ?? "").dispatchEvent(new Event("click"));
    expect(field(root, "origin")).toBe("fuzz (observed, not declared)");
    const steps = [...root.querySelectorAll(".panel .steps li")].map((item) => item.textContent);
    expect(steps.at(-1)).toMatch(/^failed/);
  });

  test("idle panel shows the fuzz run summary", () => {
    const root = mount(fuzzed("checkout"));
    expect(root.querySelector(".fuzz-summary")).not.toBeNull();
    expect(field(root, "seed")).toBe(String(DEFAULT_SEED));
    expect(field(root, "handler errors")).toBe("none");
  });
});

describe("viewer: onAny", () => {
  function saga(): AtlasDocument {
    return toAtlas(exampleInputs().filter((input) => input.id === "saga"));
  }

  test("onAny edges start at one 'any state' node, not at every state", () => {
    const root = mount(saga());
    expect(root.querySelectorAll(".any-node").length).toBe(1);
    expect(root.querySelector(".any-node")?.textContent).toBe("any state");
    const cancel = [...root.querySelectorAll<SVGGElement>(".edge")].filter(
      (edge) => edge.textContent === "CANCEL",
    );
    expect(cancel.map((edge) => edge.dataset["from"])).toEqual(["*", "*"]);
    expect(cancel[0]?.getAttribute("aria-label")).toMatch(/^any state on CANCEL to /);
  });

  test("a covered state lists the onAny edges as outgoing; the edge panel names the source", () => {
    const atlas = saga();
    const root = mount(atlas);
    root.querySelector('[data-node-id="processingPayment"]')?.dispatchEvent(new Event("click"));
    const links = [...root.querySelectorAll(".panel [data-edge-link]")].map(
      (link) => link.textContent,
    );
    expect(links).toContain("any state —CANCEL→ failed");
    const cancel = atlas.machines[0]?.edges.find((edge) => edge.event === "CANCEL");
    edgeElement(root, cancel?.id ?? "").dispatchEvent(new Event("click"));
    expect(field(root, "source")).toBe("any state (onAny)");
  });

  test("an onAny handler that reads actor state gets the per-state routing note", () => {
    const machine = annotateMachine(
      toAtlasMachine({ id: "routing", actor: createStateRoutingActor() }),
      {
        file: join(EXAMPLE_ROOT, "packages/atlas/src/fixtures/state-routing.ts"),
        root: EXAMPLE_ROOT,
      },
    );
    const root = mount({ schemaVersion: ATLAS_SCHEMA_VERSION, machines: [machine] });
    const back = machine.edges.find((edge) => edge.event === "back");
    edgeElement(root, back?.id ?? "").dispatchEvent(new Event("click"));
    expect(root.querySelector(".panel .routing-note")?.textContent).toMatch(
      /^onAny\(back\) reads actor state/,
    );
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

  test("every analyzed branch maps to a declared edge", () => {
    const atlas = annotatedCredit();
    const root = mount(atlas);
    const apply = atlas.machines[0]?.edges.find((edge) => edge.event === "apply");
    edgeElement(root, apply?.id ?? "").dispatchEvent(new Event("click"));
    const statuses = [...root.querySelectorAll<HTMLElement>(".panel .branch")].map(
      (item) => item.dataset["branchStatus"],
    );
    expect(statuses).toEqual(["in graph", "in graph", "this edge"]);
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

describe("viewer: fuzz vs test coverage", () => {
  function fuzzedAndTested(id: string): AtlasDocument {
    const target = exampleTargets().find((each) => each.id === id);
    if (!target) return { schemaVersion: ATLAS_SCHEMA_VERSION, machines: [] };
    const fuzzed = fuzzedMachine(target, fuzz(target, { seed: DEFAULT_SEED, iterations: 2000 }));
    const machine = withTestCoverage(target, fuzzed, handWrittenBaselines()[id] ?? []);
    return { schemaVersion: ATLAS_SCHEMA_VERSION, machines: [machine] };
  }

  test("tests are the default source; dimmed = not exercised by any test", () => {
    const root = mount(fuzzedAndTested("checkout"));
    expect(root.querySelector<HTMLSelectElement>(".coverage-mode")?.value).toBe("tests");
    expect(root.querySelector(".legend-unreached")?.textContent).toBe(
      "dimmed and dashed: no test exercises this",
    );
    // The example tests never fire paymentFail, so error is untested.
    expect(root.querySelector('[data-node-id="error"]')?.classList.contains("unreached")).toBe(
      true,
    );
    pick(root, "run");
    expect(root.querySelector('[data-node-id="error"]')?.classList.contains("unreached")).toBe(
      false,
    );
  });

  test("declared edge no fuzz run produced gets the 'guards may never allow it' note", () => {
    const atlas = fuzzedAndTested("saga");
    const root = mount(atlas);
    const predicted = atlas.machines[0]?.edges.find(
      (edge) =>
        edge.from === "compensatingRefund" && edge.event === "REFUND_DONE" && edge.to === "failed",
    );
    expect(predicted?.coverage).toEqual({ hits: 0 });
    edgeElement(root, predicted?.id ?? "").dispatchEvent(new Event("click"));
    expect(root.querySelector(".panel .prediction-note")?.textContent).toMatch(
      /^The handler declares this target in `to`, but no fuzz run produced it/,
    );
    expect(field(root, "fuzz hits")).toBe("0");
  });

  test("edges fuzzing reached get no note", () => {
    const atlas = fuzzedAndTested("saga");
    const root = mount(atlas);
    const reached = atlas.machines[0]?.edges.find(
      (edge) => edge.origin === "declared" && (edge.coverage?.hits ?? 0) > 0,
    );
    edgeElement(root, reached?.id ?? "").dispatchEvent(new Event("click"));
    expect(root.querySelector(".panel .prediction-note")).toBeNull();
  });
});
