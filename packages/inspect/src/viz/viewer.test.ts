// @vitest-environment happy-dom
import { toViz, toVizMachine } from "../structure.ts";
import { annotateMachine } from "../ast/annotate.ts";
import { EXAMPLE_ROOT, exampleInputs, exampleTargets, handWrittenBaselines } from "../examples.ts";
import { withTestCoverage } from "../fuzz/coverage.ts";
import { DEFAULT_SEED } from "@mantaq/pbt";
import { createCheckoutActor, submitBasicInfo } from "../fixtures/checkout.ts";
import { createStateRoutingActor } from "../fixtures/state-routing.ts";
import { join } from "node:path";
import type { VizDocument, VizExplanation } from "@mantaq/viz";
import { fuzz } from "../fuzz/fuzz.ts";
import { fuzzedMachine } from "../fuzz/to-viz.ts";
import { VIZ_SCHEMA_VERSION } from "@mantaq/viz";
import { FUZZ_NOTE, STRUCTURE_BANNER, mountViewer } from "@mantaq/viz/viewer";
import { instrument } from "@mantaq/traversal";
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

function field(root: HTMLElement, name: string): string | null | undefined {
  return root.querySelector(`.panel [data-field="${name}"]`)?.textContent;
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

function edgeElement(root: HTMLElement, id: string): Element {
  const found = [...root.querySelectorAll<SVGGElement>(".edge")].find(
    (element) => element.dataset["edgeId"] === id,
  );
  expect(found).toBeDefined();
  return found ?? root;
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
      expect(Number(frame?.getAttribute("height"))).toBe(36 + 20 * state.effects.length);
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
    expect(field(root, "run visits")).toBe("not supplied");
  });

  test("the legend describes effect chips, not a self-loop", () => {
    const text = mount(checkout()).querySelector(".legend-effect")?.textContent ?? "";
    expect(text).toContain("chip");
    expect(text).not.toContain("self-loop");
  });

  test("clicking an edge shows source, event, target and 'not analyzed'", () => {
    const viz = checkout();
    const root = mount(viz);
    const edge = viz.machines[0]?.edges.find((candidate) => candidate.event === "paymentOk");
    edgeElement(root, edge?.id ?? "").dispatchEvent(new Event("click"));
    expect(field(root, "source")).toBe("submitting");
    expect(field(root, "event")).toBe("paymentOk (internal)");
    expect(field(root, "target")).toBe("success");
    expect(field(root, "explanation")).toBe("not analyzed");
    expect(field(root, "run hits")).toBe("not supplied");
    expect(field(root, "test hits")).toBe("not supplied");
  });

  test("undetermined edge panel says undetermined, never a guessed target", () => {
    const viz = undeterminedBack(checkout());
    const root = mount(viz);
    const back = viz.machines[0]?.edges.find((candidate) => candidate.event === "back");
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
    const viz = checkout();
    const root = mount(viz);
    const edge = viz.machines[0]?.edges.find((candidate) => candidate.event === "submitPayment");
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

function checkoutWithRun(): VizDocument {
  const run = instrument(createCheckoutActor());
  run.send(submitBasicInfo.create({ email: "a@b.c", name: "A" }));
  return toViz([{ id: "checkout", actor: createCheckoutActor(), history: run.history }]);
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
    expect(root.querySelector(".banner")?.textContent).toBe(`${STRUCTURE_BANNER} ${FUZZ_NOTE}`);
    const fuzzTransitions = [...root.querySelectorAll<SVGGElement>(".edge.fuzz")].filter(
      (edge) => !edge.classList.contains("stay"),
    );
    expect(fuzzTransitions).toEqual([]);
    expect(root.querySelectorAll(".edge.fuzz.stay").length).toBeGreaterThan(0);
    expect(root.querySelector(".legend-fuzz")).not.toBeNull();
  });

  test("edge panel shows origin and the replay sequence that reached it", () => {
    const viz = fuzzed("retry");
    const root = mount(viz);
    const edge = viz.machines[0]?.edges.find((candidate) => candidate.origin === "fuzz");
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
  function saga(): VizDocument {
    return toViz(exampleInputs().filter((input) => input.id === "saga"));
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
    const viz = saga();
    const root = mount(viz);
    root.querySelector('[data-node-id="processingPayment"]')?.dispatchEvent(new Event("click"));
    const links = [...root.querySelectorAll(".panel [data-edge-link]")].map(
      (link) => link.textContent,
    );
    expect(links).toContain("any state —CANCEL→ failed");
    const cancel = viz.machines[0]?.edges.find((edge) => edge.event === "CANCEL");
    edgeElement(root, cancel?.id ?? "").dispatchEvent(new Event("click"));
    expect(field(root, "source")).toBe("any state (onAny)");
  });

  test("an onAny handler that reads actor state gets the per-state routing note", () => {
    const machine = annotateMachine(
      toVizMachine({ id: "routing", actor: createStateRoutingActor() }),
      {
        file: join(EXAMPLE_ROOT, "packages/inspect/src/fixtures/state-routing.ts"),
        root: EXAMPLE_ROOT,
      },
    );
    const root = mount({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] });
    const back = machine.edges.find((edge) => edge.event === "back");
    edgeElement(root, back?.id ?? "").dispatchEvent(new Event("click"));
    expect(root.querySelector(".panel .routing-note")?.textContent).toMatch(
      /^onAny\(back\) reads actor state/,
    );
  });
});

describe("viewer: AST explanations", () => {
  function annotatedCredit(): VizDocument {
    const credit = exampleTargets().find((each) => each.id === "credit");
    if (!credit) return { schemaVersion: VIZ_SCHEMA_VERSION, machines: [] };
    const machine = annotateMachine(toVizMachine({ id: "credit", actor: credit.create().actor }), {
      file: credit.source,
      root: EXAMPLE_ROOT,
    });
    return { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] };
  }

  test("every analyzed branch maps to a declared edge", () => {
    const viz = annotatedCredit();
    const root = mount(viz);
    const apply = viz.machines[0]?.edges.find((edge) => edge.event === "apply");
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
    const viz = annotatedCredit();
    const root = mount(viz);
    const reset = viz.machines[0]?.edges.find((edge) => edge.event === "reset");
    edgeElement(root, reset?.id ?? "").dispatchEvent(new Event("click"));
    expect(root.querySelector('.panel [data-explain="not analyzed"]')?.textContent).toContain(
      "resetHandler",
    );
    expect(root.querySelector(".panel pre")?.textContent).toBe("resetHandler");
  });
});

describe("viewer: fuzz vs test coverage", () => {
  function fuzzedAndTested(id: string): VizDocument {
    const target = exampleTargets().find((each) => each.id === id);
    if (!target) return { schemaVersion: VIZ_SCHEMA_VERSION, machines: [] };
    const fuzzed = fuzzedMachine(target, fuzz(target, { seed: DEFAULT_SEED, iterations: 2000 }));
    const machine = withTestCoverage(target, fuzzed, handWrittenBaselines()[id] ?? []);
    return { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] };
  }

  test("tests are the default source; dimmed = not exercised by any test", () => {
    const root = mount(fuzzedAndTested("checkout"));
    expect(root.querySelector<HTMLSelectElement>(".coverage-mode")?.value).toBe("tests");
    expect(root.querySelector(".legend-unreached")?.textContent).toBe(
      "dimmed and dashed: no test exercises this",
    );
    // The example tests never fire paymentFail, so that edge is untested.
    const paymentFail = () =>
      root.querySelector(
        '.edge[data-from="submitting"][data-to="error"][aria-label*="paymentFail"]',
      );
    expect(paymentFail()?.classList.contains("unreached")).toBe(true);
    pick(root, "run");
    expect(paymentFail()?.classList.contains("unreached")).toBe(false);
  });

  test("declared edge no fuzz run produced gets the 'guards may never allow it' note", () => {
    const viz = fuzzedAndTested("saga");
    const root = mount(viz);
    const predicted = viz.machines[0]?.edges.find(
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
    const viz = fuzzedAndTested("saga");
    const root = mount(viz);
    const reached = viz.machines[0]?.edges.find(
      (edge) => edge.origin === "declared" && (edge.coverage?.hits ?? 0) > 0,
    );
    edgeElement(root, reached?.id ?? "").dispatchEvent(new Event("click"));
    expect(root.querySelector(".panel .prediction-note")).toBeNull();
  });
});

describe("viewer: explore", () => {
  function nodeElement(root: HTMLElement, id: string): Element | null {
    return root.querySelector(`.graph [data-node-id="${id}"]`);
  }

  function take(root: HTMLElement, event: string, target?: string): void {
    const buttons = [...root.querySelectorAll<HTMLButtonElement>(".panel [data-take]")];
    const found = buttons.find(
      (button) =>
        button.querySelector("code")?.textContent === event &&
        (target === undefined || button.dataset["target"] === target),
    );
    expect(found, `no move ${event}`).toBeDefined();
    found?.click();
  }

  function current(root: HTMLElement): string | null | undefined {
    return root.querySelector(".panel .explore")?.getAttribute("data-current");
  }

  function groupEvents(root: HTMLElement, group: string): string[] {
    return [...root.querySelectorAll(`.panel [data-group="${group}"] [data-take] code`)].map(
      (code) => code.textContent ?? "",
    );
  }

  test("starts in the initial state with its inputs as next steps", () => {
    const root = mount(checkout());
    expect(current(root)).toBe("basicInfo");
    expect(nodeElement(root, "basicInfo")?.classList.contains("current")).toBe(true);
    expect(groupEvents(root, "input")).toEqual(["submitBasicInfo"]);
    expect(root.querySelector(".graph .edge.next")?.getAttribute("data-to")).toBe(
      "shippingAddress",
    );
    expect(nodeElement(root, "shippingAddress")?.classList.contains("reachable")).toBe(true);
  });

  test("an effect's declared sends are the next steps it reports back", () => {
    const root = mount(checkout());
    take(root, "submitBasicInfo");
    take(root, "submitShipping");
    take(root, "submitPayment");
    expect(current(root)).toBe("submitting");
    expect(root.querySelector('.panel [data-effect="chargeCard"]')?.textContent).toBe(
      "chargeCard sends paymentOk, paymentFail, paymentTimeout",
    );
    expect(groupEvents(root, "effect")).toEqual(["paymentFail", "paymentOk", "paymentTimeout"]);
    expect(groupEvents(root, "input")).toEqual([]);
    const running = root.querySelector(".graph .chip.running");
    expect(running?.getAttribute("data-state")).toBe("submitting");
    take(root, "paymentOk");
    expect(current(root)).toBe("success");
    expect(root.querySelector(".graph .chip.running")).toBeNull();
  });

  test("a timeout leads to error, and back retries payment", () => {
    const root = mount(checkout());
    for (const event of ["submitBasicInfo", "submitShipping", "submitPayment", "paymentTimeout"]) {
      take(root, event);
    }
    expect(current(root)).toBe("error");
    take(root, "back");
    expect(current(root)).toBe("payment");
    expect([...root.querySelectorAll(".graph .edge.taken")]).toHaveLength(5);
  });

  test("a final state ends the walk", () => {
    const root = mount(checkout());
    for (const event of ["submitBasicInfo", "submitShipping", "submitPayment", "paymentOk"]) {
      take(root, event);
    }
    expect(current(root)).toBe("success");
    expect(root.querySelector(".panel .explore-end")?.textContent).toBe(
      "Done. success is final: the actor has stopped.",
    );
    expect(root.querySelectorAll(".panel [data-take]")).toHaveLength(0);
    expect(root.querySelectorAll(".graph .edge.next, .graph .state.reachable")).toHaveLength(0);
  });

  test("clicking a next edge or a reachable state on the graph takes the step", () => {
    const root = mount(checkout());
    root.querySelector(".graph .edge.next")?.dispatchEvent(new Event("click"));
    expect(current(root)).toBe("shippingAddress");
    expect(root.querySelector(".panel [data-selected-edge]")).not.toBeNull();
    nodeElement(root, "payment")?.dispatchEvent(new Event("click"));
    expect(current(root)).toBe("payment");
    nodeElement(root, "success")?.dispatchEvent(new Event("click"));
    expect(current(root)).toBe("payment");
    expect(root.querySelector('.panel [data-selected-state="success"]')).not.toBeNull();
  });

  test("back, reset, rewinding the path and ArrowLeft", () => {
    const root = mount(checkout());
    take(root, "submitBasicInfo");
    take(root, "submitShipping");
    take(root, "submitPayment");
    root.querySelector<HTMLButtonElement>('[data-explore-action="back"]')?.click();
    expect(current(root)).toBe("payment");
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(current(root)).toBe("shippingAddress");
    root.querySelector<HTMLButtonElement>('.panel [data-rewind="1"]')?.click();
    expect(current(root)).toBe("shippingAddress");
    root.querySelector<HTMLButtonElement>('[data-explore-action="reset"]')?.click();
    expect(current(root)).toBe("basicInfo");
    expect(root.querySelector<HTMLButtonElement>('[data-explore-action="back"]')?.disabled).toBe(
      true,
    );
  });

  test("onAny moves are offered from every non-final state", () => {
    const viz = toViz(exampleInputs().filter((input) => input.id === "saga"));
    const root = mount(viz);
    take(root, "START");
    expect(current(root)).toBe("reservingInventory");
    const cancels = [...root.querySelectorAll<HTMLButtonElement>('.panel [data-take^="*-CANCEL"]')];
    expect(
      cancels
        .map((button) => button.dataset["target"])
        .toSorted((a = "", b = "") => a.localeCompare(b)),
    ).toEqual(["compensatingRelease", "failed"]);
  });

  test("steps round-trip through onNavigate and the steps option", () => {
    const seen: Array<{ machine: string; steps: string[] }> = [];
    const root = mount(checkout(), { onNavigate: (where) => seen.push(where) });
    take(root, "submitBasicInfo");
    take(root, "back");
    const last = seen.at(-1);
    expect(last?.machine).toBe("checkout");
    expect(last?.steps).toHaveLength(2);
    const reopened = mount(checkout(), { steps: [...(last?.steps ?? []), "no-such-edge"] });
    expect(current(reopened)).toBe("basicInfo");
    expect(reopened.querySelectorAll(".panel .explore-path li")).toHaveLength(3);
  });

  test("an undetermined edge offers each target its explanation names, or none", () => {
    const viz = undeterminedBack(checkout());
    const id = "shippingAddress-back-undetermined";
    const plain = mount(viz);
    take(plain, "submitBasicInfo");
    expect(plain.querySelector(`.panel [data-move="${id}"]`)?.textContent).toBe(
      "back → ? target depends on payload or context",
    );

    const explanation: VizExplanation = {
      status: "analyzed",
      location: { file: "checkout.ts", line: 1, column: 1 },
      registration: "on",
      branches: [
        { conditions: ["ok"], target: { kind: "state", state: "basicInfo" } },
        { conditions: ["!(ok)"], target: { kind: "stay" } },
      ],
      payloadReads: [],
      contextReads: [],
      contextWrites: [],
      readsActorState: false,
      comparisons: [],
      literals: [],
    };
    const explained: VizDocument = {
      ...viz,
      machines: viz.machines.map((machine) => ({
        ...machine,
        edges: machine.edges.map((edge) => (edge.id === id ? { ...edge, explanation } : edge)),
      })),
    };
    const seen: string[][] = [];
    const root = mount(explained, { onNavigate: (where) => seen.push(where.steps) });
    take(root, "submitBasicInfo");
    const targets = [...root.querySelectorAll<HTMLButtonElement>(`.panel [data-take="${id}"]`)].map(
      (button) => button.dataset["target"],
    );
    expect(targets).toEqual(["basicInfo", "shippingAddress"]);
    take(root, "back", "shippingAddress");
    expect(current(root)).toBe("shippingAddress");
    expect(seen.at(-1)?.at(-1)).toBe(`${id}~shippingAddress`);
    expect(current(mount(explained, { steps: seen.at(-1) }))).toBe("shippingAddress");
  });
});
