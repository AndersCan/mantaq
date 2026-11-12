// @vitest-environment happy-dom
import { VirtualClock } from "@mantaq/core";
import { renderGraph } from "../../viz/src/viewer/graph.ts";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { createMeal6 } from "../../../apps/docs/src/tutorial/meal-06.ts";
import { inspectModule, vizDocument } from "./index.ts";
import { mountDriven } from "./live-page.ts";
import { serializeViz } from "@mantaq/viz";

const file = join(import.meta.dirname, "../../../apps/docs/src/tutorial/meal-06.ts");

describe("Getting started step 6", () => {
  test("one eat arrow says when it reaches full, and no fuzz loop is drawn", async () => {
    const inspected = await inspectModule(file, {
      load: async () => ({ createMeal6: () => createMeal6(VirtualClock()) }),
    });
    const machine = inspected.machines[0];
    expect(machine).toBeDefined();
    if (machine === undefined) return;
    const graph = renderGraph(document, machine, {
      select: () => undefined,
      showDetails: () => undefined,
      mode: "off",
    });
    const eat = graph.querySelector('g.edge[data-edge-id="hungry-eat-full"]');
    expect(eat?.querySelector(".edge-condition")?.textContent).toBe('food !== "" && plates !== 0');
    expect(graph.querySelectorAll("g.edge.fuzz")).toHaveLength(0);
  });
});

describe("Getting started step 6, live", () => {
  async function mount(): Promise<HTMLElement> {
    const inspected = await inspectModule(file, {
      load: async () => ({ createMeal6: () => createMeal6(VirtualClock()) }),
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
          return { actor: createMeal6(clock), clock };
        },
      },
    });
    return root;
  }
  const edge = (root: HTMLElement, id: string) =>
    root.querySelector(`g.edge[data-edge-id="${id}"]`);
  const click = (root: HTMLElement, id: string) =>
    edge(root, id)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  test("eat is blocked while no plate is served, and not after serve", async () => {
    const root = await mount();
    expect(edge(root, "hungry-eat-full")?.classList.contains("blocked")).toBe(true);
    click(root, "hungry-eat-full");
    expect(root.querySelector('[data-blocked-note="eat"]')?.textContent).toBe(
      "eat is blocked: plates is 0",
    );
    click(root, "hungry-serve-stay");
    expect(edge(root, "hungry-eat-full")?.classList.contains("blocked")).toBe(false);
    expect(root.querySelector("[data-blocked-note]")).toBeNull();
    click(root, "hungry-eat-full");
    expect(root.querySelector('[data-payload-form="eat"]')).not.toBeNull();
  });

  test("an empty food stays but is not blocked", async () => {
    const root = await mount();
    click(root, "hungry-serve-stay");
    click(root, "hungry-eat-full");
    const box = root.querySelector<HTMLTextAreaElement | HTMLInputElement>(
      '[data-payload-form="eat"] textarea, [data-payload-form="eat"] input',
    );
    if (box) box.value = box instanceof HTMLTextAreaElement ? '{"food": ""}' : "";
    root.querySelector<HTMLElement>('[data-payload-send="eat"]')?.click();
    expect(root.textContent).toContain("stays");
    expect(edge(root, "hungry-eat-full")?.classList.contains("blocked")).toBe(false);
  });
});
