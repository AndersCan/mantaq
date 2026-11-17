// @vitest-environment happy-dom
import { VirtualClock } from "@mantaq/core";
import { renderGraph } from "../../viz/src/viewer/graph.ts";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { meal6 } from "../../../apps/docs/src/tutorial/meal-06.ts";
import { inspectModule, vizDocument } from "./index.ts";
import { mountDriven } from "./live-page.ts";
import { serializeViz } from "@mantaq/viz";
import { sendVia } from "./send-via.ts";

const file = join(import.meta.dirname, "../../../apps/docs/src/tutorial/meal-06.ts");

describe("Getting started step 6", () => {
  test("one eat arrow says when it reaches full, and no fuzz loop is drawn", async () => {
    const inspected = await inspectModule(file, {
      load: async () => ({ meal6 }),
    });
    const machine = inspected.machines[0];
    expect(machine).toBeDefined();
    if (machine === undefined) return;
    const graph = renderGraph(document, machine, {
      select: () => undefined,
    });
    const eat = graph.querySelector('g.edge[data-edge-id="hungry-eat-full"]');
    expect(eat?.querySelector(".edge-condition")?.textContent).toBe('food !== "" && plates !== 0');
  });
});

describe("Getting started step 6, live", () => {
  async function mount(): Promise<HTMLElement> {
    const inspected = await inspectModule(file, {
      load: async () => ({ meal6 }),
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
          return { actor: meal6.create(), clock };
        },
      },
    });
    return root;
  }
  const edge = (root: HTMLElement, id: string) =>
    root.querySelector(`g.edge[data-edge-id="${id}"]`);
  const send = sendVia;

  test("eat is blocked while no plate is served, and not after serve", async () => {
    const root = await mount();
    expect(edge(root, "hungry-eat-full")?.classList.contains("blocked")).toBe(true);
    send(root, "serve");
    expect(edge(root, "hungry-eat-full")?.classList.contains("blocked")).toBe(false);
    send(root, "eat");
    expect(root.querySelector(".explore")?.getAttribute("data-current")).toBe("full");
  });
});
