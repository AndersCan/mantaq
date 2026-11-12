// @vitest-environment happy-dom
import { VirtualClock } from "@mantaq/core";
import { renderGraph } from "../../viz/src/viewer/graph.ts";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { createOrder6 } from "../../../apps/docs/src/tutorial/order-06.ts";
import { inspectModule, vizDocument } from "./index.ts";
import { mountDriven } from "./live-page.ts";
import { serializeViz } from "@mantaq/viz";

const file = join(import.meta.dirname, "../../../apps/docs/src/tutorial/order-06.ts");

describe("Getting started step 6", () => {
  test("one pay arrow says when it reaches payment, and no fuzz loop is drawn", async () => {
    const inspected = await inspectModule(file, {
      load: async () => ({ createOrder6: () => createOrder6(VirtualClock()) }),
    });
    const machine = inspected.machines[0];
    expect(machine).toBeDefined();
    if (machine === undefined) return;
    const graph = renderGraph(document, machine, {
      select: () => undefined,
      showDetails: () => undefined,
      mode: "off",
    });
    const pay = graph.querySelector('g.edge[data-edge-id="cart-pay-payment"]');
    expect(pay?.querySelector(".edge-condition")?.textContent).toBe('email !== "" && items !== 0');
    expect(graph.querySelectorAll("g.edge.fuzz")).toHaveLength(0);
  });
});

describe("Getting started step 6, live", () => {
  async function mount(): Promise<HTMLElement> {
    const inspected = await inspectModule(file, {
      load: async () => ({ createOrder6: () => createOrder6(VirtualClock()) }),
      fuzz: false,
    });
    const id = inspected.machines[0]?.id ?? "";
    const root = document.createElement("div");
    document.body.append(root);
    mountDriven(root, {
      source: "test",
      text: serializeViz(vizDocument(inspected.machines)),
      targets: {
        [id]: () => {
          const clock = VirtualClock();
          return { actor: createOrder6(clock), clock };
        },
      },
    });
    return root;
  }
  const edge = (root: HTMLElement, id: string) =>
    root.querySelector(`g.edge[data-edge-id="${id}"]`);
  const click = (root: HTMLElement, id: string) =>
    edge(root, id)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  test("pay is blocked while the cart is empty, and not after addItem", async () => {
    const root = await mount();
    expect(edge(root, "cart-pay-payment")?.classList.contains("blocked")).toBe(true);
    click(root, "cart-pay-payment");
    expect(root.querySelector('[data-blocked-note="pay"]')?.textContent).toBe(
      "pay is blocked: items is 0",
    );
    click(root, "cart-addItem-stay");
    expect(edge(root, "cart-pay-payment")?.classList.contains("blocked")).toBe(false);
    expect(root.querySelector("[data-blocked-note]")).toBeNull();
    click(root, "cart-pay-payment");
    expect(root.querySelector('[data-payload-form="pay"]')).not.toBeNull();
  });

  test("an empty email stays but is not blocked", async () => {
    const root = await mount();
    click(root, "cart-addItem-stay");
    click(root, "cart-pay-payment");
    const box = root.querySelector<HTMLTextAreaElement | HTMLInputElement>(
      '[data-payload-form="pay"] textarea, [data-payload-form="pay"] input',
    );
    if (box) box.value = box instanceof HTMLTextAreaElement ? '{"email": ""}' : "";
    root.querySelector<HTMLElement>('[data-payload-send="pay"]')?.click();
    expect(root.textContent).toContain("stays");
    expect(edge(root, "cart-pay-payment")?.classList.contains("blocked")).toBe(false);
  });
});
