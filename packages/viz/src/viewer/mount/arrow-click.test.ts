// @vitest-environment happy-dom
import { edgeOf, machineOf, stateOf } from "../groups/shop-machines.ts";
import { expect, test } from "vite-plus/test";
import type { VizDocument, VizDriver } from "../../schema.ts";
import { mountViewer } from "../viewer.ts";
import { VIZ_SCHEMA_VERSION } from "../../schema.ts";
import { walkDriver } from "../groups/walk-driver.ts";

/** inCart -checkout-> paying -paid-> done, and paying -retry-> paying. */
const shop = machineOf({
  states: [
    stateOf("inCart", { initial: true }),
    stateOf("paying"),
    stateOf("done", { final: true }),
  ],
  edges: [
    edgeOf("__initial__", { event: "", to: "inCart", kind: "initial" }),
    edgeOf("inCart", { event: "checkout", to: "paying" }),
    edgeOf("paying", { event: "paid", to: "done" }),
    edgeOf("paying", { event: "retry", to: "paying" }),
  ],
});

interface MountOptions {
  diagramOnly: boolean;
}

function mount(options: MountOptions): HTMLElement {
  const root = document.createElement("div");
  document.body.append(root);
  const { driver } = walkDriver(shop, { guarded: new Set() });
  const viz: VizDocument = { schemaVersion: VIZ_SCHEMA_VERSION, machines: [shop] };
  mountViewer(root, viz, { driver, diagramOnly: options.diagramOnly });
  return root;
}

interface ArrowQuery {
  arrow: string;
}

function enterOn(root: HTMLElement, options: ArrowQuery): void {
  const selector = `.graph g.edge[data-edge-id="${options.arrow}"]`;
  const element = root.querySelector<SVGGElement>(selector);
  element?.focus();
  element?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}

function focused(root: HTMLElement): string | undefined {
  const active = root.ownerDocument.activeElement;
  const id = active?.getAttribute("data-edge-id") ?? active?.getAttribute("data-node-id");
  return id ?? undefined;
}

test("after Enter sends an arrow, focus goes to the first arrow that sends, then to the current state", () => {
  const root = mount({ diagramOnly: true });
  enterOn(root, { arrow: "inCart-checkout-paying" });
  const afterCheckout = focused(root);
  const sentArrow = root.querySelector('.graph g.edge[data-edge-id="inCart-checkout-paying"]');
  const left = sentArrow?.getAttribute("tabindex") ?? undefined;
  enterOn(root, { arrow: "paying-retry-paying" });
  const afterRetry = focused(root);
  enterOn(root, { arrow: "paying-paid-done" });
  expect({ afterCheckout, left, afterRetry, afterPaid: focused(root) }).toEqual({
    afterCheckout: "paying-paid-done",
    left: undefined,
    afterRetry: "paying-retry-paying",
    afterPaid: "done",
  });
});

test("without a panel, a send the driver throws on says what it threw, not a step", () => {
  const root = document.createElement("div");
  document.body.append(root);
  const { driver } = walkDriver(shop, { guarded: new Set() });
  const throwing: VizDriver = {
    ...driver,
    step: (step) => {
      if (step.kind === "event" && step.event === "paid") throw new Error("card declined");
      return driver.step(step);
    },
  };
  const viz: VizDocument = { schemaVersion: VIZ_SCHEMA_VERSION, machines: [shop] };
  mountViewer(root, viz, { driver: throwing, diagramOnly: true, steps: ["checkout"] });
  root
    .querySelector('.graph g.edge[data-edge-id="paying-paid-done"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(root.querySelector(".viz-main > .blocked-note")?.textContent).toBe(
    "Handler threw: card declined",
  );
});
